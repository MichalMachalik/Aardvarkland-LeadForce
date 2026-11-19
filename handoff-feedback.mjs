import { Failure, id, text } from './validation.mjs';

const reasons = ['unreachable', 'invalid_contact', 'duplicate', 'out_of_scope', 'other'];
const active = (status) => status === 'open' || status === 'review';
const pageSize = 25;
const teamHours = 24;
const clientHours = 72;
const handoffJoin = `FROM client_leads d
  JOIN leads l ON l.workspace_id=d.workspace_id AND l.id=d.lead_id
  JOIN client_campaigns c ON c.workspace_id=d.workspace_id AND c.id=d.campaign_id
  JOIN clients a ON a.workspace_id=c.workspace_id AND a.id=c.client_id
  LEFT JOIN users staff ON staff.workspace_id=l.workspace_id AND staff.id=l.owner_id
  LEFT JOIN handoff_receipts receipt ON receipt.workspace_id=d.workspace_id AND receipt.lead_id=d.lead_id
  LEFT JOIN users confirmer ON confirmer.workspace_id=receipt.workspace_id AND confirmer.id=receipt.confirmed_by
  LEFT JOIN handoff_claims last ON last.id=(
    SELECT q.id FROM handoff_claims q WHERE q.workspace_id=d.workspace_id AND q.lead_id=d.lead_id ORDER BY q.id DESC LIMIT 1
  )
  LEFT JOIN handoff_claim_messages message ON message.id=(
    SELECT m.id FROM handoff_claim_messages m WHERE m.workspace_id=last.workspace_id AND m.claim_id=last.id ORDER BY m.id DESC LIMIT 1
  )
  WHERE d.workspace_id=? AND d.handed_day IS NOT NULL `;
const openClaim = "last.status IN ('open','review')";
const clientTurn = "(last.status='review' AND message.kind='request')";
const teamTurn = `(${openClaim} AND NOT (${clientTurn} IS TRUE))`;
// Taking ownership does not count as a reply. Only a message starts a new turn.
const dueAt = `CASE WHEN ${openClaim} THEN strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(message.created_at,last.filed_at),
  CASE WHEN ${clientTurn} THEN '+${clientHours} hours' ELSE '+${teamHours} hours' END) END`;
const overdue = `(${dueAt} <= ?)`;
const columns = `l.id,l.name,l.email,l.handed_at,d.handed_day,c.name AS campaign,c.code,c.project,a.name AS client,
  receipt.confirmed_at,confirmer.name AS confirmed_by,last.status AS claim_status,
  CASE WHEN last.status='review' THEN message.kind END AS claim_turn,
  ${dueAt} AS sla_due_at,COALESCE(${overdue},0) AS sla_overdue`;
const missing = () => new Failure(404, 'Předaná poptávka nebyla nalezena.');

function requestKey(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) {
    throw new Failure(422, 'Obnovte formulář ' + label + '.');
  }
  return value;
}

