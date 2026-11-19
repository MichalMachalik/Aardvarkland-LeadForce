import { clientAccounts, reportDay } from './client-accounts.mjs';
import { claimDeadlineCalculator } from './claim-calendar.mjs';
import { googleAdsStore } from './google-ads-store.mjs';
import { handoffFeedback } from './handoff-feedback.mjs';
import { initializeSchema } from './schema.mjs';
import { amount, campaignCode, csv, Failure, day, email, id, password, text, validToken } from './validation.mjs';

const roles = ['admin', 'marketing', 'agent', 'care', 'investor', 'client'];
const stages = { new: 'Nová', contacted: 'Kontaktována', qualified: 'Kvalifikovaná', handed: 'Předaná', closed: 'Uzavřená' };
const transitions = {
  agent: { new: ['contacted', 'closed'], contacted: ['qualified', 'closed'] },
  care: { qualified: ['handed', 'closed'], handed: ['closed'] },
};
const now = () => new Date().toISOString();
const unauthorized = () => { throw new Failure(403, 'K této akci nemáte oprávnění.'); };
const missing = () => { throw new Failure(404, 'Záznam nebyl nalezen.'); };
const allow = (actor, ...allowed) => { if (!allowed.includes(actor.role)) unauthorized(); };
const uniqueConflict = (error) => error?.errcode === 2067;
const searchText = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const closeReasons = { invalid: 'Neplatný kontakt', duplicate: 'Duplicitní poptávka',
  declined: 'Bez zájmu', completed: 'Zpracováno', other: 'Jiný důvod' };
const dummyPasswords = new WeakMap();

function slug(value) {
  const result = text(value, 'Identifikátor organizace', 48).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new Failure(422, 'Identifikátor používá malá písmena, čísla a spojovník.');
  return result;
}

