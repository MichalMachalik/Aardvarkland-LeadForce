import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';
import { reportDay } from '../client-accounts.mjs';
import { sqliteConnection } from '../online/sqlite.mjs';
import * as credentials from '../security.mjs';
import { createWorkspaceServer } from '../server.mjs';
import { openStore } from '../store.mjs';
import { createStore } from '../workspace-store.mjs';

const secret = 'Tymovy-Test-2026!';
const origin = 'http://127.0.0.1';
const alpha = { slug: 'alpha', workspace: 'Organizace A', name: 'Správce A', email: 'sprava@a.example', password: secret };
const beta = { ...alpha, slug: 'beta', workspace: 'Organizace B', name: 'Správce B' };

async function openApi(options) {
  const store = openStore(':memory:', options);
  const loggedErrors = [];
  const server = createWorkspaceServer(store, { origin, log: (error) => loggedErrors.push(error) });
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const endpoint = origin + ':' + server.address().port;

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
  async function invite(admin, username, role, client) {
    const { invite: token } = await change(admin, 'invite', { email: username + '@a.example', role, client });
    const body = { token, name: username, password: secret };
    const member = await session(await request('/api/invite/accept', { body }));
    await request('/api/invite/accept', { body, want: 404 });
    return member;
  }
  const close = async () => {
    await new Promise((done) => server.close(done));
    store.close();
  };
  return { store, request, session, state, detail, change, invite, close, loggedErrors };
}

test('real API isolates roles and organisations through the entire handoff', async () => {
  const { store, request, session, state, detail, change, invite, close, loggedErrors } = await openApi();
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
    await close();
  }
});

