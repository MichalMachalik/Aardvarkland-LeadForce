import { adsIds, normalizeAdsCosts, syncDays } from './google-ads.mjs';
import { Failure, id } from './validation.mjs';

export function googleAdsStore({ get, all, run, event, allow, transaction }) {
  const permissions = (actor) => allow(actor, 'admin', 'marketing');
  const mapped = (org, campaign) =>
    get('SELECT * FROM google_ads_campaigns WHERE workspace_id=? AND campaign_id=?', org, campaign);

  function plan(actor, input) {
    permissions(actor);
    const campaign = id(input.campaign);
    const binding = mapped(actor.workspace_id, campaign);
    if (!binding) throw new Failure(422, 'Kampaň zatím nemá napojení na Google Ads.');
    const days = syncDays(input);
    return {
      workspace: actor.workspace_id, campaign, revision: binding.revision, customer: binding.customer_id,
      external: binding.external_id, from: days[0], to: days.at(-1), days,
    };
  }

  function management(actor) {
    permissions(actor);
    return all('SELECT campaign_id,customer_id,external_id,last_run FROM google_ads_campaigns WHERE workspace_id=? ORDER BY campaign_id',
      actor.workspace_id).map(({ last_run, ...row }) => ({ ...row, last_run: last_run ? JSON.parse(last_run) : null }));
  }

  function apply(actor, expected, snapshot) {
    return transaction(() => {
      const current = plan(actor, expected);
      if (expected.workspace !== current.workspace || expected.revision !== current.revision ||
          expected.customer !== current.customer || expected.external !== current.external) {
        throw new Failure(409, 'Mezitím proběhla jiná synchronizace nebo se změnilo napojení. Zkuste import znovu.');
      }
      const costs = normalizeAdsCosts(current, snapshot);
      const prior = all('SELECT day,cost_micros,cost_cents,missing FROM google_ads_days WHERE workspace_id=? AND campaign_id=? AND day BETWEEN ? AND ?',
        current.workspace, current.campaign, current.from, current.to);
      const seen = new Map(prior.map((row) => [row.day, row]));
      const result = { from: current.from, to: current.to, added: 0, updated: 0, unchanged: 0, reopened: 0, resolved: 0, missing: [], zero: 0, retained: 0 };
      for (const date of current.days) {
        const row = seen.get(date);
        const fetched = costs.get(date);
        if (!fetched) {
          result.missing.push(date);
          if (row?.cost_cents != null) result.retained++;
          if (row?.missing) continue;
          result.reopened++;
        } else {
          if (fetched.micros === '0') result.zero++;
          if (row?.missing) result.resolved++;
          if (row?.cost_micros == null) result.added++;
          else if (row.cost_micros !== fetched.micros) result.updated++;
          else {
            result.unchanged++;
            if (!row.missing) continue;
          }
        }
        run(`INSERT INTO google_ads_days (workspace_id,campaign_id,day,cost_micros,cost_cents,missing) VALUES (?,?,?,?,?,?)
          ON CONFLICT(workspace_id,campaign_id,day) DO UPDATE SET cost_micros=excluded.cost_micros,cost_cents=excluded.cost_cents,missing=excluded.missing`,
        current.workspace, current.campaign, date, fetched?.micros ?? row?.cost_micros ?? null,
        fetched?.cents ?? row?.cost_cents ?? null, fetched ? 0 : 1);
      }
      const lastRun = { ...result, at: new Date().toISOString() };
      run('UPDATE google_ads_campaigns SET revision=revision+1,last_run=? WHERE workspace_id=? AND campaign_id=?',
        JSON.stringify(lastRun), current.workspace, current.campaign);
      if (result.added || result.updated || result.reopened || result.resolved) {
        event(actor, 'google_ads_sync', current.from + ' až ' + current.to + ' · ID ' + current.external +
          ' · Nové ' + result.added + ' · Opravené ' + result.updated + ' · Chybí ' + result.missing.length);
      }
      return lastRun;
    });
  }

  function configure(actor, input) {
    permissions(actor);
    const campaignId = id(input.campaign);
    const campaign = get('SELECT source FROM client_campaigns WHERE workspace_id=? AND id=?', actor.workspace_id, campaignId);
    if (!campaign || campaign.source.toLowerCase() !== 'google ads') throw new Failure(422, 'Vyberte kampaň z kanálu Google Ads.');
    const { customer, external } = adsIds(input);
    const prior = mapped(actor.workspace_id, campaignId);
    if (prior?.customer_id === customer && prior.external_id === external) return;
    if (prior?.revision) throw new Failure(409, 'Kampaň už má historii importů. Pro jiné ID založte samostatnou kampaň.');
    run(`INSERT INTO google_ads_campaigns (workspace_id,campaign_id,customer_id,external_id) VALUES (?,?,?,?)
      ON CONFLICT(workspace_id,campaign_id) DO UPDATE SET customer_id=excluded.customer_id,external_id=excluded.external_id`,
    actor.workspace_id, campaignId, customer, external);
    event(actor, 'google_ads_configured', 'Kampaň Google Ads ' + external);
  }

  function jobForWorkspace(slug) {
    const actor = get(`SELECT u.id,u.role,u.workspace_id FROM users u JOIN workspaces w ON w.id=u.workspace_id
      WHERE w.slug=? AND u.role='admin' AND u.enabled=1 ORDER BY u.id LIMIT 1`, slug);
    if (!actor) throw new Failure(404, 'Organizace s aktivním správcem nebyla nalezena.');
    return { actor, campaigns: management(actor) };
  }

  return { plan, apply, configure, management, jobForWorkspace };
}
