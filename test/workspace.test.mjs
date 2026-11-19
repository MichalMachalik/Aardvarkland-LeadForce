import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorkspaceServer } from '../server.mjs';
import { openStore } from '../store.mjs';

const secret = 'Tymovy-Test-2026!';
const origin = 'http://127.0.0.1';

test('real API isolates roles and organisations through the entire handoff', async () => {
  const store = openStore(':memory:');
  const loggedErrors = [];
  const server = createWorkspaceServer(store, { origin, log: (error) => loggedErrors.push(error) });
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const endpoint = origin + ':' + server.address().port;
  const alpha = { slug: 'alpha', workspace: 'Organizace A', name: 'Správce A', email: 'sprava@a.example', password: secret };
  const beta = { ...alpha, slug: 'beta', workspace: 'Organizace B', name: 'Správce B' };

  async function request(path, { cookie, csrf, body, callerOrigin = origin, want = 200 } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers['X-Workspace-CSRF'] = csrf;
    const init = { headers };
    if (body !== undefined) {
      headers.Origin = callerOrigin;
      headers['Content-Type'] = 'application/json';
      init.method = 'POST';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(endpoint + path, init);
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : await response.text();
    assert.equal(response.status, want, path + ' ' + JSON.stringify(data));
    return { response, data };
  }

  async function session(result) {
    const token = result.response.headers.get('set-cookie');
    assert.match(token, /HttpOnly; SameSite=Strict/);
    const cookie = token.split(';')[0];
    const { data } = await request('/api/state', { cookie });
    return { cookie, csrf: data.csrf, user: data.user };
  }

  const state = async (user, want = 200) => (await request('/api/state', { ...user, want })).data;
  const detail = async (user, id, want = 200) => (await request('/api/leads/' + id, { ...user, want })).data;
  const change = async (user, action, body, want = 200) => (await request('/api/actions/' + action, { ...user, body, want })).data;
  async function invite(admin, username, role) {
    const { invite: token } = await change(admin, 'invite', { email: username + '@a.example', role });
    const body = { token, name: username, password: secret };
    const member = await session(await request('/api/invite/accept', { body }));
    await request('/api/invite/accept', { body, want: 404 });
    return member;
  }

  try {
    store.bootstrap(alpha);
    store.bootstrap(beta);
    await request('/api/state', { want: 401 });
    await request('/api/example/session', { body: { role: 'admin' }, want: 404 });
    await request('/api/login', { body: alpha, callerOrigin: 'https://unrelated.example', want: 403 });
    await request('/api/login', { body: { ...alpha, password: 'absolutely-wrong' }, want: 401 });
    const manager = await session(await request('/api/login', { body: alpha }));
    const outsider = await session(await request('/api/login', { body: beta }));
    const initial = await state(manager);
    for (const field of ['leads', 'positions', 'messages', 'tasks']) assert.deepEqual(initial[field], []);
    assert.equal(initial.users.length, 1);
    const marketing = await invite(manager, 'Marketér', 'marketing');
    const agent = await invite(manager, 'Kvalifikátor', 'agent');
    const care = await invite(manager, 'Péče', 'care');
    const investor = await invite(manager, 'Investor', 'investor');
    const other = await invite(manager, 'Jinýinvestor', 'investor');

    const input = { name: 'Fiktivní kontakt', email: 'lead@a.example', project: 'Javor', source: 'google', campaign: 'G-1' };
    await change({ ...marketing, csrf: undefined }, 'create-lead', input, 403);
    const { id } = await change(marketing, 'create-lead', input);
    await change(marketing, 'create-lead', { ...input, email: 'LEAD@A.EXAMPLE' }, 409);
    await change(investor, 'create-lead', input, 403);
    assert.doesNotMatch(JSON.stringify(await state(marketing)), /lead@a\.example|Fiktivní kontakt/);
    await detail(marketing, id, 403);
    await detail(outsider, id, 404);
    await detail(investor, id, 403);
    assert.equal((await state(outsider)).leads.length, 0);
    assert.equal((await detail(agent, id)).lead.owner_id, null);
    await change(agent, 'change-stage', { id, version: 1, stage: 'contacted' }, 403);
    await change(agent, 'assign', { id, version: 1 });
    await change(agent, 'change-stage', { id, version: 1, stage: 'contacted' }, 409);
    await change(agent, 'change-stage', { id, version: 2, stage: 'handed' }, 409);
    await change(agent, 'change-stage', { id, version: 2, stage: 'contacted' });
    await change(agent, 'add-note', { id, body: 'Skrytá poznámka', recipient: investor.user.id }, 403);
    await change(agent, 'add-note', { id, body: 'Skrytá poznámka', recipient: outsider.user.id }, 403);
    await change(agent, 'add-note', { id, body: 'Interní poznámka viditelná pouze v týmu.', recipient: manager.user.id });
    const [notification] = (await state(manager)).notifications;
    assert.equal(notification.lead_id, id);
    assert.equal(notification.kind, 'note');
    await change(agent, 'read-notification', { id: notification.id }, 404);
    await change(outsider, 'read-notification', { id: notification.id }, 404);
    await change(manager, 'read-notification', { id: notification.id });
    assert.ok((await state(manager)).notifications[0].read_at);
    await change(agent, 'add-task', { id, title: 'Dotáhnout kvalifikaci', due: '2026-12-07' });
    await change(agent, 'change-stage', { id, version: 3, stage: 'qualified' });
    assert.ok((await detail(care, id)).notes[0].body.startsWith('Interní poznámka'));
    await change(care, 'assign', { id, version: 4 });
    assert.equal((await state(agent)).tasks.length, 0);
    assert.equal((await state(care)).tasks[0].title, 'Dotáhnout kvalifikaci');
    await change(care, 'complete-task', { id: (await state(care)).tasks[0].id });
    await detail(agent, id, 404);
    await change(care, 'change-stage', { id, version: 5, stage: 'handed' });
    const linked = await change(care, 'link-investor', { id, version: 6 });
    const leadInvestor = await session(await request('/api/invite/accept', { body: { token: linked.invite, name: 'Předaný kontakt', password: secret } }));
    assert.equal((await detail(care, id)).lead.investor_id, leadInvestor.user.id);
    assert.equal(leadInvestor.user.email, input.email);
    await change(care, 'link-investor', { id, version: 7 }, 409);
    await change(care, 'add-task', { id, title: 'Navázat kontakt', due: '2026-12-08' });
    const [task] = (await state(care)).tasks;
    await change(agent, 'complete-task', { id: task.id }, 404);
    await change(care, 'complete-task', { id: task.id });
    assert.ok((await state(care)).tasks[0].done_at);
    const crm = await request('/api/export/leads.csv', marketing);
    assert.match(crm.data, /"Kvalifikovaná";"\d{4}-\d{2}-\d{2}"/);
    assert.doesNotMatch(crm.data, /lead@|Fiktivní/);
    await change(care, 'change-stage', { id, version: 7, stage: 'closed' });
    assert.match((await request('/api/export/leads.csv', marketing)).data, /"Kvalifikovaná";"\d{4}-\d{2}-\d{2}"/);
    await request('/api/export/leads.csv', { ...investor, want: 403 });

    await change(care, 'add-position', { investor: investor.user.id, project: 'Javor', principal: '1 250,45', maturity: '2028-08-01' });
    await change(care, 'add-position', { investor: other.user.id, project: 'Dub', principal: '7250', maturity: '2029-08-01' });
    const { id: message } = await change(care, 'draft-message', { investor: investor.user.id, title: 'Průběžný výkaz', body: 'První fáze projektu byla zahájena.' });
    assert.equal((await state(investor)).messages.length, 0);
    await change(investor, 'read-message', { id: message }, 404);
    await change(care, 'publish-message', { id: message });
    await change(care, 'publish-message', { id: message });
    const investorData = await state(investor);
    assert.equal(investorData.positions.length, 1);
    assert.equal(investorData.positions[0].principal_cents, 125045);
    assert.equal(investorData.messages[0].id, message);
    assert.doesNotMatch(JSON.stringify(investorData), /Dub|Interní poznámka|lead@/);
    assert.equal((await state(other)).messages.length, 0);
    await change(other, 'read-message', { id: message }, 404);
    await change(investor, 'read-message', { id: message });
    assert.ok((await state(care)).messages[0].read_at);
    await request('/tools/audit-kampani/index.html', { ...investor, want: 403 });

    await change(manager, 'user-status', { id: investor.user.id, enabled: false });
    await state(investor, 401);
    await change(manager, 'user-status', { id: manager.user.id, enabled: false }, 409);
    const rotated = await session(await request('/api/password', { ...agent, body: { current: secret, next: 'Zmenene-Testovaci-Heslo-2026' } }));
    await state(agent, 401);
    assert.equal((await state(rotated)).user.id, agent.user.id);
    await request('/api/logout', { ...rotated, body: {} });
    await state(rotated, 401);
    assert.deepEqual(loggedErrors, []);
  } finally {
    await new Promise((done) => server.close(done));
    store.close();
  }
});

test('production storage retains the real account and workflow across restart', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'workspace-qa-'));
  const db = join(folder, 'test.sqlite');
  let store = openStore(db);
  const setup = { slug: 'restart', workspace: 'Organizace Restart', name: 'Správce QA', email: 'spravce@restart.example', password: secret };
  try {
    store.bootstrap(setup);
    const session = store.signIn(setup);
    const actor = store.session(session);
    store.command(actor, 'create-lead', { name: 'Kontaktní osoba', email: 'kontakt@restart.example', project: 'Restart', source: 'Meta', campaign: 'M-8' });
    store.close();
    store = openStore(db);
    const reloaded = store.state(store.session(session));
    assert.equal(reloaded.leads[0].name, 'Kontaktní osoba');
    assert.equal(reloaded.activity[0].action, 'lead_created');
    assert.equal(reloaded.positions.length, 0);
  } finally {
    store.close();
    await rm(folder, { recursive: true, force: true });
  }
});