test('client report counts scoped handoffs and exact campaign costs, including corrections and missing data', async () => {
  const { store, request, session, state, detail, change, invite, close, loggedErrors } = await openApi();
  const today = reportDay();
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const report = async (actor, query = '', want = 200) => (await request('/api/client/report' + query, { ...actor, want })).data;
  try {
    store.bootstrap(alpha);
    store.bootstrap(beta);
    const admin = await session(await request('/api/login', { body: alpha }));
    const otherAdmin = await session(await request('/api/login', { body: beta }));
    assert.deepEqual((await state(admin)).clientManagement, { clients: [], campaigns: [], recentCosts: [] });
    await report({}, '', 401);
    await report(admin, '', 403);
    const createClient = async (actor, name) => (await change(actor, 'create-client', { name })).id;
    const a = await createClient(admin, 'Klient A');
    const b = await createClient(admin, 'Klient B');
    const c = await createClient(otherAdmin, 'Klient C');
    await change(admin, 'invite', { email: 'wrong@a.example', role: 'client', client: c }, 422);
    const clientA = await invite(admin, 'KlientA', 'client', a);
    const clientB = await invite(admin, 'KlientB', 'client', b);
    const clientC = await invite(otherAdmin, 'KlientC', 'client', c);
    const marketing = await invite(admin, 'Kampane', 'marketing');
    const care = await invite(admin, 'Predani', 'care');
    assert.equal((await state(clientA)).client, 'Klient A');
    assert.equal((await state(clientA)).leads, undefined);
    await report(marketing, '', 403);
    await change(marketing, 'create-client', { name: 'Cizí úkon' }, 403);
    const newCampaign = async (actor, client, code, name = code) =>
      (await change(actor, 'create-campaign', { client, code, name, project: 'Fiktivní projekt', source: 'Google Ads' })).id;
    const main = await newCampaign(marketing, a, 'REPORT-1', '=Kampaň A');
    const missing = await newCampaign(admin, a, 'REPORT-2');
    const withinOrg = await newCampaign(admin, b, 'OTHER-CLIENT');
    const outsideOrg = await newCampaign(otherAdmin, c, 'OTHER-ORG');
    await report(clientA, '?campaign=' + withinOrg, 404);
    await report(clientA, '?campaign=' + outsideOrg, 404);
    await request('/api/client/report.csv?campaign=' + outsideOrg, { ...clientA, want: 404 });
    await change(marketing, 'save-campaign-cost', { campaign: outsideOrg, day: today, cost: '999' }, 422);
    await change(clientA, 'save-campaign-cost', { campaign: main, day: today, cost: '999' }, 403);
    await change(admin, 'save-campaign-cost', { campaign: main, day: today, cost: '-20' }, 422);
    const cost = (campaign, day, cost) => change(marketing, 'save-campaign-cost', { campaign, day, cost });
    await cost(main, yesterday, '149,99');
    await cost(main, today, '400');
    await cost(main, today, '250,01');
    await cost(main, today, '250,01');
    await cost(withinOrg, today, '50000');
    await change(otherAdmin, 'save-campaign-cost', { campaign: outsideOrg, day: today, cost: '12345' });
    const createLead = async (campaign, name) =>
      (await change(marketing, 'create-lead', { name, email: name + '@a.example', client_campaign: campaign })).id;
    const first = await createLead(main, 'Jedna');
    const pending = await createLead(main, 'Ceka');
    await createLead(withinOrg, 'CiziKontakt');
    assert.equal((await report(clientA)).totals.handed, 0);
    assert.equal((await report(clientA)).totals.unit_cents, null);
    const handoff = async (id) => {
      await change(admin, 'change-stage', { id, version: 1, stage: 'contacted' });
      await change(admin, 'change-stage', { id, version: 2, stage: 'qualified' });
      await change(admin, 'assign', { id, version: 3, owner: care.user.id });
      await change(care, 'change-stage', { id, version: 4, stage: 'handed' });
    };
    await handoff(first);
    await change(care, 'add-note', { id: first, body: 'Interní zápis případu.' });
    await change(care, 'change-stage', { id: first, version: 5, stage: 'closed' });
    await change(admin, 'attach-campaign', { id: first, version: 6, campaign: withinOrg }, 409);
    await detail(clientA, first, 403);
    await detail(clientA, pending, 403);
    const second = await createLead(main, 'Druha');
    await handoff(second);
    const third = await createLead(missing, 'Treti');
    await handoff(third);
    const all = await report(clientA);
    assert.deepEqual(all.totals, { handed: 3, cost_cents: 40000, unit_cents: null, missing_cost: 1 });
    assert.deepEqual(all.deliveries.map((item) => item.name).sort(), ['Druha', 'Jedna', 'Treti']);
    assert.doesNotMatch(JSON.stringify(all), /Ceka|OTHER-CLIENT|OTHER-ORG|Interní zápis/);
    assert.deepEqual((await report(clientB)).deliveries, []);
    assert.equal((await report(clientC)).totals.cost_cents, 1234500);
    const narrow = await report(clientA, '?campaign=' + main + '&from=' + today + '&to=' + today);
    assert.equal(narrow.totals.cost_cents, 25001);
    assert.equal(narrow.totals.handed, 2);
    assert.equal(narrow.totals.unit_cents, 12501);
    await cost(missing, today, '0');
    assert.equal((await report(clientA, '?campaign=' + missing)).totals.unit_cents, 0);
    assert.equal((await report(clientA)).totals.unit_cents, 13333);
    const older = await report(clientA, '?from=' + yesterday + '&to=' + yesterday);
    assert.equal(older.totals.cost_cents, 14999);
    assert.equal(older.totals.handed, 0);
    assert.equal(older.totals.unit_cents, null);
    await report(clientA, '?from=2025-01-01&to=2020-01-01', 422);
    await report(clientA, '?from=2020-01-01&to=2025-01-01', 422);
    const exported = await request('/api/client/report.csv', clientA);
    assert.match(exported.response.headers.get('content-disposition'), /kampane\.csv/);
    assert.match(exported.data, /"'=Kampaň A"/);
    assert.match(exported.data, /"400,00";"2";"200,00"/);
    assert.doesNotMatch(exported.data, /@a\.example|OTHER-CLIENT|OTHER-ORG|Jedna/);
    await request('/api/export/leads.csv', { ...clientA, want: 403 });
    await request('/tools/audit-kampani/index.html', { ...clientA, want: 403 });
    const changes = (await state(admin)).activity.filter(({ action, detail }) => action === 'campaign_cost_saved' && detail.includes('REPORT-1'));
    assert.equal(changes.length, 3);
    assert.match(changes[0].detail, /400,00 → 250,01/);
    for (let i = 0; i < 24; i++) await handoff(await createLead(main, 'Strankovani' + i));
    const paginated = await report(clientA, '?page=2');
    assert.equal(paginated.totals.handed, 27);
    assert.equal(paginated.pages, 2);
    assert.equal(paginated.page, 2);
    assert.equal(paginated.deliveries.length, 2);
    assert.deepEqual(loggedErrors, []);
  } finally {
    await close();
  }
});

