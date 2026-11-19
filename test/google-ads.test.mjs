import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleAdsProvider } from '../google-ads-provider.mjs';
import { exampleAdsSnapshot } from '../google-ads-example.mjs';
import { normalizeAdsCosts, syncWindow } from '../google-ads.mjs';
import { reportDay } from '../client-accounts.mjs';
import { openStore } from '../store.mjs';

test('Google Ads sync is scoped, repeatable and keeps a gap separate from a confirmed zero', () => {
  const store = openStore(':memory:');
  try {
    const admin = store.session(store.createSession(store.bootstrap({
      workspace: 'Test importu', slug: 'test-importu', name: 'Správce testu',
      email: 'spravce@test.example', password: 'Testovaci_heslo_2026',
    }).user));
    const client = store.command(admin, 'create-client', { name: 'Test klienta' }).id;
    const campaign = store.command(admin, 'create-campaign', {
      client, name: 'Importovaná kampaň', project: 'Pilot', source: 'Google Ads', code: 'QA-ADS',
    }).id;
    const otherClient = store.command(admin, 'create-client', { name: 'Jiný klient' }).id;
    const otherCampaign = store.command(admin, 'create-campaign', {
      client: otherClient, name: 'Skrytá kampaň', project: 'Pilot', source: 'Google Ads', code: 'QA-ADS-B',
    }).id;
    const member = (email, role, client) => {
      const { invite } = store.command(admin, 'invite', { email, role, client });
      return store.session(store.claimInvite({ token: invite, name: role, password: 'Testovaci_heslo_2026' }));
    };
    const marketing = member('a@test.example', 'marketing');
    const viewer = member('b@test.example', 'client', client);
    const care = member('c@test.example', 'care');
    const fromToday = reportDay();
    const dates = syncWindow(fromToday, 3);
    const input = { campaign, ...dates };
    const connector = { campaign, customer: '100-000-0001', external: '700001' };
    store.command(marketing, 'configure-google-ads', connector);
    store.command(admin, 'configure-google-ads', { ...connector, campaign: otherCampaign, external: '700002' });
    assert.throws(() => store.command(viewer, 'configure-google-ads', connector), { status: 403 });
    assert.throws(() => store.googleAds.plan(viewer, input), { status: 403 });
    assert.throws(() => store.googleAds.plan({ ...admin, workspace_id: 999 }, input), { status: 422 });
    assert.throws(() => store.googleAds.plan(admin, { ...input, to: fromToday }), { status: 422 });
    assert.throws(() => store.googleAds.plan(admin, { ...input, from: '2000-01-01' }), { status: 422 });

    store.command(admin, 'save-campaign-cost', { campaign, day: dates.from, cost: '999' });
    const lead = store.command(admin, 'create-lead', { name: 'Testovací kontakt', email: 'lead@test.example', client_campaign: campaign }).id;
    store.command(admin, 'change-stage', { id: lead, stage: 'contacted', version: 1 });
    store.command(admin, 'change-stage', { id: lead, stage: 'qualified', version: 2 });
    store.command(admin, 'assign', { id: lead, owner: care.id, version: 3 });
    store.command(care, 'change-stage', { id: lead, stage: 'handed', version: 4 });

    const sync = (scenario) => {
      const plan = store.googleAds.plan(marketing, input);
      return store.googleAds.apply(marketing, plan, exampleAdsSnapshot(plan, scenario));
    };
    const report = () => store.clientReport(viewer, new URLSearchParams({ from: dates.from, to: fromToday }));
    const began = store.googleAds.plan(admin, input);
    const first = sync('gap');
    assert.equal(first.added, 2);
    assert.equal(first.zero, 1);
    assert.equal(first.reopened, 1);
    const [gapDay] = first.missing;
    assert.ok(gapDay > dates.from && gapDay < dates.to);
    assert.throws(() => store.googleAds.apply(admin, began, exampleAdsSnapshot(began)), { status: 409 });
    const partial = report();
    assert.equal(partial.totals.cost_cents, 45000);
    assert.equal(partial.totals.unit_cents, null);
    assert.equal(partial.import_missing, 1);
    assert.equal(partial.campaigns[0].cost_days, 2);
    assert.equal(store.state(admin).clientManagement.recentCosts[0].cost_cents, 99900);
    assert.doesNotMatch(JSON.stringify(partial), /Skrytá kampaň/);
    const repeated = sync('gap');
    assert.equal(repeated.added, 0);
    assert.equal(repeated.updated, 0);
    assert.equal(repeated.unchanged, 2);
    assert.equal(repeated.reopened, 0);
    assert.deepEqual(report(), partial);
    assert.equal(store.state(admin).activity.filter(({ action }) => action === 'google_ads_sync').length, 1);
    assert.equal(sync('complete').resolved, 1);
    assert.equal(report().totals.unit_cents, 120000);
    assert.equal(sync('gap').retained, 1);
    assert.equal(report().totals.cost_cents, 120000);
    assert.equal(report().totals.unit_cents, null);
    const corrected = sync('correction');
    assert.equal(corrected.updated, 1);
    assert.equal(corrected.resolved, 1);
    assert.equal(report().totals.unit_cents, 125000);
    assert.equal(sync('correction').unchanged, 3);
    assert.match(store.clientReport(viewer, new URLSearchParams(), true), /"1250,00";"1";"1250,00"/);
    assert.throws(() => store.command(admin, 'configure-google-ads', { ...connector, external: '700003' }), { status: 409 });
    const plan = store.googleAds.plan(admin, input);
    const invalid = exampleAdsSnapshot(plan, 'complete');
    invalid.campaigns[0].results.push({ ...invalid.campaigns[0].results[0], metrics: { costMicros: '980000000' } });
    assert.throws(() => store.googleAds.apply(admin, plan, invalid), { status: 502 });
    assert.equal(report().totals.cost_cents, 125000);
    sync('gap');
    store.command(marketing, 'save-campaign-cost', { campaign, day: gapDay, cost: '42' });
    assert.equal(report().import_missing, 0);
    assert.equal(report().totals.unit_cents, 49200);
  } finally {
    store.close();
  }
});