export function handoffFeedback({ get, all, run, event, allow, clientName, clock }) {
  const stamp = () => new Date(clock()).toISOString();

  function scope(actor) {
    if (actor.role === 'client') return [' AND c.client_id=?', [clientName(actor).id]];
    allow(actor, 'admin', 'care');
    if (actor.role === 'care') return [' AND (l.owner_id=? OR l.owner_id IS NULL OR staff.enabled=0)', [actor.id]];
    return ['', []];
  }

  function delivery(actor, value) {
    const [filter, args] = scope(actor);
    const row = get('SELECT ' + columns + ' ' + handoffJoin + ' AND l.id=?' + filter, stamp(), actor.workspace_id, id(value), ...args);
    if (!row) throw missing();
    return row;
  }

  function details(actor, lead) {
    const delivered = delivery(actor, lead);
    const staffColumns = actor.role === 'client' ? '' : ',q.reviewed_by AS reviewer_id,r.name AS reviewer,s.name AS resolver';
    const claims = all(`SELECT q.id,q.version,q.filed_at,q.reason,q.description,q.status,q.reviewed_at,q.resolved_at,q.resolution,
      f.name AS reporter${staffColumns} FROM handoff_claims q
      JOIN users f ON f.workspace_id=q.workspace_id AND f.id=q.filed_by
      LEFT JOIN users r ON r.workspace_id=q.workspace_id AND r.id=q.reviewed_by
      LEFT JOIN users s ON s.workspace_id=q.workspace_id AND s.id=q.resolved_by
      WHERE q.workspace_id=? AND q.lead_id=? ORDER BY q.id DESC`, actor.workspace_id, delivered.id);
    const threads = new Map(claims.map((claim) => [claim.id, []]));
    const messages = all(`SELECT m.claim_id,m.kind,m.body,m.created_at,author.name AS author
      FROM handoff_claim_messages m JOIN handoff_claims q ON q.workspace_id=m.workspace_id AND q.id=m.claim_id
      JOIN users author ON author.workspace_id=m.workspace_id AND author.id=m.author_id
      WHERE q.workspace_id=? AND q.lead_id=? ORDER BY m.id`, actor.workspace_id, delivered.id);
    for (const { claim_id, ...message } of messages) threads.get(claim_id).push(message);
    return { delivery: delivered, claims: claims.map((claim) => ({ ...claim, messages: threads.get(claim.id) })) };
  }

  function summary(actor) {
    allow(actor, 'admin', 'care');
    const [filter, args] = scope(actor);
    return get(`SELECT COUNT(*) AS total,COUNT(receipt.lead_id) AS confirmed,
      COUNT(CASE WHEN last.status IN ('open','review') THEN 1 END) AS active ` + handoffJoin + filter, actor.workspace_id, ...args);
  }

  function list(actor, params, condition, status, escalations = false) {
    const [filter, args] = scope(actor);
    const requested = params.has('page') ? id(params.get('page')) : 1;
    const checkedAt = stamp();
    const predicate = handoffJoin + filter + ' AND ' + condition;
    const values = escalations ? [actor.workspace_id, ...args, checkedAt] : [actor.workspace_id, ...args];
    const { total } = get('SELECT COUNT(*) AS total ' + predicate, ...values);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requested, pages);
    const rows = all('SELECT ' + columns + ' ' + predicate +
      ' ORDER BY sla_overdue DESC, sla_due_at IS NULL, sla_due_at, l.handed_at DESC,l.id DESC LIMIT ? OFFSET ?',
    checkedAt, ...values, pageSize, (page - 1) * pageSize);
    return { rows, status, page, pages };
  }

  function inbox(actor, params) {
    allow(actor, 'admin', 'care');
    const status = params.get('status') || 'active';
    const filters = {
      active: openClaim,
      waiting: 'receipt.lead_id IS NULL',
      confirmed: 'receipt.lead_id IS NOT NULL',
      closed: "last.status IN ('accepted','rejected')",
      client_turn: clientTurn,
      all: '1=1',
    };
    if (!Object.hasOwn(filters, status)) throw new Failure(422, 'Vyberte platný stav předání.');
    return list(actor, params, filters[status], status);
  }

  function attentionCounts(actor) {
    const [filter, args] = scope(actor);
    const checkedAt = stamp();
    const counts = actor.role === 'client'
      ? get(`SELECT COUNT(*) AS count ${handoffJoin}${filter} AND ${clientTurn}`, actor.workspace_id, ...args)
      : get(`SELECT COUNT(CASE WHEN ${teamTurn} THEN 1 END) AS count,
          COUNT(CASE WHEN ${overdue} THEN 1 END) AS overdue ${handoffJoin}${filter}`, checkedAt, actor.workspace_id, ...args);
    return { ...counts, checkedAt };
  }

  function attention(actor, params) {
    if (params.get('overdue') === '1') {
      allow(actor, 'admin', 'care');
      return list(actor, params, overdue, 'overdue', true);
    }
    return list(actor, params, actor.role === 'client' ? clientTurn : teamTurn, 'attention');
  }

  function scopedClaim(actor, value) {
    const claim = get('SELECT * FROM handoff_claims WHERE workspace_id=? AND id=?', actor.workspace_id, id(value));
    if (!claim) throw missing();
    delivery(actor, claim.lead_id);
    return claim;
  }

  function verifyVersion(claim, version) {
    if (claim.version !== id(version)) throw new Failure(409, 'Reklamace se mezitím změnila. Obnovte detail.');
  }

  function postMessage(actor, body, kind) {
    allow(actor, ...(kind === 'request' ? ['admin', 'care'] : ['client']));
    const claim = scopedClaim(actor, body.id);
    const key = requestKey(body.request_key, 'zprávy');
    const value = text(body.message, kind === 'request' ? 'Požadované podklady' : 'Doplnění podkladů', 1600);
    const existing = get('SELECT id,author_id,kind,body FROM handoff_claim_messages WHERE workspace_id=? AND claim_id=? AND request_key=?',
      actor.workspace_id, claim.id, key);
    if (existing) {
      if (existing.author_id !== actor.id || existing.kind !== kind || existing.body !== value) {
        throw new Failure(409, 'Obsah odeslané zprávy se změnil. Obnovte formulář.');
      }
      return { id: existing.id };
    }
    verifyVersion(claim, body.version);
    if (claim.status !== 'review') throw new Failure(409, 'Podklady lze doplňovat u reklamace v řešení.');
    if (kind === 'request' && actor.role !== 'admin' && claim.reviewed_by !== actor.id) {
      throw new Failure(409, 'Nejprve převezměte reklamaci.');
    }
    const last = get('SELECT kind FROM handoff_claim_messages WHERE workspace_id=? AND claim_id=? ORDER BY id DESC LIMIT 1',
      actor.workspace_id, claim.id);
    if (kind === 'request' && last?.kind === 'request') throw new Failure(409, 'Tým už čeká na odpověď klienta.');
    if (kind === 'reply' && last?.kind !== 'request') throw new Failure(409, 'Tým nyní nečeká na doplnění podkladů.');
    const result = run(`INSERT INTO handoff_claim_messages (workspace_id,claim_id,request_key,author_id,created_at,kind,body)
      VALUES (?,?,?,?,?,?,?)`, actor.workspace_id, claim.id, key, actor.id, stamp(), kind, value);
    run('UPDATE handoff_claims SET version=version+1 WHERE workspace_id=? AND id=?', actor.workspace_id, claim.id);
    event(actor, kind === 'request' ? 'handoff_claim_evidence_requested' : 'handoff_claim_evidence_supplied',
      'Reklamace #' + claim.id, claim.lead_id);
    return { id: result.lastInsertRowid };
  }

  const actions = {
    'confirm-handoff'(actor, body) {
      allow(actor, 'client');
      const lead = delivery(actor, body.id);
      const saved = run(`INSERT INTO handoff_receipts (workspace_id,lead_id,confirmed_by,confirmed_at)
        VALUES (?,?,?,?) ON CONFLICT(workspace_id,lead_id) DO NOTHING`,
      actor.workspace_id, lead.id, actor.id, new Date().toISOString());
      if (saved.changes) event(actor, 'handoff_confirmed', '', lead.id);
    },
    'file-handoff-claim'(actor, body) {
      allow(actor, 'client');
      const lead = delivery(actor, body.id);
      if (!reasons.includes(body.reason)) throw new Failure(422, 'Vyberte důvod reklamace.');
      const key = requestKey(body.request_key, 'reklamace');
      const description = body.reason === 'other' || (body.description != null && !(typeof body.description === 'string' && !body.description.trim()))
        ? text(body.description, 'Popis reklamace', 1600) : '';
      const existing = get('SELECT id,reason,description FROM handoff_claims WHERE workspace_id=? AND lead_id=? AND request_key=?',
        actor.workspace_id, lead.id, key);
      if (existing) {
        if (existing.reason !== body.reason || existing.description !== description) throw new Failure(409, 'Obsah odeslané reklamace se změnil. Obnovte formulář.');
        return { id: existing.id };
      }
      if (active(lead.claim_status)) throw new Failure(409, 'Tým už řeší reklamaci tohoto předání.');
      const result = run(`INSERT INTO handoff_claims (workspace_id,lead_id,request_key,filed_by,filed_at,reason,description)
        VALUES (?,?,?,?,?,?,?)`, actor.workspace_id, lead.id, key, actor.id, stamp(), body.reason, description);
      event(actor, 'handoff_claim_filed', 'Reklamace #' + result.lastInsertRowid, lead.id);
      return { id: result.lastInsertRowid };
    },
    'review-handoff-claim'(actor, body) {
      allow(actor, 'admin', 'care');
      const claim = scopedClaim(actor, body.id);
      if (claim.status === 'review' && claim.reviewed_by === actor.id) return;
      verifyVersion(claim, body.version);
      if (!active(claim.status)) throw new Failure(409, 'Reklamace už je vyřízená.');
      run(`UPDATE handoff_claims SET status='review',reviewed_by=?,reviewed_at=?,version=version+1
        WHERE workspace_id=? AND id=?`, actor.id, stamp(), actor.workspace_id, claim.id);
      event(actor, 'handoff_claim_review', 'Reklamace #' + claim.id, claim.lead_id);
    },
    'resolve-handoff-claim'(actor, body) {
      allow(actor, 'admin', 'care');
      const claim = scopedClaim(actor, body.id);
      if (!['accepted', 'rejected'].includes(body.outcome)) throw new Failure(422, 'Vyberte výsledek reklamace.');
      const resolution = text(body.resolution, 'Vyjádření pro klienta', 1600);
      if (claim.status === body.outcome && claim.resolution === resolution) return;
      verifyVersion(claim, body.version);
      if (claim.status !== 'review') throw new Failure(409, 'Rozhodnout lze o reklamaci v řešení.');
      if (actor.role !== 'admin' && claim.reviewed_by !== actor.id) throw new Failure(409, 'Nejprve převezměte reklamaci.');
      run(`UPDATE handoff_claims SET status=?,resolved_by=?,resolved_at=?,resolution=?,version=version+1
        WHERE workspace_id=? AND id=?`, body.outcome, actor.id, stamp(), resolution, actor.workspace_id, claim.id);
      event(actor, body.outcome === 'accepted' ? 'handoff_claim_accepted' : 'handoff_claim_rejected', 'Reklamace #' + claim.id, claim.lead_id);
    },
    'request-claim-evidence': (actor, body) => postMessage(actor, body, 'request'),
    'reply-claim-evidence': (actor, body) => postMessage(actor, body, 'reply'),
  };

  return { details, summary, inbox, attention, attentionCounts, actions };
}
