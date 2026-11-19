import { Failure } from './validation.mjs';

export function prepareExampleBinding(store, profiles) {
  const session = store.createSession(profiles.admin.id);
  try {
    const admin = store.session(session);
    if (!admin) return;
    const state = store.state(admin);
    const campaign = state.clientManagement.campaigns.find((row) => row.code === 'LPF-601' && row.source === 'Google Ads');
    if (campaign && !state.googleAds.some((row) => row.campaign_id === campaign.id)) {
      store.command(admin, 'configure-google-ads', { campaign: campaign.id, customer: '1000000001', external: '700001' });
    }
  } finally {
    store.signOut(session);
  }
}

export function exampleAdsSnapshot(plan, scenario = 'gap') {
  if (!['gap', 'complete', 'correction'].includes(scenario)) throw new Failure(422, 'Vyberte platný scénář importu.');
  const results = [];
  for (const [index, date] of plan.days.entries()) {
    if (index % 3 === 1 && scenario === 'gap') continue;
    const micros = index % 3 === 2 ? '0' : index % 3 === 1 ? '750000000' : scenario === 'correction' ? '500000000' : '450000000';
    results.push({ campaign: { id: plan.external }, segments: { date }, metrics: { costMicros: micros } });
  }
  return {
    account: [{ results: [{ customer: { id: plan.customer, currencyCode: 'CZK', timeZone: 'Europe/Prague' } }] }],
    campaigns: [{ results }],
  };
}
