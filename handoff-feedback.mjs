import { Failure, id, text } from './validation.mjs';

const reasons = ['unreachable', 'invalid_contact', 'duplicate', 'out_of_scope', 'other'];
const active = (status) => status === 'open' || status === 'review';
const stamp = () => new Date().toISOString();
const pageSize = 25;
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
  WHERE d.workspace_id=? AND d.handed_day IS NOT NULL `;
const columns = `l.id,l.name,l.email,l.handed_at,d.handed_day,c.name AS campaign,c.code,c.project,a.name AS client,
  receipt.confirmed_at,confirmer.name AS confirmed_by,last.status AS claim_status`;
const missing = () => new Failure(404, 'Předaná poptávka nebyla nalezena.');

export function handoffFeedback({ get, all, run, event, allow, clientName }) {
  function scope(actor) {
    if (actor.role === 'client') return [' AND c.client_id=?', [clientName(actor).id]];
    allow(actor, 'admin', 'care');
    if (actor.role === 'care') return [' AND (l.owner_id=? OR l.owner_id IS NULL OR staff.enabled=0)', [actor.id]];
    return ['', []];
  }

  function delivery(actor, value) {
    const [filter, args] = scope(actor);
    const row = get('SELECT ' + columns + ' ' + handoffJoin + ' AND l.id=?' + filter, actor.workspace_id, id(value), ...args);
    if (!row) throw missing();
    return row;
  }

  function details(actor, lead) {
    const delivered = delivery(actor, lead);
    const staffColumns = actor.role === 'client' ? '' : ',q.version,q.reviewed_by AS reviewer_id,r.name AS reviewer,s.name AS resolver';
    const claims = all(`SELECT q.id,q.filed_at,q.reason,q.description,q.status,q.reviewed_at,q.resolved_at,q.resolution,
      f.name AS reporter${staffColumns} FROM handoff_claims q
      JOIN users f ON f.workspace_id=q.workspace_id AND f.id=q.filed_by
      LEFT JOIN users r ON r.workspace_id=q.workspace_id AND r.id=q.reviewed_by
      LEFT JOIN users s ON s.workspace_id=q.workspace_id AND s.id=q.resolved_by
      WHERE q.workspace_id=? AND q.lead_id=? ORDER BY q.id DESC`, actor.workspace_id, delivered.id);
    return { delivery: delivered, claims };
  }

  function summary(actor) {
    allow(actor, 'admin', 'care');
    const [filter, args] = scope(actor);
    return get(`SELECT COUNT(*) AS total,COUNT(receipt.lead_id) AS confirmed,
      COUNT(CASE WHEN last.status IN ('open','review') THEN 1 END) AS active ` + handoffJoin + filter, actor.workspace_id, ...args);
  }

  function inbox(actor, params) {
    allow(actor, 'admin', 'care');
    const [filter, args] = scope(actor);
    const status = params.get('status') || 'active';
    const filters = {
      active: " AND last.status IN ('open','review')",
      waiting: ' AND receipt.lead_id IS NULL',
      confirmed: ' AND receipt.lead_id IS NOT NULL',
      closed: " AND last.status IN ('accepted','rejected')",
      all: '',
    };
    if (!Object.hasOwn(filters, status)) throw new Failure(422, 'Vyberte platný stav předání.');
    const requested = params.has('page') ? id(params.get('page')) : 1;
    const predicate = handoffJoin + filter + filters[status];
    const values = [actor.workspace_id, ...args];
    const { total } = get('SELECT COUNT(*) AS total ' + predicate, ...values);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requested, pages);
    const rows = all('SELECT ' + columns + ' ' + predicate +
      ` ORDER BY CASE last.status WHEN 'open' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
        CASE WHEN last.status IN ('open','review') THEN last.filed_at END ASC, l.handed_at DESC,l.id DESC LIMIT ? OFFSET ?`,
    ...values, pageSize, (page - 1) * pageSize);
    return { rows, status, page, pages };
  }

  function staffClaim(actor, value) {
    allow(actor, 'admin', 'care');
    const claim = get('SELECT * FROM handoff_claims WHERE workspace_id=? AND id=?', actor.workspace_id, id(value));
    if (!claim) throw missing();
    delivery(actor, claim.lead_id);
    return claim;
  }

  function verifyVersion(claim, version) {
    if (claim.version !== id(version)) throw new Failure(409, 'Reklamace se mezitím změnila. Obnovte detail.');
  }

  const actions = {
    'confirm-handoff'(actor, body) {
      allow(actor, 'client');
      const lead = delivery(actor, body.id);
      const saved = run(`INSERT INTO handoff_receipts (workspace_id,lead_id,confirmed_by,confirmed_at)
        VALUES (?,?,?,?) ON CONFLICT(workspace_id,lead_id) DO NOTHING`,
      actor.workspace_id, lead.id, actor.id, stamp());
      if (saved.changes) event(actor, 'handoff_confirmed', '', lead.id);
    },
    'file-handoff-claim'(actor, body) {
      allow(actor, 'client');
      const lead = delivery(actor, body.id);
      if (!reasons.includes(body.reason)) throw new Failure(422, 'Vyberte důvod reklamace.');
      if (typeof body.request_key !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.request_key)) {
        throw new Failure(422, 'Obnovte formulář reklamace.');
      }
      const description = body.reason === 'other' || (body.description != null && !(typeof body.description === 'string' && !body.description.trim()))
        ? text(body.description, 'Popis reklamace', 1600) : '';
      const existing = get('SELECT id,reason,description FROM handoff_claims WHERE workspace_id=? AND lead_id=? AND request_key=?',
        actor.workspace_id, lead.id, body.request_key);
      if (existing) {
        if (existing.reason !== body.reason || existing.description !== description) throw new Failure(409, 'Obsah odeslané reklamace se změnil. Obnovte formulář.');
        return { id: existing.id };
      }
      if (active(lead.claim_status)) throw new Failure(409, 'Tým už řeší reklamaci tohoto předání.');
      const result = run(`INSERT INTO handoff_claims (workspace_id,lead_id,request_key,filed_by,filed_at,reason,description)
        VALUES (?,?,?,?,?,?,?)`, actor.workspace_id, lead.id, body.request_key, actor.id, stamp(), body.reason, description);
      event(actor, 'handoff_claim_filed', 'Reklamace #' + result.lastInsertRowid, lead.id);
      return { id: result.lastInsertRowid };
    },
    'review-handoff-claim'(actor, body) {
      const claim = staffClaim(actor, body.id);
      if (claim.status === 'review' && claim.reviewed_by === actor.id) return;
      verifyVersion(claim, body.version);
      if (!active(claim.status)) throw new Failure(409, 'Reklamace už je vyřízená.');
      run(`UPDATE handoff_claims SET status='review',reviewed_by=?,reviewed_at=?,version=version+1
        WHERE workspace_id=? AND id=?`, actor.id, stamp(), actor.workspace_id, claim.id);
      event(actor, 'handoff_claim_review', 'Reklamace #' + claim.id, claim.lead_id);
    },
    'resolve-handoff-claim'(actor, body) {
      const claim = staffClaim(actor, body.id);
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
  };

  return { details, summary, inbox, actions };
}
