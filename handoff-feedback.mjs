import { Failure, id, text } from './validation.mjs';
import { defaultClaimCalendar, validateClaimCalendar } from './claim-calendar.mjs';

const reasons = ['unreachable', 'invalid_contact', 'duplicate', 'out_of_scope', 'other'];
const active = (status) => status === 'open' || status === 'review';
const pageSize = 25;
const assignmentJoins = `LEFT JOIN handoff_claim_assignments assigned ON assigned.id=(
    SELECT x.id FROM handoff_claim_assignments x WHERE x.workspace_id=last.workspace_id AND x.claim_id=last.id
    ORDER BY x.id DESC LIMIT 1
  )
  LEFT JOIN users solver ON solver.workspace_id=last.workspace_id
    AND solver.id=CASE WHEN assigned.id IS NULL THEN last.reviewed_by ELSE assigned.assigned_user END`;
const eligibleSolver = "solver.enabled=1 AND solver.role IN ('admin','care')";
const owner = `CASE WHEN ${eligibleSolver} THEN solver.id END`;
const leadScope = '(l.owner_id=? OR l.owner_id IS NULL OR staff.enabled=0)';
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
  ${assignmentJoins}
  LEFT JOIN handoff_claim_messages message ON message.id=(
    SELECT m.id FROM handoff_claim_messages m WHERE m.workspace_id=last.workspace_id AND m.claim_id=last.id ORDER BY m.id DESC LIMIT 1
  )
  LEFT JOIN handoff_calendars cal ON cal.workspace_id=d.workspace_id
  WHERE d.workspace_id=? AND d.handed_day IS NOT NULL `;
const openClaim = "last.status IN ('open','review')";
const clientTurn = "(last.status='review' AND message.kind='request')";
const teamTurn = `(${openClaim} AND NOT (${clientTurn} IS TRUE))`;
// Taking ownership does not count as a reply. Only a message starts a new turn.
const dueAt = `CASE WHEN ${openClaim} THEN claim_business_due(COALESCE(message.created_at,last.filed_at),
  ${clientTurn} IS TRUE,cal.policy) END`;
const overdue = `(${dueAt} <= ?)`;
const deliveryFields = `l.id,l.name,l.email,l.handed_at,d.handed_day,c.name AS campaign,c.code,c.project,a.name AS client,
  receipt.confirmed_at,confirmer.name AS confirmed_by,last.status AS claim_status,
  CASE WHEN last.status='review' THEN message.kind END AS claim_turn,
  ${dueAt} AS sla_due_at,COALESCE(${overdue},0) AS sla_overdue,COALESCE(cal.version,0) AS calendar_revision`;
const staffFields = `,last.id AS claim_id,${owner} AS assignee_id,
  CASE WHEN ${eligibleSolver} OR last.status IN ('accepted','rejected') THEN solver.name END AS assignee`;
const missing = () => new Failure(404, 'Předaná poptávka nebyla nalezena.');

function requestKey(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) {
    throw new Failure(422, 'Obnovte formulář ' + label + '.');
  }
  return value;
}

export function handoffFeedback({ get, all, run, event, allow, clientName, clock }) {
  const stamp = () => new Date(clock()).toISOString();

  function calendar(actor) {
    allow(actor, 'admin');
    const row = get('SELECT policy,version FROM handoff_calendars WHERE workspace_id=?', actor.workspace_id);
    return row ? { ...JSON.parse(row.policy), version: row.version } : { ...defaultClaimCalendar, version: 0 };
  }

  function scope(actor) {
    if (actor.role === 'client') return [' AND c.client_id=?', [clientName(actor).id]];
    allow(actor, 'admin', 'care');
    if (actor.role === 'care') return [` AND (${leadScope} OR (${owner})=?)`, [actor.id, actor.id]];
    return ['', []];
  }

  const columns = (actor) => deliveryFields + (actor.role === 'client' ? '' : staffFields);
  const actionScope = (actor) => actor.role === 'care'
    ? [` AND ((${owner})=? OR (${owner}) IS NULL)`, [actor.id]]
    : ['', []];

  function hasLeadScope(actor, lead) {
    return actor.role !== 'care' || Boolean(get(`SELECT l.id FROM leads l
      LEFT JOIN users staff ON staff.workspace_id=l.workspace_id AND staff.id=l.owner_id
      WHERE l.workspace_id=? AND l.id=? AND ${leadScope}`, actor.workspace_id, lead, actor.id));
  }

  function delivery(actor, value) {
    const [filter, args] = scope(actor);
    const row = get('SELECT ' + columns(actor) + ' ' + handoffJoin + ' AND l.id=?' + filter, stamp(), actor.workspace_id, id(value), ...args);
    if (!row) throw missing();
    return row;
  }

  function details(actor, lead) {
    const delivered = delivery(actor, lead);
    const team = actor.role !== 'client';
    const staffColumns = team ? ',q.reviewed_by AS reviewer_id,r.name AS reviewer,s.name AS resolver' : '';
    const onlyAssigned = !hasLeadScope(actor, delivered.id);
    const claimScope = onlyAssigned ? ' AND q.id=?' : '';
    const values = [actor.workspace_id, delivered.id, ...(onlyAssigned ? [delivered.claim_id] : [])];
    const claims = all(`SELECT q.id,q.version,q.filed_at,q.reason,q.description,q.status,q.reviewed_at,q.resolved_at,q.resolution,
      f.name AS reporter${staffColumns} FROM handoff_claims q
      JOIN users f ON f.workspace_id=q.workspace_id AND f.id=q.filed_by
      LEFT JOIN users r ON r.workspace_id=q.workspace_id AND r.id=q.reviewed_by
      LEFT JOIN users s ON s.workspace_id=q.workspace_id AND s.id=q.resolved_by
      WHERE q.workspace_id=? AND q.lead_id=?${claimScope} ORDER BY q.id DESC`, ...values);
    const threads = new Map(claims.map((claim) => [claim.id, []]));
    const messages = all(`SELECT m.claim_id,m.id,m.kind,m.body,m.created_at,author.name AS author
      FROM handoff_claim_messages m JOIN handoff_claims q ON q.workspace_id=m.workspace_id AND q.id=m.claim_id
      JOIN users author ON author.workspace_id=m.workspace_id AND author.id=m.author_id
      WHERE q.workspace_id=? AND q.lead_id=?${claimScope} ORDER BY m.id`, ...values);
    for (const { claim_id, ...message } of messages) threads.get(claim_id).push(message);
    const response = { delivery: delivered, claims: claims.map((claim) => ({ ...claim, messages: threads.get(claim.id) })) };
    if (!team) return response;
    const current = claims[0];
    const canAssign = Boolean(current && active(current.status) && (!delivered.assignee_id || delivered.assignee_id === actor.id || actor.role === 'admin'));
    const history = current ? all(`SELECT x.claim_id,x.created_at,x.note,author.name AS actor,
      prior.name AS previous_name,target.name AS assigned_name
      FROM handoff_claim_assignments x
      JOIN handoff_claims q ON q.workspace_id=x.workspace_id AND q.id=x.claim_id
      JOIN users author ON author.workspace_id=x.workspace_id AND author.id=x.actor_id
      LEFT JOIN users prior ON prior.workspace_id=x.workspace_id AND prior.id=x.previous_user
      LEFT JOIN users target ON target.workspace_id=x.workspace_id AND target.id=x.assigned_user
      WHERE q.workspace_id=? AND q.lead_id=?${claimScope} ORDER BY x.id DESC`, ...values) : [];
    const timelines = new Map(claims.map((claim) => [claim.id, []]));
    for (const { claim_id, ...entry } of history) timelines.get(claim_id).push(entry);
    for (const claim of response.claims) claim.assignments = timelines.get(claim.id);
    const candidates = canAssign ? all(`SELECT id,name,role FROM users WHERE workspace_id=? AND enabled=1
      AND role IN ('admin','care') ORDER BY name,id`, actor.workspace_id) : [];
    return { ...response, assignment: { canAssign, candidates } };
  }

  function summary(actor) {
    allow(actor, 'admin', 'care');
    const [filter, args] = scope(actor);
    return get(`SELECT COUNT(*) AS total,COUNT(receipt.lead_id) AS confirmed,
      COUNT(CASE WHEN last.status IN ('open','review') THEN 1 END) AS active ` + handoffJoin + filter, actor.workspace_id, ...args);
  }

  function list(actor, params, condition, status, filterArgs = []) {
    const [filter, args] = scope(actor);
    const requested = params.has('page') ? id(params.get('page')) : 1;
    const checkedAt = stamp();
    const predicate = handoffJoin + filter + ' AND ' + condition;
    const values = [actor.workspace_id, ...args, ...(status === 'overdue' ? [checkedAt] : []), ...filterArgs];
    const { total } = get('SELECT COUNT(*) AS total ' + predicate, ...values);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requested, pages);
    const rows = all('SELECT ' + columns(actor) + ' ' + predicate +
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
    if (params.get('assignee') === 'unassigned') {
      return list(actor, params, filters[status] + ` AND ${openClaim} AND (${owner}) IS NULL`, status);
    }
    return list(actor, params, filters[status], status);
  }

  function attentionCounts(actor) {
    const [filter, args] = scope(actor);
    const checkedAt = stamp();
    const revision = 'COALESCE((SELECT version FROM handoff_calendars WHERE workspace_id=?),0) AS calendarRevision';
    const [actionFilter, actionArgs] = actionScope(actor);
    const counts = actor.role === 'client'
      ? get(`SELECT COUNT(*) AS count,${revision} ${handoffJoin}${filter} AND ${clientTurn}`,
        actor.workspace_id, actor.workspace_id, ...args)
      : get(`SELECT COUNT(CASE WHEN ${teamTurn} THEN 1 END) AS count,
          COUNT(CASE WHEN ${overdue} THEN 1 END) AS overdue,
          COUNT(CASE WHEN ${openClaim} AND (${owner})=? THEN 1 END) AS assigned,${revision}
          ${handoffJoin}${filter}${actionFilter}`,
        checkedAt, actor.id, actor.workspace_id, actor.workspace_id, ...args, ...actionArgs);
    return { ...counts, checkedAt };
  }

  function attention(actor, params) {
    if (params.get('overdue') === '1') {
      allow(actor, 'admin', 'care');
      const [filter, args] = actionScope(actor);
      return list(actor, params, overdue + filter, 'overdue', args);
    }
    if (params.get('assigned') === '1') {
      allow(actor, 'admin', 'care');
      return list(actor, params, `${openClaim} AND (${owner})=?`, 'assigned', [actor.id]);
    }
    const [filter, args] = actionScope(actor);
    return list(actor, params, (actor.role === 'client' ? clientTurn : teamTurn) + filter, 'attention', args);
  }

  function scopedClaim(actor, value) {
    const claim = get(`SELECT last.*,solver.id AS previous_user,${owner} AS assignee_id
      FROM handoff_claims last ${assignmentJoins} WHERE last.workspace_id=? AND last.id=?`, actor.workspace_id, id(value));
    if (!claim) throw missing();
    const delivered = delivery(actor, claim.lead_id);
    if (!hasLeadScope(actor, claim.lead_id) && claim.id !== delivered.claim_id) throw missing();
    return claim;
  }

  function requireAssignee(actor, claim) {
    if (actor.role !== 'admin' && claim.assignee_id !== actor.id) throw new Failure(403, 'Reklamaci musí zpracovat přiřazený řešitel.');
  }

  function mayAssign(actor, claim) {
    if (claim.assignee_id) requireAssignee(actor, claim);
    if (!active(claim.status)) throw new Failure(409, 'Tato reklamace už je vyřízená.');
  }

  function recordAssignment(actor, claim, target, note, key = null) {
    run(`INSERT INTO handoff_claim_assignments (workspace_id,claim_id,actor_id,previous_user,assigned_user,created_at,note,request_key)
      VALUES (?,?,?,?,?,?,?,?)`, actor.workspace_id, claim.id, actor.id, claim.previous_user, target, stamp(), note, key);
    event(actor, target === null ? 'handoff_claim_released' : 'handoff_claim_assigned', 'Reklamace #' + claim.id, claim.lead_id);
  }

  function changeAssignee(actor, claim, target, note, key) {
    recordAssignment(actor, claim, target, note, key);
    run('UPDATE handoff_claims SET version=version+1 WHERE workspace_id=? AND id=?', actor.workspace_id, claim.id);
  }

  function releaseMemberClaims(actor, user) {
    const cases = all(`SELECT last.id,last.lead_id,solver.id AS previous_user
      FROM handoff_claims last ${assignmentJoins}
      WHERE last.workspace_id=? AND ${openClaim} AND solver.id=?`, actor.workspace_id, user);
    for (const claim of cases) changeAssignee(actor, claim, null, 'Účet řešitele byl deaktivován.');
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
    if (claim.status !== 'review') throw new Failure(409, 'Podklady lze doplňovat u reklamace v řešení.');
    if (kind === 'request') requireAssignee(actor, claim);
    const last = get('SELECT id,kind FROM handoff_claim_messages WHERE workspace_id=? AND claim_id=? ORDER BY id DESC LIMIT 1',
      actor.workspace_id, claim.id);
    if (kind !== 'reply' || body.request_id === undefined) verifyVersion(claim, body.version);
    else if (last?.id !== id(body.request_id)) throw new Failure(409, 'Požadavek na podklady se mezitím změnil. Obnovte detail.');
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
    'save-claim-calendar'(actor, body) {
      const existing = calendar(actor);
      const policy = validateClaimCalendar(body);
      if (String(existing.version) !== String(body.version)) {
        throw new Failure(409, 'Kalendář mezitím někdo změnil. Obnovte nastavení a zkontrolujte údaje.');
      }
      run(`INSERT INTO handoff_calendars (workspace_id,policy,version) VALUES (?,?,1)
        ON CONFLICT(workspace_id) DO UPDATE SET policy=excluded.policy,version=handoff_calendars.version+1`,
      actor.workspace_id, JSON.stringify(policy));
      event(actor, 'handoff_calendar_saved');
    },
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
    'assign-handoff-claim'(actor, body) {
      allow(actor, 'admin', 'care');
      const claimId = id(body.id);
      const target = body.assignee === null ? null : id(body.assignee);
      const key = requestKey(body.request_key, 'přiřazení');
      const note = body.note === undefined || typeof body.note === 'string' && !body.note.trim()
        ? '' : text(body.note, 'Poznámka k přiřazení', 500);
      const previous = get(`SELECT actor_id,assigned_user,note FROM handoff_claim_assignments
        WHERE workspace_id=? AND claim_id=? AND request_key=?`, actor.workspace_id, claimId, key);
      if (previous) {
        if (previous.actor_id === actor.id && previous.assigned_user === target && previous.note === note) return;
        throw new Failure(409, 'Toto přiřazení už bylo uloženo s jinými údaji.');
      }
      const claim = scopedClaim(actor, claimId);
      mayAssign(actor, claim);
      verifyVersion(claim, body.version);
      if (target === claim.previous_user) return;
      if (target !== null && !get(`SELECT id FROM users
        WHERE workspace_id=? AND id=? AND enabled=1 AND role IN ('admin','care')`, actor.workspace_id, target)) {
        throw new Failure(422, 'Vyberte aktivního správce nebo člena péče z této organizace.');
      }
      if (claim.assignee_id && !note) throw new Failure(422, 'Uveďte důvod předání.');
      changeAssignee(actor, claim, target, note, key);
    },
    'review-handoff-claim'(actor, body) {
      allow(actor, 'admin', 'care');
      const claim = scopedClaim(actor, body.id);
      mayAssign(actor, claim);
      if (claim.status === 'review' && claim.assignee_id) return;
      verifyVersion(claim, body.version);
      if (!claim.assignee_id) recordAssignment(actor, claim, actor.id, '');
      run(`UPDATE handoff_claims SET status='review',reviewed_by=COALESCE(reviewed_by,?),
        reviewed_at=COALESCE(reviewed_at,?),version=version+1
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
      requireAssignee(actor, claim);
      run(`UPDATE handoff_claims SET status=?,resolved_by=?,resolved_at=?,resolution=?,version=version+1
        WHERE workspace_id=? AND id=?`, body.outcome, actor.id, stamp(), resolution, actor.workspace_id, claim.id);
      event(actor, body.outcome === 'accepted' ? 'handoff_claim_accepted' : 'handoff_claim_rejected', 'Reklamace #' + claim.id, claim.lead_id);
    },
    'request-claim-evidence': (actor, body) => postMessage(actor, body, 'request'),
    'reply-claim-evidence': (actor, body) => postMessage(actor, body, 'reply'),
  };

  return { calendar, details, summary, inbox, attention, attentionCounts, releaseMemberClaims, actions };
}