test('handoff confirmation and complaints respect client, care and organisation scope and preserve the delivery', async () => {
  // The first turn starts on a weekend with a clock change and crosses Czech State Establishment Day.
  let claimTime = Date.parse('2026-10-24T12:30:00.123Z');
  const { store, request, session, state, change, invite, close, loggedErrors } = await openApi({ claimClock: () => claimTime });
  const detail = async (actor, id, want = 200) => (await request('/api/handoffs/' + id, { ...actor, want })).data;
  const inbox = async (actor, filter = '', want = 200) => (await request('/api/handoffs' + filter, { ...actor, want })).data;
  const attention = async (actor, want = 200) => (await request('/api/handoff-attention', { ...actor, want })).data;
  const attentionCount = async (actor) => (await request('/api/handoff-attention/count', actor)).data.count;
  const escalations = async (actor, want = 200) => (await request('/api/handoff-attention?overdue=1', { ...actor, want })).data.rows;
  try {
    store.bootstrap(alpha);
    store.bootstrap(beta);
    const admin = await session(await request('/api/login', { body: alpha }));
    const otherAdmin = await session(await request('/api/login', { body: beta }));
    assert.deepEqual((await state(admin)).handoffSummary, { total: 0, confirmed: 0, active: 0 });
    assert.deepEqual((await state(admin)).claimCalendar, { opens: '08:00', closes: '16:00', teamHours: 24, clientHours: 72, closures: [], version: 0 });
    assert.deepEqual((await inbox(admin, '?status=all')).rows, []);
    const client = (await change(admin, 'create-client', { name: 'Kupující A' })).id;
    const otherClient = (await change(admin, 'create-client', { name: 'Kupující B' })).id;
    const outside = (await change(otherAdmin, 'create-client', { name: 'Kupující C' })).id;
    const viewer = await invite(admin, 'prijemce', 'client', client);
    const neighbour = await invite(admin, 'jiny-prijemce', 'client', otherClient);
    const outsider = await invite(otherAdmin, 'cizi-prijemce', 'client', outside);
    const care = await invite(admin, 'pece', 'care');
    const otherCare = await invite(admin, 'jina-pece', 'care');
    const marketing = await invite(admin, 'obchod', 'marketing');
    const campaign = (await change(admin, 'create-campaign', { client, name: 'Testovací kampaň',
      project: 'Projekt A', source: 'Google Ads', code: 'ACK-1' })).id;
    const lead = (await change(admin, 'create-lead', { name: 'Předávaný kontakt', email: 'kontakt@a.example',
      client_campaign: campaign })).id;
    const pending = (await change(admin, 'create-lead', { name: 'Rozpracovaný kontakt', email: 'nesdileno@a.example',
      client_campaign: campaign })).id;
    await detail(viewer, lead, 404);
    await change(viewer, 'confirm-handoff', { id: lead }, 404);
    await change(admin, 'save-campaign-cost', { campaign, day: reportDay(), cost: '1200' });
    await change(admin, 'change-stage', { id: lead, version: 1, stage: 'contacted' });
    await change(admin, 'change-stage', { id: lead, version: 2, stage: 'qualified' });
    await change(admin, 'assign', { id: lead, version: 3, owner: care.user.id });
    await change(care, 'add-note', { id: lead, body: 'Interní komentář pro tým.' });
    await change(care, 'change-stage', { id: lead, version: 4, stage: 'handed' });
    await change(care, 'change-stage', { id: lead, version: 5, stage: 'closed' });
    await detail({}, lead, 401);
    await detail(neighbour, lead, 404);
    await detail(outsider, lead, 404);
    await detail(otherAdmin, lead, 404);
    await detail(otherCare, lead, 404);
    await detail(marketing, lead, 403);
    await detail(viewer, pending, 404);
    await inbox(viewer, '', 403);
    await inbox(marketing, '', 403);
    await inbox(care, '?status=absent', 422);
    await change(care, 'confirm-handoff', { id: lead }, 403);
    await change(neighbour, 'confirm-handoff', { id: lead }, 404);
    await change({ ...viewer, csrf: undefined }, 'confirm-handoff', { id: lead }, 403);
    await change(viewer, 'confirm-handoff', { id: lead });
    const receipt = (await detail(viewer, lead)).delivery.confirmed_at;
    assert.ok(receipt);
    await change(viewer, 'confirm-handoff', { id: lead });
    assert.equal((await detail(care, lead)).delivery.confirmed_at, receipt);
    assert.equal((await inbox(care, '?status=confirmed')).rows[0].id, lead);
    assert.deepEqual((await state(care)).handoffSummary, { total: 1, confirmed: 1, active: 0 });
    assert.equal((await state(admin)).activity.filter((row) => row.action === 'handoff_confirmed').length, 1);

    const complaint = { id: lead, reason: 'invalid_contact', description: 'Nesouhlasí telefonní číslo.', request_key: randomUUID() };
    await change(outsider, 'file-handoff-claim', complaint, 404);
    await change(marketing, 'file-handoff-claim', complaint, 403);
    await change(viewer, 'file-handoff-claim', { ...complaint, id: pending }, 404);
    await change(viewer, 'file-handoff-claim', { ...complaint, reason: 'missing' }, 422);
    await change(viewer, 'file-handoff-claim', { ...complaint, reason: 'other', description: '' }, 422);
    await change(viewer, 'file-handoff-claim', { ...complaint, request_key: 'bad' }, 422);
    const filed = await change(viewer, 'file-handoff-claim', complaint);
    assert.deepEqual(await change(viewer, 'file-handoff-claim', complaint), filed);
    await change(viewer, 'file-handoff-claim', { ...complaint, description: 'Jiný obsah' }, 409);
    await change(viewer, 'file-handoff-claim', { ...complaint, request_key: randomUUID() }, 409);
    assert.equal((await inbox(care)).rows[0].claim_status, 'open');
    assert.equal((await inbox(otherCare)).rows.length, 0);
    assert.equal((await state(admin)).handoffSummary.active, 1);
    assert.equal((await state(care)).handoffAttention, 1);
    const incoming = (await attention(care)).rows[0];
    assert.equal(incoming.id, lead);
    assert.equal(incoming.sla_due_at, '2026-10-29T15:00:00.000Z');
    assert.equal(incoming.sla_overdue, 0);
    assert.deepEqual(await escalations(care), []);
    assert.equal(await attentionCount(viewer), 0);
    const schedule = { opens: '09:00', closes: '17:00', teamHours: '12', clientHours: '48',
      closures: '2026-10-26\n2026-10-26', version: 0 };
    await change(care, 'save-claim-calendar', schedule, 403);
    await change(viewer, 'save-claim-calendar', schedule, 403);
    await change({ ...admin, csrf: undefined }, 'save-claim-calendar', schedule, 403);
    await change(admin, 'save-claim-calendar', { ...schedule, closes: '09:00' }, 422);
    await change(admin, 'save-claim-calendar', { ...schedule, closures: '2026-02-30' }, 422);
    await change(admin, 'save-claim-calendar', { ...schedule, teamHours: '0' }, 422);
    await change(admin, 'save-claim-calendar', schedule);
    await change(admin, 'save-claim-calendar', schedule, 409);
    const changed = (await state(admin)).claimCalendar;
    assert.deepEqual(changed, { opens: '09:00', closes: '17:00', teamHours: 12, clientHours: 48, closures: ['2026-10-26'], version: 1 });
    assert.equal((await state(otherAdmin)).claimCalendar.version, 0);
    assert.equal((await state(care)).claimCalendar, undefined);
    const adjusted = (await detail(viewer, lead)).delivery;
    assert.equal(adjusted.sla_due_at, '2026-10-29T12:00:00.000Z');
    assert.equal(adjusted.calendar_revision, 1);
    assert.equal((await request('/api/handoff-attention/count', viewer)).data.calendarRevision, 1);
    await change(admin, 'save-claim-calendar', { ...changed, opens: '08:00', closes: '16:00', teamHours: 24, clientHours: 72, closures: '' });
    assert.equal((await detail(viewer, lead)).delivery.sla_due_at, incoming.sla_due_at);
    const draft = { id: filed.id, version: 1, outcome: 'accepted', resolution: 'Údaje jsme zkontrolovali.' };
    const ask = { id: filed.id, version: 2, message: 'Doplňte referenci původního záznamu.', request_key: randomUUID() };
    const answer = { id: filed.id, version: 3, message: 'Původní záznam měl referenci TEST-42.', request_key: randomUUID() };
    await change(viewer, 'review-handoff-claim', draft, 403);
    await change(otherCare, 'review-handoff-claim', draft, 404);
    await change(otherAdmin, 'review-handoff-claim', draft, 404);
    await change(care, 'resolve-handoff-claim', draft, 409);
    await change(care, 'request-claim-evidence', { ...ask, version: 1 }, 409);
    claimTime = Date.parse(incoming.sla_due_at) - 1;
    await change(care, 'review-handoff-claim', draft);
    assert.equal((await detail(viewer, lead)).claims[0].status, 'review');
    assert.equal(await attentionCount(care), 1);
    assert.deepEqual(await escalations(admin), []);
    assert.equal((await detail(viewer, lead)).delivery.sla_due_at, incoming.sla_due_at);
    claimTime += 1;
    assert.equal((await state(admin)).handoffEscalations, 1);
    const late = (await escalations(care))[0];
    assert.equal(late.id, lead);
    assert.equal(late.sla_overdue, 1);
    assert.deepEqual(await escalations(otherCare), []);
    assert.deepEqual(await escalations(otherAdmin), []);
    await escalations(marketing, 403);
    await escalations(viewer, 403);
    assert.equal((await request('/api/handoff-attention/count', viewer)).data.overdue, undefined);
    await change(viewer, 'request-claim-evidence', ask, 403);
    await change(otherCare, 'request-claim-evidence', ask, 404);
    await change(otherAdmin, 'request-claim-evidence', ask, 404);
    await change(care, 'request-claim-evidence', { ...ask, message: ' ' }, 422);
    const posted = await change(care, 'request-claim-evidence', ask);
    assert.deepEqual(await change(care, 'request-claim-evidence', ask), posted);
    await change(care, 'request-claim-evidence', { ...ask, message: 'Změněný obsah.' }, 409);
    await change(care, 'request-claim-evidence', { ...ask, version: 3, request_key: randomUUID() }, 409);
    assert.equal((await state(viewer)).handoffAttention, 1);
    assert.equal(await attentionCount(care), 0);
    const pendingEvidence = (await attention(viewer)).rows[0];
    assert.equal(pendingEvidence.claim_turn, 'request');
    assert.equal(pendingEvidence.sla_due_at, '2026-11-11T15:00:00.000Z');
    assert.deepEqual(await escalations(admin), []);
    assert.equal((await inbox(care, '?status=client_turn')).rows[0].id, lead);
    assert.deepEqual((await attention(neighbour)).rows, []);
    assert.equal(await attentionCount(outsider), 0);
    await attention(marketing, 403);
    await change(neighbour, 'reply-claim-evidence', answer, 404);
    await change(care, 'reply-claim-evidence', answer, 403);
    await change({ ...viewer, csrf: undefined }, 'reply-claim-evidence', answer, 403);
    await change(viewer, 'reply-claim-evidence', { ...answer, version: 2 }, 409);
    claimTime = Date.parse(pendingEvidence.sla_due_at) - 1;
    assert.deepEqual(await escalations(admin), []);
    claimTime += 1;
    assert.equal((await request('/api/handoff-attention/count', care)).data.overdue, 1);
    assert.equal((await escalations(admin))[0].claim_turn, 'request');
    assert.equal((await attention(viewer)).rows[0].sla_overdue, 1);
    const supplied = await change(viewer, 'reply-claim-evidence', answer);
    assert.deepEqual(await change(viewer, 'reply-claim-evidence', answer), supplied);
    await change(viewer, 'reply-claim-evidence', { ...answer, version: 4, request_key: randomUUID() }, 409);
    assert.equal(await attentionCount(viewer), 0);
    assert.equal(await attentionCount(care), 1);
    const resumed = (await attention(admin)).rows[0];
    assert.equal(resumed.claim_turn, 'reply');
    assert.equal(resumed.sla_due_at, '2026-11-16T15:00:00.000Z');
    assert.deepEqual(await escalations(admin), []);
    assert.deepEqual((await attention(otherCare)).rows, []);
    assert.equal((await request('/api/client/report', viewer)).data.deliveries[0].claim_turn, 'reply');
    await change(care, 'resolve-handoff-claim', draft, 409);
    await change(care, 'resolve-handoff-claim', { ...draft, version: 4, resolution: ' ' }, 422);
    claimTime = Date.parse(resumed.sla_due_at);
    assert.equal((await escalations(admin))[0].id, lead);
    await change(care, 'resolve-handoff-claim', { ...draft, version: 4 });
    await change(care, 'resolve-handoff-claim', { ...draft, version: 4 });
    const received = await detail(viewer, lead);
    assert.equal(received.delivery.sla_due_at, null);
    assert.deepEqual(await escalations(admin), []);
    assert.equal(received.claims[0].status, 'accepted');
    assert.equal(received.claims[0].resolution, draft.resolution);
    assert.equal(received.claims[0].reviewer_id, undefined);
    assert.deepEqual(received.claims[0].messages.map(({ kind, body }) => [kind, body]), [
      ['request', ask.message], ['reply', answer.message],
    ]);
    assert.equal(await attentionCount(care), 0);
    await change(viewer, 'reply-claim-evidence', { ...answer, version: 5, request_key: randomUUID() }, 409);
    assert.doesNotMatch(JSON.stringify(received), /Interní komentář/);
    assert.equal((await inbox(care)).rows.length, 0);
    assert.equal((await inbox(care, '?status=closed')).rows[0].claim_status, 'accepted');

    const second = await change(viewer, 'file-handoff-claim', { ...complaint, reason: 'duplicate', request_key: randomUUID() });
    await change(care, 'review-handoff-claim', { id: second.id, version: 1 });
    await change(admin, 'user-status', { id: care.user.id, enabled: false });
    await detail(care, lead, 401);
    await change(otherCare, 'review-handoff-claim', { id: second.id, version: 2 });
    await change(otherCare, 'resolve-handoff-claim', { id: second.id, version: 3, outcome: 'rejected', resolution: 'Kontakt patří k jinému projektu.' });
    const history = (await detail(viewer, lead)).claims;
    assert.deepEqual(history.map((row) => row.status), ['rejected', 'accepted']);
    assert.deepEqual(history[0].messages, []);
    assert.equal((await state(admin)).activity.filter((row) => row.action === 'handoff_claim_accepted').length, 1);
    const report = (await request('/api/client/report', viewer)).data;
    assert.equal(report.deliveries[0].confirmed_at, receipt);
    assert.equal(report.deliveries[0].claim_status, 'rejected');
    assert.equal(report.totals.handed, 1);
    assert.equal(report.totals.unit_cents, 120000);
    assert.deepEqual(loggedErrors, []);
  } finally {
    await close();
  }
});

