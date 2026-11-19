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

function slug(value) {
  const result = text(value, 'Identifikátor organizace', 48).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new Failure(422, 'Identifikátor používá malá písmena, čísla a spojovník.');
  return result;
}

export function createStore(db, schema, { hash, passwordDigest, passwordMatches, token }, { claimClock = Date.now } = {}) {
  const upgraded = initializeSchema(db, schema);
  db.function('claim_business_due', { deterministic: true }, claimDeadlineCalculator());
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
  const missingPassword = passwordDigest(token());
  const event = (actor, action, detail = '', lead = null) =>
    run('INSERT INTO activity (workspace_id,actor_id,lead_id,action,detail,created_at) VALUES (?,?,?,?,?,?)',
      actor.workspace_id, actor.id, lead, action, detail, now());
  const clients = clientAccounts({ get, all, run, event, allow });
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
      run('UPDATE users SET password=? WHERE workspace_id=? AND id=?', digest, actor.workspace_id, actor.id);
      run('DELETE FROM sessions WHERE user_id=?', actor.id);
      event(actor, 'password_changed');
    });
    return createSession(actor.id);
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

  function state(actor) {
    const { workspace_id: org, id: userId, role } = actor;
    const base = { user: publicActor(actor), csrf: actor.csrf };
    if (role === 'client') return { ...base, client: clients.clientName(actor).name, handoffAttention: feedback.attentionCounts(actor).count };
    if (role === 'investor') return {
      ...base,
      positions: all('SELECT id,project,principal_cents,maturity,status FROM positions WHERE workspace_id=? AND investor_id=? ORDER BY maturity', org, userId),
      messages: all('SELECT id,title,body,published_at,read_at FROM messages WHERE workspace_id=? AND investor_id=? AND published_at IS NOT NULL ORDER BY published_at DESC,id DESC', org, userId),
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
      result.messages = all('SELECT m.*,u.name AS investor FROM messages m JOIN users u ON u.id=m.investor_id WHERE m.workspace_id=? ORDER BY m.id DESC LIMIT 500', org);
    }
    if (role === 'admin') {
      result.users = all(`SELECT u.id,u.name,u.email,u.role,u.enabled,c.name AS client FROM users u
        LEFT JOIN client_users m ON m.workspace_id=u.workspace_id AND m.user_id=u.id
        LEFT JOIN clients c ON c.workspace_id=m.workspace_id AND c.id=m.client_id
        WHERE u.workspace_id=? ORDER BY u.enabled DESC,u.name`, org);
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
      const handedAt = body.stage === 'handed' ? now() : row.handed_at;
      updateLead(actor, row, body.version, 'stage=?, handed_at=?', body.stage, handedAt);
      if (body.stage === 'handed') {
        run('UPDATE client_leads SET handed_day=? WHERE workspace_id=? AND lead_id=?', reportDay(new Date(handedAt)), actor.workspace_id, row.id);
      }
      event(actor, 'stage_changed', stages[row.stage] + ' → ' + stages[body.stage], row.id);
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
    'invite'(actor, body) {
      allow(actor, 'admin');
      const address = email(body.email);
      if (!roles.includes(body.role)) throw new Failure(422, 'Vyberte roli.');
      if (get('SELECT id FROM users WHERE workspace_id=? AND email=?', actor.workspace_id, address)) throw new Failure(409, 'Tento e-mail již má účet.');
      const client = body.role === 'client' ? clients.requireClient(actor, body.client).id : null;
      return makeInvite(actor, address, body.role, null, client);
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
        run("UPDATE leads SET owner_id=NULL,version=version+1 WHERE workspace_id=? AND owner_id=? AND stage<>'closed'", actor.workspace_id, row.id);
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
    'publish-message'(actor, body) {
      allow(actor, 'admin', 'care');
      const row = get('SELECT id,investor_id,published_at FROM messages WHERE workspace_id=? AND id=?', actor.workspace_id, id(body.id));
      if (!row) missing();
      if (row.published_at) return;
      member(actor, row.investor_id, 'investor');
      run('UPDATE messages SET published_at=? WHERE workspace_id=? AND id=?', now(), actor.workspace_id, row.id);
      event(actor, 'message_published', 'ID ' + row.id);
    },
    'read-message'(actor, body) {
      allow(actor, 'investor');
      const row = get('SELECT id,read_at FROM messages WHERE workspace_id=? AND investor_id=? AND id=? AND published_at IS NOT NULL',
        actor.workspace_id, actor.id, id(body.id));
      if (!row) missing();
      if (row.read_at) return;
      run('UPDATE messages SET read_at=? WHERE workspace_id=? AND investor_id=? AND id=?', now(), actor.workspace_id, actor.id, row.id);
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
      ...rows.map((row) => ['CRM-' + row.id, row.created_at.slice(0, 10), row.source, row.campaign,
        row.handed_at ? stages.qualified : stages[row.stage], row.handed_at?.slice(0, 10)]),
    ]);
  }

  return { upgraded, bootstrap, signIn, signOut, session, changePassword, claimInvite, state, leadDetail, command,
    exportLeads, clientReport: (...args) => transaction(() => clients.report(...args), 'BEGIN'),
    handoffInbox: (...args) => transaction(() => feedback.inbox(...args), 'BEGIN'),
    handoffDetail: (...args) => transaction(() => feedback.details(...args), 'BEGIN'),
    handoffAttention: (...args) => transaction(() => feedback.attention(...args), 'BEGIN'),
    handoffAttentionCounts: feedback.attentionCounts,
    googleAds, createSession, close: () => db.close() };
}