test('Google Ads adapter queries external campaign/day and converts micros without assuming missing rows are zero', async () => {
  const plan = { customer: '1000000001', external: '9007199254740993', from: '2024-10-03', to: '2024-10-05',
    days: ['2024-10-03', '2024-10-04', '2024-10-05'] };
  const urls = [];
  const env = {
    GOOGLE_ADS_DEVELOPER_TOKEN: 'test-developer-token', GOOGLE_ADS_CLIENT_ID: 'test-client',
    GOOGLE_ADS_CLIENT_SECRET: 'test-secret', GOOGLE_ADS_REFRESH_TOKEN: 'test-refresh',
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: '1000000099',
  };
  const provider = googleAdsProvider(env, async (url, init) => {
    urls.push(url);
    assert.equal(init.method, 'POST');
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(init.body.get('grant_type'), 'refresh_token');
      return Response.json({ access_token: 'test-access' });
    }
    assert.equal(init.headers.Authorization, 'Bearer test-access');
    assert.equal(init.headers['login-customer-id'], '1000000099');
    const { query } = JSON.parse(init.body);
    if (query.endsWith('FROM customer')) return Response.json(exampleAdsSnapshot(plan).account);
    assert.match(query, /campaign\.id = 9007199254740993/);
    assert.match(query, /BETWEEN '2024-10-03' AND '2024-10-05'/);
    return Response.json([
      { results: [{ campaign: { id: plan.external }, segments: { date: plan.from }, metrics: { costMicros: '24999' } }] },
      { results: [{ campaign: { id: plan.external }, segments: { date: plan.to } }] },
    ]);
  });
  const fetched = await provider.read(plan);
  const cost = normalizeAdsCosts(plan, fetched);
  assert.deepEqual([...cost], [[plan.from, { micros: '24999', cents: 2 }], [plan.to, { micros: '0', cents: 0 }]]);
  assert.equal(cost.has('2024-10-04'), false);
  assert.equal(urls.filter((url) => url.endsWith('/googleAds:searchStream')).length, 2);
  fetched.account[0].results[0].customer.currencyCode = 'EUR';
  assert.throws(() => normalizeAdsCosts(plan, fetched), { status: 422 });
  assert.equal(googleAdsProvider({}), null);
  await assert.rejects(googleAdsProvider(env, async () => new Response('', { status: 503 })).read(plan), { status: 502 });
});