export function createStore(db, schema, { hash, passwordDigest, passwordMatches, token }, { claimClock = Date.now } = {}) {
  const upgraded = initializeSchema(db, schema);
  db.function('claim_business_due', { deterministic: true }, claimDeadlineCalculator());
  db.function('search_text', { deterministic: true }, searchText);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = (work, begin = 'BEGIN IMMEDIATE') => {
    db.exec(begin);
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  if (!dummyPasswords.has(passwordDigest)) dummyPasswords.set(passwordDigest, passwordDigest(token()));
  const missingPassword = dummyPasswords.get(passwordDigest);
  const event = (actor, action, detail = '', lead = null) =>
    run('INSERT INTO activity (workspace_id,actor_id,lead_id,action,detail,created_at) VALUES (?,?,?,?,?,?)',
      actor.workspace_id, actor.id, lead, action, detail, now());
  const clients = clientAccounts({ get, all, run, event, allow, hash });
  const feedback = handoffFeedback({ get, all, run, event, allow, clientName: clients.clientName, clock: claimClock });
  const googleAds = googleAdsStore({ get, all, run, event, allow, transaction });
  const publicActor = ({ id: userId, name, email: address, role, slug: org, workspace }) =>
    ({ id: userId, name, email: address, role, slug: org, workspace });

  function bootstrap(body) {
    const org = slug(body.slug);
    const name = text(body.workspace, 'Název organizace', 100);
    const owner = text(body.name, 'Jméno správce', 100);
    const address = email(body.email);
    const digest = passwordDigest(password(body.password));
    return transaction(() => {
      if (get('SELECT id FROM workspaces WHERE slug=?', org)) throw new Failure(409, 'Organizace už existuje.');
      const workspace = run('INSERT INTO workspaces (slug,name) VALUES (?,?)', org, name).lastInsertRowid;
      const user = run("INSERT INTO users (workspace_id,email,name,password,role) VALUES (?,?,?,?, 'admin')",
        workspace, address, owner, digest).lastInsertRowid;
      event({ workspace_id: workspace, id: user }, 'workspace_created');
      return { workspace, user, slug: org };
    });
  }

  function createSession(userId) {
    const raw = token();
    const csrf = token();
    const until = Date.now() + 8 * 60 * 60 * 1000;
    transaction(() => {
      run('DELETE FROM sessions WHERE expires <= ?', Date.now());
      run('INSERT INTO sessions VALUES (?,?,?,?)', hash(raw), userId, csrf, until);
    });
    return raw;
  }

  function signIn(body) {
    const org = slug(body.slug);
    const address = email(body.email);
    const secret = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
    const user = get('SELECT u.* FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE w.slug=? AND u.email=?', org, address);
    const matches = passwordMatches(secret, user?.password ?? missingPassword);
    if (!matches || !user?.enabled) throw new Failure(401, 'Organizace, e-mail nebo heslo nesouhlasí.');
    return createSession(user.id);
  }

  function session(raw) {
    if (!validToken(raw)) return undefined;
    return get('SELECT u.id,u.name,u.email,u.role,u.workspace_id,w.slug,w.name AS workspace,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token_hash=? AND s.expires>? AND u.enabled=1',
      hash(raw), Date.now());
  }

  function signOut(raw) {
    if (validToken(raw)) run('DELETE FROM sessions WHERE token_hash=?', hash(raw));
  }

  function changePassword(actor, body) {
    const old = password(body.current);
    const next = password(body.next);
    const row = get('SELECT password FROM users WHERE id=? AND workspace_id=? AND enabled=1', actor.id, actor.workspace_id);
    if (!row || !passwordMatches(old, row.password)) throw new Failure(422, 'Aktuální heslo nesouhlasí.');
    const digest = passwordDigest(next);
    transaction(() => {
      const saved = run('UPDATE users SET password=? WHERE workspace_id=? AND id=? AND enabled=1 AND password=?',
        digest, actor.workspace_id, actor.id, row.password);
      if (!saved.changes) throw new Failure(409, 'Účet se mezitím změnil. Přihlaste se znovu.');
      run('DELETE FROM sessions WHERE user_id=?', actor.id);
      run('DELETE FROM password_recoveries WHERE workspace_id=? AND user_id=?', actor.workspace_id, actor.id);
      event(actor, 'password_changed');
    });
    return createSession(actor.id);
  }

  function redeemRecovery(body) {
    if (!validToken(body.token)) throw new Failure(422, 'Odkaz pro obnovu je neplatný.');
    const key = hash(body.token);
    const recovery = () => get(`SELECT r.workspace_id,r.user_id FROM password_recoveries r
      JOIN users u ON u.workspace_id=r.workspace_id AND u.id=r.user_id
      WHERE r.token_hash=? AND r.expires>? AND u.enabled=1`, key, Date.now());
    if (!recovery()) throw new Failure(404, 'Odkaz pro obnovu vypršel nebo již byl použit.');
    const digest = passwordDigest(password(body.password));
    const userId = transaction(() => {
      const row = recovery();
      if (!row) throw new Failure(404, 'Odkaz pro obnovu vypršel nebo již byl použit.');
      run('UPDATE users SET password=? WHERE workspace_id=? AND id=?', digest, row.workspace_id, row.user_id);
      run('DELETE FROM sessions WHERE user_id=?', row.user_id);
      run('DELETE FROM password_recoveries WHERE token_hash=?', key);
      event({ workspace_id: row.workspace_id, id: row.user_id }, 'password_recovered');
      return row.user_id;
    });
    return createSession(userId);
  }

  function claimInvite(body) {
    if (!validToken(body.token)) throw new Failure(422, 'Pozvánka je neplatná.');
    const invitation = () => get('SELECT * FROM invitations WHERE token_hash=? AND expires>? AND used=0', hash(body.token), Date.now());
    const initial = invitation();
    if (!initial) throw new Failure(404, 'Pozvánka vypršela nebo již byla použita.');
    const name = text(body.name, 'Jméno', 100);
    const digest = passwordDigest(password(body.password));
    const userId = transaction(() => {
      const row = invitation();
      if (!row) throw new Failure(404, 'Pozvánka vypršela nebo již byla použita.');
      const user = run('INSERT INTO users (workspace_id,email,name,password,role) VALUES (?,?,?,?,?)',
        row.workspace_id, row.email, name, digest, row.role).lastInsertRowid;
      if (row.role === 'client') {
        const client = get('SELECT client_id FROM client_invitations WHERE workspace_id=? AND token_hash=?', row.workspace_id, row.token_hash);
        if (!client) throw new Failure(404, 'Klientská pozvánka už není dostupná.');
        run('INSERT INTO client_users (workspace_id,user_id,client_id) VALUES (?,?,?)', row.workspace_id, user, client.client_id);
      }
      if (row.lead_id !== null) {
        const linked = run("UPDATE leads SET investor_id=?,version=version+1 WHERE id=? AND workspace_id=? AND email=? AND stage='handed' AND investor_id IS NULL",
          user, row.lead_id, row.workspace_id, row.email);
        if (!linked.changes) throw new Failure(409, 'Poptávka už pro tuto pozvánku není dostupná.');
        event({ workspace_id: row.workspace_id, id: user }, 'investor_linked', '', row.lead_id);
      }
      run('UPDATE invitations SET used=1 WHERE token_hash=?', row.token_hash);
      event({ workspace_id: row.workspace_id, id: user }, 'invite_accepted', row.role);
      return user;
    });
    return createSession(userId);
  }

  function member(actor, value, ...allowed) {
    const row = get('SELECT id,role,name,enabled FROM users WHERE workspace_id=? AND id=?', actor.workspace_id, id(value));
    if (!row || !row.enabled || !allowed.includes(row.role)) throw new Failure(422, 'Vyberte aktivního uživatele s odpovídající rolí.');
    return row;
  }

  function leadScope(actor) {
    if (actor.role === 'agent') return ['AND (l.owner_id=? OR l.owner_id IS NULL) AND l.stage<>?', [actor.id, 'handed']];
    if (actor.role === 'care') return ["AND (l.owner_id=? OR (l.stage='qualified' AND u.role='agent') OR (l.owner_id IS NULL AND l.stage IN ('qualified','handed')))", [actor.id]];
    return ['', []];
  }

  function leadRows(actor, leadId) {
    allow(actor, 'admin', 'marketing', 'agent', 'care');
    const [scope, args] = leadScope(actor);
    const tail = leadId ? ' AND l.id=?' : ' ORDER BY l.id DESC LIMIT 500';
    const fields = actor.role === 'marketing'
      ? 'l.id,l.project,l.source,l.campaign,l.stage,l.created_at,l.handed_at'
      : 'l.*,u.name AS owner,u.role AS owner_role';
    return all('SELECT ' + fields + ' FROM leads l LEFT JOIN users u ON u.id=l.owner_id AND u.workspace_id=l.workspace_id WHERE l.workspace_id=? ' + scope + tail,
      actor.workspace_id, ...args, ...(leadId ? [leadId] : []));
  }

  function leadQueue(actor, query) {
    allow(actor, 'admin', 'marketing', 'agent', 'care');
    const pageSize = 30;
    const page = query.has('page') ? id(query.get('page')) : 1;
    const stage = query.get('stage') || '';
    if (stage && !Object.hasOwn(stages, stage)) throw new Failure(422, 'Vyberte platný stav poptávky.');
    const raw = query.get('q') ?? '';
    if (raw.length > 160) throw new Failure(422, 'Hledaný text může mít nejvýše 160 znaků.');
    const [scope, scopeArgs] = leadScope(actor);
    const marketing = actor.role === 'marketing';
    const search = "l.project || ' ' || l.campaign || ' ' || l.source || ' CRM-' || l.id" +
      (marketing ? '' : " || ' ' || l.name || ' ' || l.email");
    const predicate = `FROM leads l LEFT JOIN users u ON u.id=l.owner_id AND u.workspace_id=l.workspace_id
      WHERE l.workspace_id=? ${scope}${stage ? ' AND l.stage=?' : ''}${raw.trim() ? ` AND instr(search_text(${search}),?)>0` : ''}`;
    const args = [actor.workspace_id, ...scopeArgs, ...(stage ? [stage] : []), ...(raw.trim() ? [searchText(raw)] : [])];
    const { total } = get('SELECT COUNT(*) AS total ' + predicate, ...args);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(page, pages);
    const visible = 'l.id,l.project,l.source,l.campaign,l.stage' + (marketing ? '' : ',l.name,u.name AS owner');
    const rows = all('SELECT ' + visible + ' ' + predicate + ' ORDER BY l.id DESC LIMIT ? OFFSET ?', ...args, pageSize, (current - 1) * pageSize);
    return { rows, page: current, pages, total };
  }

  function leadDetail(actor, value) {
    allow(actor, 'admin', 'agent', 'care');
    const lead = leadRows(actor, id(value))[0];
    if (!lead) missing();
    const notes = all('SELECT n.id,n.body,n.created_at,u.name AS author FROM notes n JOIN users u ON u.id=n.author_id WHERE n.workspace_id=? AND n.lead_id=? ORDER BY n.id DESC LIMIT 200', actor.workspace_id, lead.id);
    const activity = all('SELECT a.action,a.detail,a.created_at,u.name AS actor FROM activity a JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? AND a.lead_id=? ORDER BY a.id DESC LIMIT 200', actor.workspace_id, lead.id);
    const campaign = get(`SELECT c.id,c.name,a.name AS client FROM client_leads d
      JOIN client_campaigns c ON c.workspace_id=d.workspace_id AND c.id=d.campaign_id
      JOIN clients a ON a.workspace_id=c.workspace_id AND a.id=c.client_id
      WHERE d.workspace_id=? AND d.lead_id=?`, actor.workspace_id, lead.id);
    return { lead, notes, activity, campaign, recipients: noteRecipients(actor, lead) };
  }

  function noteRecipients(actor, lead) {
    if (actor.role !== 'admin' && lead.owner_id !== actor.id) return [];
    const candidates = all(`SELECT id,name,role FROM users WHERE workspace_id=? AND enabled=1 AND id<>?
      AND (role='admin' OR id=? OR (role='care' AND ?='qualified')) ORDER BY name`,
    actor.workspace_id, actor.id, lead.owner_id, lead.stage);
    return candidates.filter((candidate) => leadRows({ ...candidate, workspace_id: actor.workspace_id }, lead.id).length > 0)
      .map(({ id, name }) => ({ id, name }));
  }

  function notify(actor, target, lead, kind) {
    if (target === actor.id) return;
    run('INSERT INTO notifications (workspace_id,user_id,actor_id,lead_id,kind,created_at) VALUES (?,?,?,?,?,?)',
      actor.workspace_id, target, actor.id, lead, kind, now());
  }

  function notifications(actor, notificationId) {
    const [scope, args] = leadScope(actor);
    const extra = notificationId ? ' AND n.id=?' : ' ORDER BY n.read_at IS NOT NULL,n.id DESC LIMIT 100';
    return all(`SELECT n.id,n.lead_id,n.kind,n.created_at,n.read_at,l.project,a.name AS actor
      FROM notifications n JOIN leads l ON l.id=n.lead_id AND l.workspace_id=n.workspace_id
      JOIN users a ON a.id=n.actor_id
      LEFT JOIN users u ON u.id=l.owner_id AND u.workspace_id=l.workspace_id
      WHERE n.workspace_id=? AND n.user_id=? ` + scope + extra,
    actor.workspace_id, actor.id, ...args, ...(notificationId ? [notificationId] : []));
  }

  function ownedLead(actor, value) {
    const row = leadRows(actor, id(value))[0];
    if (!row) missing();
    if (actor.role !== 'admin' && row.owner_id !== actor.id) unauthorized();
    return row;
  }

  function makeInvite(actor, address, role, lead = null, client = null) {
    const raw = token();
    run('DELETE FROM invitations WHERE workspace_id=? AND email=? AND used=0', actor.workspace_id, address);
    run('INSERT INTO invitations (token_hash,workspace_id,email,role,expires,lead_id) VALUES (?,?,?,?,?,?)',
      hash(raw), actor.workspace_id, address, role, Date.now() + 24 * 60 * 60 * 1000, lead);
    if (client) run('INSERT INTO client_invitations (workspace_id,token_hash,client_id) VALUES (?,?,?)', actor.workspace_id, hash(raw), client);
    event(actor, 'invite_created', role, lead);
    return { invite: raw };
  }

  const messageRevision = (row) => hash(JSON.stringify([row.investor_id, row.author_id, row.created_at, row.title, row.body]));

  function investorMessages(actor) {
    const investor = actor.role === 'investor';
    const columns = investor ? 'm.id,m.title,m.body,m.published_at,m.read_at'
      : 'm.*,u.name AS investor';
    const filter = investor ? ' AND m.investor_id=? AND m.published_at IS NOT NULL' : '';
    return all(`SELECT ${columns},
      (SELECT COUNT(*) FROM investor_message_replies r WHERE r.workspace_id=m.workspace_id AND r.message_id=m.id
        AND r.read_at IS NULL AND r.author_id ${investor ? '<>' : '='} m.investor_id) AS unread_replies
      FROM messages m JOIN users u ON u.id=m.investor_id AND u.workspace_id=m.workspace_id
      WHERE m.workspace_id=?${filter} ORDER BY ${investor ? 'm.published_at DESC,' : ''}m.id DESC`,
    actor.workspace_id, ...(investor ? [actor.id] : [])).map((row) => investor || row.published_at ? row : { ...row, revision: messageRevision(row) });
  }

  function accessibleMessage(actor, value) {
    allow(actor, 'admin', 'care', 'investor');
    const row = get('SELECT * FROM messages WHERE workspace_id=? AND id=?', actor.workspace_id, id(value));
    if (!row || actor.role === 'investor' && (row.investor_id !== actor.id || !row.published_at)) missing();
    return row;
  }

  function investorThread(actor, value) {
    const message = accessibleMessage(actor, value);
    const investor = actor.role === 'investor';
    return { replies: all(`SELECT r.id,r.body,r.created_at,u.name AS author,
      r.read_at IS NULL AND r.author_id ${investor ? '<>' : '='} ? AS unread FROM investor_message_replies r
      JOIN users u ON u.workspace_id=r.workspace_id AND u.id=r.author_id
      WHERE r.workspace_id=? AND r.message_id=? ORDER BY r.id`, message.investor_id, actor.workspace_id, message.id) };
  }

  function readThread(actor, value, through) {
    const row = accessibleMessage(actor, value);
    if (!row.published_at) missing();
    const investor = actor.role === 'investor';
    const timestamp = now();
    if (investor && !row.read_at) run('UPDATE messages SET read_at=? WHERE workspace_id=? AND id=?', timestamp, actor.workspace_id, row.id);
    if (through !== undefined) run(`UPDATE investor_message_replies SET read_at=? WHERE workspace_id=? AND message_id=?
      AND id<=? AND read_at IS NULL AND author_id ${investor ? '<>' : '='} ?`, timestamp, actor.workspace_id, row.id, id(through), row.investor_id);
  }

  function editableMessage(actor, body) {
    allow(actor, 'admin', 'care');
    const row = accessibleMessage(actor, body.id);
    if (row.published_at || messageRevision(row) !== body.revision) {
      throw new Failure(409, 'Koncept se mezitím změnil nebo byl zveřejněn. Obnovte seznam.');
    }
    return row;
  }

  function state(actor) {
    const { workspace_id: org, id: userId, role } = actor;
    const base = { user: publicActor(actor), csrf: actor.csrf };
    if (role === 'client') return { ...base, client: clients.clientName(actor).name, handoffAttention: feedback.attentionCounts(actor).count };
    if (role === 'investor') return {
      ...base,
      positions: all('SELECT id,project,principal_cents,maturity,status FROM positions WHERE workspace_id=? AND investor_id=? ORDER BY maturity', org, userId),
      messages: investorMessages(actor),
    };
    const leads = leadRows(actor);
    const [scope, args] = leadScope(actor);
    const stagesInScope = all('SELECT l.stage,count(*) AS total FROM leads l LEFT JOIN users u ON u.id=l.owner_id AND u.workspace_id=l.workspace_id WHERE l.workspace_id=? ' + scope + ' GROUP BY l.stage', org, ...args);
    const result = { ...base, leads, stages: stagesInScope };
    if (role === 'admin') result.claimCalendar = feedback.calendar(actor);
    if (role === 'admin' || role === 'marketing') {
      result.clientManagement = clients.management(actor);
      result.googleAds = googleAds.management(actor);
    }
    if (role === 'marketing') return result;
    result.notifications = notifications(actor);
    result.tasks = all('SELECT t.*,l.name AS lead,u.name AS owner FROM tasks t JOIN leads l ON l.id=t.lead_id JOIN users u ON u.id=t.owner_id WHERE t.workspace_id=? AND (?=1 OR t.owner_id=?) ORDER BY t.done_at IS NOT NULL,t.due,t.id LIMIT 500',
      org, role === 'admin' ? 1 : 0, userId);
    if (role === 'admin' || role === 'care') {
      result.handoffSummary = feedback.summary(actor);
      const { count, overdue, assigned } = feedback.attentionCounts(actor);
      result.handoffAttention = count;
      result.handoffEscalations = overdue;
      result.handoffAssigned = assigned;
      result.investors = all("SELECT id,name,email FROM users WHERE workspace_id=? AND role='investor' AND enabled=1 ORDER BY name", org);
      result.positions = all('SELECT p.*,u.name AS investor FROM positions p JOIN users u ON u.id=p.investor_id WHERE p.workspace_id=? ORDER BY p.id DESC LIMIT 500', org);
      result.messages = investorMessages(actor);
    }
    if (role === 'admin') {
      result.users = all(`SELECT u.id,u.name,u.email,u.role,u.enabled,c.name AS client FROM users u
        LEFT JOIN client_users m ON m.workspace_id=u.workspace_id AND m.user_id=u.id
        LEFT JOIN clients c ON c.workspace_id=m.workspace_id AND c.id=m.client_id
        WHERE u.workspace_id=? ORDER BY u.enabled DESC,u.name`, org);
      result.invitations = all(`SELECT substr(i.token_hash,1,24) AS id,i.email,i.role,i.expires,c.name AS client
        FROM invitations i LEFT JOIN client_invitations m ON m.workspace_id=i.workspace_id AND m.token_hash=i.token_hash
        LEFT JOIN clients c ON c.workspace_id=m.workspace_id AND c.id=m.client_id
        WHERE i.workspace_id=? AND i.used=0 AND i.expires>? ORDER BY i.expires DESC`, org, Date.now());
      result.activity = all('SELECT a.action,a.detail,a.lead_id,a.created_at,u.name AS actor FROM activity a JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT 100', org);
    }
    return result;
  }

  const actions = {
    ...clients.actions,
    ...feedback.actions,
    'configure-google-ads': googleAds.configure,
    'create-lead'(actor, body) {
      allow(actor, 'admin', 'marketing');
      const name = text(body.name, 'Jméno', 120);
      const address = email(body.email);
      const managed = body.client_campaign ? clients.campaign(actor, body.client_campaign) : null;
      const project = managed?.project ?? text(body.project, 'Projekt');
      const source = managed?.source ?? text(body.source, 'Kanál', 65);
      const campaign = managed?.code ?? campaignCode(body.campaign);
      const { lastInsertRowid } = run('INSERT INTO leads (workspace_id,name,email,project,source,campaign,created_at) VALUES (?,?,?,?,?,?,?)',
        actor.workspace_id, name, address, project, source, campaign, now());
      if (managed) run('INSERT INTO client_leads (workspace_id,lead_id,campaign_id) VALUES (?,?,?)', actor.workspace_id, lastInsertRowid, managed.id);
      event(actor, 'lead_created', '', lastInsertRowid);
      return { id: lastInsertRowid };
    },
    'attach-campaign'(actor, body) {
      allow(actor, 'admin');
      const lead = ownedLead(actor, body.id);
      if (lead.handed_at || lead.stage === 'closed') throw new Failure(409, 'Kampaň lze změnit pouze před předáním nebo uzavřením.');
      const campaign = clients.campaign(actor, body.campaign);
      updateLead(actor, lead, body.version, 'project=?,source=?,campaign=?', campaign.project, campaign.source, campaign.code);
      run(`INSERT INTO client_leads (workspace_id,lead_id,campaign_id) VALUES (?,?,?)
        ON CONFLICT(workspace_id,lead_id) DO UPDATE SET campaign_id=excluded.campaign_id`, actor.workspace_id, lead.id, campaign.id);
      event(actor, 'campaign_attached', campaign.name + ' · ' + campaign.code, lead.id);
    },
    'edit-lead-contact'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const lead = ownedLead(actor, body.id);
      if (lead.stage === 'closed') throw new Failure(409, 'Uzavřená poptávka je v historii.');
      const name = text(body.name, 'Jméno', 120);
      const address = email(body.email);
      if (lead.investor_id && address !== lead.email) {
        throw new Failure(409, 'Poptávka už má propojený účet investora. E-mail jeho účtu zůstává svázaný s předáním.');
      }
      updateLead(actor, lead, body.version, 'name=?,email=?', name, address);
      if (address !== lead.email) run('DELETE FROM invitations WHERE workspace_id=? AND lead_id=? AND used=0', actor.workspace_id, lead.id);
      event(actor, 'lead_contact_updated', '', lead.id);
    },
    'assign'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const row = leadRows(actor, id(body.id))[0];
      if (!row) missing();
      if (row.stage === 'closed') throw new Failure(409, 'Uzavřenou poptávku nelze přiřadit.');
      const targetRole = ['qualified', 'handed'].includes(row.stage) ? 'care' : 'agent';
      const target = actor.role === 'admin' ? member(actor, body.owner, targetRole).id : actor.id;
      if (actor.role !== 'admin' && (actor.role !== targetRole || (row.owner_id && !(actor.role === 'care' && row.owner_role === 'agent')))) unauthorized();
      updateLead(actor, row, body.version, "owner_id=?", target);
      run('UPDATE tasks SET owner_id=? WHERE workspace_id=? AND lead_id=? AND done_at IS NULL', target, actor.workspace_id, row.id);
      event(actor, 'lead_assigned', 'ID ' + target, row.id);
      notify(actor, target, row.id, 'assignment');
    },
    'change-stage'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const row = ownedLead(actor, body.id);
      const allowed = actor.role === 'admin' ? (transitions.agent[row.stage] || transitions.care[row.stage] || []) : (transitions[actor.role][row.stage] || []);
      if (!allowed.includes(body.stage)) throw new Failure(409, 'Tato změna stavu v aktuální fázi není dostupná.');
      if (body.stage === 'handed' && row.owner_role !== 'care') throw new Failure(409, 'Před předáním přiřaďte odpovědného člověka z péče.');
      const reason = body.stage === 'closed' && body.reason != null ? closeReasons[body.reason] : null;
      if (body.stage === 'closed' && body.reason != null && !Object.hasOwn(closeReasons, body.reason)) {
        throw new Failure(422, 'Vyberte důvod uzavření.');
      }
      const handedAt = body.stage === 'handed' ? now() : row.handed_at;
      updateLead(actor, row, body.version, 'stage=?, handed_at=?', body.stage, handedAt);
      if (body.stage === 'handed') {
        run('UPDATE client_leads SET handed_day=? WHERE workspace_id=? AND lead_id=?', reportDay(new Date(handedAt)), actor.workspace_id, row.id);
      }
      if (body.stage === 'closed') run('DELETE FROM invitations WHERE workspace_id=? AND lead_id=? AND used=0', actor.workspace_id, row.id);
      event(actor, 'stage_changed', stages[row.stage] + ' → ' + stages[body.stage] + (reason ? ' · ' + reason : ''), row.id);
    },
    'add-note'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const row = ownedLead(actor, body.id);
      const recipient = body.recipient ? id(body.recipient) : null;
      if (recipient && !noteRecipients(actor, row).some((item) => item.id === recipient)) unauthorized();
      run('INSERT INTO notes (workspace_id,lead_id,author_id,body,created_at) VALUES (?,?,?,?,?)',
        actor.workspace_id, row.id, actor.id, text(body.body, 'Poznámka', 4000), now());
      event(actor, 'note_added', '', row.id);
      if (recipient) notify(actor, recipient, row.id, 'note');
    },
    'read-notification'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const [item] = notifications(actor, id(body.id));
      if (!item) missing();
      if (item.read_at) return;
      run('UPDATE notifications SET read_at=? WHERE workspace_id=? AND user_id=? AND id=?',
        now(), actor.workspace_id, actor.id, item.id);
    },
    'add-task'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const row = ownedLead(actor, body.id);
      run('INSERT INTO tasks (workspace_id,lead_id,owner_id,title,due) VALUES (?,?,?,?,?)',
        actor.workspace_id, row.id, row.owner_id ?? actor.id, text(body.title, 'Úkol', 160), day(body.due));
      event(actor, 'task_added', '', row.id);
    },
    'complete-task'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const row = get('SELECT id,lead_id,done_at FROM tasks WHERE workspace_id=? AND id=? AND (?=1 OR owner_id=?)',
        actor.workspace_id, id(body.id), actor.role === 'admin' ? 1 : 0, actor.id);
      if (!row) missing();
      if (row.done_at) return;
      run('UPDATE tasks SET done_at=? WHERE workspace_id=? AND id=?', now(), actor.workspace_id, row.id);
      event(actor, 'task_done', '', row.lead_id);
    },
    'reopen-task'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const row = get('SELECT id,lead_id,done_at FROM tasks WHERE workspace_id=? AND id=? AND (?=1 OR owner_id=?)',
        actor.workspace_id, id(body.id), Number(actor.role === 'admin'), actor.id);
      if (!row) missing();
      if (!row.done_at) return;
      run('UPDATE tasks SET done_at=NULL WHERE workspace_id=? AND id=?', actor.workspace_id, row.id);
      event(actor, 'task_reopened', '', row.lead_id);
    },
    'edit-task'(actor, body) {
      allow(actor, 'admin', 'agent', 'care');
      const row = get('SELECT id,lead_id,title,due,done_at FROM tasks WHERE workspace_id=? AND id=? AND (?=1 OR owner_id=?)',
        actor.workspace_id, id(body.id), Number(actor.role === 'admin'), actor.id);
      if (!row) missing();
      if (row.done_at || row.title !== body.previousTitle || row.due !== body.previousDue) {
        throw new Failure(409, 'Úkol se mezitím změnil. Obnovte přehled.');
      }
      run('UPDATE tasks SET title=?,due=? WHERE workspace_id=? AND id=?',
        text(body.title, 'Úkol', 160), day(body.due), actor.workspace_id, row.id);
      event(actor, 'task_updated', '', row.lead_id);
    },
    'invite'(actor, body) {
      allow(actor, 'admin');
      const address = email(body.email);
      if (!roles.includes(body.role)) throw new Failure(422, 'Vyberte roli.');
      if (get('SELECT id FROM users WHERE workspace_id=? AND email=?', actor.workspace_id, address)) throw new Failure(409, 'Tento e-mail již má účet.');
      const client = body.role === 'client' ? clients.requireClient(actor, body.client).id : null;
      return makeInvite(actor, address, body.role, null, client);
    },
    'revoke-invitation'(actor, body) {
      allow(actor, 'admin');
      if (typeof body.id !== 'string' || !/^[a-f0-9]{24}$/.test(body.id)) throw new Failure(422, 'Neplatná pozvánka.');
      const saved = run('DELETE FROM invitations WHERE workspace_id=? AND used=0 AND substr(token_hash,1,24)=?', actor.workspace_id, body.id);
      if (!saved.changes) missing();
      event(actor, 'invite_revoked');
    },
    'issue-password-recovery'(actor, body) {
      allow(actor, 'admin');
      const target = member(actor, body.id, ...roles);
      const raw = token();
      run(`INSERT INTO password_recoveries (workspace_id,user_id,token_hash,expires) VALUES (?,?,?,?)
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET token_hash=excluded.token_hash,expires=excluded.expires`,
      actor.workspace_id, target.id, hash(raw), Date.now() + 30 * 60_000);
      event(actor, 'password_recovery_issued', 'ID ' + target.id);
      return { recovery: raw };
    },
    'link-investor'(actor, body) {
      allow(actor, 'admin', 'care');
      const row = ownedLead(actor, body.id);
      if (row.stage !== 'handed' || row.investor_id) throw new Failure(409, 'Pozvánka je dostupná pro předanou poptávku bez účtu investora.');
      const existing = get('SELECT id,role,enabled FROM users WHERE workspace_id=? AND email=?', actor.workspace_id, row.email);
      if (existing) {
        if (existing.role !== 'investor' || !existing.enabled) throw new Failure(409, 'E-mail patří k účtu, který nelze použít jako aktivního investora.');
        updateLead(actor, row, body.version, 'investor_id=?', existing.id);
        event(actor, 'investor_linked', '', row.id);
        return {};
      }
      if (row.version !== id(body.version)) throw new Failure(409, 'Obnovte poptávku před vytvořením pozvánky.');
      return makeInvite(actor, row.email, 'investor', row.id);
    },
    'user-status'(actor, body) {
      allow(actor, 'admin');
      const target = id(body.id);
      if (target === actor.id) throw new Failure(409, 'Svůj vlastní účet zde nemůžete deaktivovat.');
      if (typeof body.enabled !== 'boolean') throw new Failure(422, 'Neplatný stav účtu.');
      const row = get('SELECT id,role,enabled FROM users WHERE workspace_id=? AND id=?', actor.workspace_id, target);
      if (!row) missing();
      if (Boolean(row.enabled) === body.enabled) return;
      run('UPDATE users SET enabled=? WHERE workspace_id=? AND id=?', Number(body.enabled), actor.workspace_id, row.id);
      if (!body.enabled) {
        run('DELETE FROM sessions WHERE user_id=?', row.id);
        run('DELETE FROM password_recoveries WHERE workspace_id=? AND user_id=?', actor.workspace_id, row.id);
        run("UPDATE leads SET owner_id=NULL,version=version+1 WHERE workspace_id=? AND owner_id=? AND stage<>'closed'", actor.workspace_id, row.id);
        run('UPDATE tasks SET owner_id=? WHERE workspace_id=? AND owner_id=? AND done_at IS NULL', actor.id, actor.workspace_id, row.id);
        feedback.releaseMemberClaims(actor, row.id);
      }
      event(actor, body.enabled ? 'user_activated' : 'user_disabled', 'ID ' + row.id);
    },
    'add-position'(actor, body) {
      allow(actor, 'admin', 'care');
      const investor = member(actor, body.investor, 'investor');
      run("INSERT INTO positions (workspace_id,investor_id,project,principal_cents,maturity,status) VALUES (?,?,?,?,?,'active')",
        actor.workspace_id, investor.id, text(body.project, 'Projekt'), amount(body.principal), day(body.maturity));
      event(actor, 'position_created', 'Investor ID ' + investor.id);
    },
    'close-position'(actor, body) {
      allow(actor, 'admin', 'care');
      const row = get('SELECT id,status FROM positions WHERE workspace_id=? AND id=?', actor.workspace_id, id(body.id));
      if (!row) missing();
      if (row.status === 'closed') return;
      run("UPDATE positions SET status='closed' WHERE workspace_id=? AND id=?", actor.workspace_id, row.id);
      event(actor, 'position_closed', 'Pozice ID ' + row.id);
    },
    'draft-message'(actor, body) {
      allow(actor, 'admin', 'care');
      const investor = member(actor, body.investor, 'investor');
      const message = run('INSERT INTO messages (workspace_id,investor_id,author_id,title,body,created_at) VALUES (?,?,?,?,?,?)',
        actor.workspace_id, investor.id, actor.id, text(body.title, 'Předmět', 160), text(body.body, 'Zpráva', 6000), now());
      event(actor, 'message_drafted', 'ID ' + message.lastInsertRowid);
      return { id: message.lastInsertRowid };
    },
    'edit-message-draft'(actor, body) {
      const row = editableMessage(actor, body);
      const investor = member(actor, body.investor, 'investor');
      run('UPDATE messages SET investor_id=?,title=?,body=? WHERE workspace_id=? AND id=?',
        investor.id, text(body.title, 'Předmět', 160), text(body.body, 'Zpráva', 6000), actor.workspace_id, row.id);
      event(actor, 'message_draft_updated', 'ID ' + row.id);
    },
    'discard-message-draft'(actor, body) {
      const row = editableMessage(actor, body);
      run('DELETE FROM messages WHERE workspace_id=? AND id=?', actor.workspace_id, row.id);
      event(actor, 'message_draft_discarded', 'ID ' + row.id);
    },
    'publish-message'(actor, body) {
      allow(actor, 'admin', 'care');
      const row = accessibleMessage(actor, body.id);
      if (row.published_at) return;
      if (body.revision !== undefined && body.revision !== messageRevision(row)) {
        throw new Failure(409, 'Koncept se mezitím změnil. Obnovte seznam.');
      }
      member(actor, row.investor_id, 'investor');
      run('UPDATE messages SET published_at=? WHERE workspace_id=? AND id=?', now(), actor.workspace_id, row.id);
      event(actor, 'message_published', 'ID ' + row.id);
    },
    'read-message'(actor, body) {
      allow(actor, 'investor');
      readThread(actor, body.id);
    },
    'read-investor-thread'(actor, body) {
      readThread(actor, body.id, body.through);
    },
    'reply-investor-message'(actor, body) {
      const row = accessibleMessage(actor, body.id);
      if (!row.published_at) missing();
      const reply = text(body.reply, 'Odpověď', 4000);
      if (typeof body.request_key !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.request_key)) {
        throw new Failure(422, 'Obnovte formulář odpovědi.');
      }
      const prior = get(`SELECT id,author_id,body FROM investor_message_replies
        WHERE workspace_id=? AND message_id=? AND request_key=?`, actor.workspace_id, row.id, body.request_key);
      if (prior) {
        if (prior.body === reply && prior.author_id === actor.id) return { id: prior.id };
        throw new Failure(409, 'Tato odpověď už byla uložena s jinými údaji.');
      }
      member(actor, row.investor_id, 'investor');
      const { lastInsertRowid } = run(`INSERT INTO investor_message_replies
        (workspace_id,message_id,author_id,request_key,body,created_at) VALUES (?,?,?,?,?,?)`,
      actor.workspace_id, row.id, actor.id, body.request_key, reply, now());
      event(actor, 'investor_reply_added', 'ID ' + row.id);
      return { id: lastInsertRowid };
    },
  };

  function updateLead(actor, row, version, fields, ...values) {
    const result = run('UPDATE leads SET ' + fields + ',version=version+1 WHERE workspace_id=? AND id=? AND version=?',
      ...values, actor.workspace_id, row.id, id(version));
    if (!result.changes) throw new Failure(409, 'Poptávku mezitím někdo změnil. Obnovte ji a zkuste to znovu.');
  }

  function command(actor, action, body) {
    if (!Object.hasOwn(actions, action)) missing();
    try {
      return transaction(() => actions[action](actor, body)) ?? {};
    } catch (error) {
      if (uniqueConflict(error)) throw new Failure(409, 'Takový záznam už v organizaci existuje.');
      throw error;
    }
  }

  function exportLeads(actor) {
    allow(actor, 'admin', 'marketing');
    const rows = all('SELECT id,created_at,source,campaign,stage,handed_at FROM leads WHERE workspace_id=? ORDER BY id', actor.workspace_id);
    return csv([
      ['lead_id', 'created_date', 'source', 'campaign_id', 'status', 'handed_off_date'],
      ...rows.map((row) => ['CRM-' + row.id, reportDay(new Date(row.created_at)), row.source, row.campaign,
        row.handed_at ? stages.qualified : stages[row.stage], row.handed_at ? reportDay(new Date(row.handed_at)) : null]),
    ]);
  }

  function exportPortfolio(actor) {
    allow(actor, 'investor');
    const rows = all('SELECT project,principal_cents,maturity,status FROM positions WHERE workspace_id=? AND investor_id=? ORDER BY maturity,id',
      actor.workspace_id, actor.id);
    return csv([['projekt', 'kapital_czk', 'splatnost', 'stav'], ...rows.map((row) => [
      row.project, (row.principal_cents / 100).toFixed(2).replace('.', ','), row.maturity, row.status === 'active' ? 'Aktivní' : 'Splacená',
    ])]);
  }

  return { upgraded, bootstrap, signIn, signOut, session, changePassword, claimInvite, redeemRecovery, state, leadDetail, command,
    ready: () => { get('SELECT id FROM workspaces LIMIT 1'); return true; },
    leadQueue: (...args) => transaction(() => leadQueue(...args), 'BEGIN'),
    investorThread: (...args) => transaction(() => investorThread(...args), 'BEGIN'),
    monthlyReports: (...args) => transaction(() => clients.monthlyReports(...args), 'BEGIN'),
    monthlyReport: clients.monthlyReport,
    exportLeads, exportPortfolio, clientReport: (...args) => transaction(() => clients.report(...args), 'BEGIN'),
    handoffInbox: (...args) => transaction(() => feedback.inbox(...args), 'BEGIN'),
    handoffDetail: (...args) => transaction(() => feedback.details(...args), 'BEGIN'),
    handoffAttention: (...args) => transaction(() => feedback.attention(...args), 'BEGIN'),
    handoffAttentionCounts: feedback.attentionCounts,
    googleAds, createSession, close: () => db.close() };
}