test('existing Node and browser databases keep their sessions, invitations and leads during the client schema migration', async () => {
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  const legacy = schema.split('CREATE TABLE IF NOT EXISTS clients')[0].replace(",'client'", '');
  const SQL = await initSqlJs();
  for (const db of [new DatabaseSync(':memory:'), sqliteConnection(new SQL.Database())]) {
    try {
      const old = createStore(db, legacy, credentials);
      const account = old.bootstrap(alpha);
      const raw = old.createSession(account.user);
      const admin = old.session(raw);
      const lead = old.command(admin, 'create-lead', { name: 'Původní poptávka', email: 'puvodni@a.example',
        project: 'Starší projekt', source: 'Meta', campaign: 'OLD-01' }).id;
      const { invite } = old.command(admin, 'invite', { email: 'cekajici@a.example', role: 'care' });
      const upgraded = createStore(db, schema, credentials);
      assert.equal(upgraded.upgraded, true);
      assert.equal(upgraded.session(raw).id, admin.id);
      assert.equal(upgraded.leadDetail(admin, lead).lead.name, 'Původní poptávka');
      assert.equal(upgraded.session(upgraded.claimInvite({ token: invite, name: 'Péče', password: secret })).role, 'care');
      const client = upgraded.command(admin, 'create-client', { name: 'Řada' }).id;
      const next = upgraded.command(admin, 'invite', { email: 'klient@a.example', role: 'client', client }).invite;
      const member = upgraded.session(upgraded.claimInvite({ token: next, name: 'Klientský uživatel', password: secret }));
      assert.equal(upgraded.state(member).client, 'Řada');
      assert.equal(createStore(db, schema, credentials).upgraded, false);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      db.close();
    }
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
