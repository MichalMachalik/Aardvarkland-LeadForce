import { amount, campaignCode, csv, day, Failure, id, text } from './validation.mjs';

const reportTimezone = { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' };
const calendar = new Intl.DateTimeFormat('sv-SE', reportTimezone);
const dayMilliseconds = 86_400_000;
const pageSize = 25;
export const reportDay = (date = new Date()) => calendar.format(date);
const shiftDay = (iso, offset) => new Date(Date.parse(iso) + offset * dayMilliseconds).toISOString().slice(0, 10);
const costPerHandoff = (cost, count) => cost === null || count === 0 ? null : Math.round(cost / count);
const asCzk = (cents) => cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

function filters(query) {
  const today = reportDay();
  const to = query.has('to') ? day(query.get('to')) : today;
  const from = query.has('from') ? day(query.get('from')) : shiftDay(to, -29);
  if (from > to || Date.parse(to) - Date.parse(from) >= 366 * dayMilliseconds) {
    throw new Failure(422, 'Vyberte platné období o délce nejvýše 366 dní.');
  }
  const campaignId = query.get('campaign') ? id(query.get('campaign')) : null;
  const page = query.has('page') ? id(query.get('page')) : 1;
  return { from, to, campaignId, page };
}

export function clientAccounts({ get, all, run, event, allow }) {
  function requireClient(actor, value) {
    const client = get('SELECT id,name FROM clients WHERE workspace_id=? AND id=?', actor.workspace_id, id(value));
    if (!client) throw new Failure(422, 'Vyberte klienta z této organizace.');
    return client;
  }

  function campaign(actor, value) {
    const campaign = get('SELECT * FROM client_campaigns WHERE workspace_id=? AND id=?', actor.workspace_id, id(value));
    if (!campaign) throw new Failure(422, 'Vyberte kampaň z této organizace.');
    return campaign;
  }

  function management(actor) {
    const org = actor.workspace_id;
    return {
      clients: all('SELECT id,name FROM clients WHERE workspace_id=? ORDER BY name,id', org),
      campaigns: all(`SELECT c.id,c.client_id,c.name,c.project,c.source,c.code,a.name AS client
        FROM client_campaigns c JOIN clients a ON a.id=c.client_id AND a.workspace_id=c.workspace_id
        WHERE c.workspace_id=? ORDER BY a.name,c.name,c.id`, org),
      recentCosts: all(`SELECT e.campaign_id,e.day,e.cost_cents,c.name AS campaign,c.source,c.code
        FROM client_campaign_costs e JOIN client_campaigns c ON c.id=e.campaign_id AND c.workspace_id=e.workspace_id
        WHERE e.workspace_id=? ORDER BY e.day DESC,c.id LIMIT 30`, org),
    };
  }

  function clientName(actor) {
    allow(actor, 'client');
    const row = get(`SELECT c.id,c.name FROM client_users u JOIN clients c ON c.id=u.client_id AND c.workspace_id=u.workspace_id
      WHERE u.workspace_id=? AND u.user_id=?`, actor.workspace_id, actor.id);
    if (!row) throw new Failure(403, 'Účet nemá přiřazeného klienta.');
    return row;
  }

  function report(actor, query, exportReport = false) {
    const client = clientName(actor);
    const { from, to, campaignId, page } = filters(query);
    const org = actor.workspace_id;
    const options = all('SELECT id,name,source,code FROM client_campaigns WHERE workspace_id=? AND client_id=? ORDER BY name,id', org, client.id);
    if (campaignId && !options.some((item) => item.id === campaignId)) throw new Failure(404, 'Kampaň nebyla nalezena.');
    const selection = campaignId ? ' AND c.id=?' : '';
    const ids = [org, client.id, ...(campaignId ? [campaignId] : [])];
    const rows = all(`WITH costs AS (
        SELECT campaign_id,SUM(cost_cents) AS cost_cents,COUNT(*) AS cost_days
        FROM client_campaign_costs WHERE workspace_id=? AND day BETWEEN ? AND ? GROUP BY campaign_id
      ), handoffs AS (
        SELECT campaign_id,COUNT(*) AS handed FROM client_leads
        WHERE workspace_id=? AND handed_day BETWEEN ? AND ? GROUP BY campaign_id
      )
      SELECT c.id,c.name,c.project,c.source,c.code,p.cost_cents,COALESCE(p.cost_days,0) AS cost_days,
        COALESCE(h.handed,0) AS handed
      FROM client_campaigns c LEFT JOIN costs p ON p.campaign_id=c.id LEFT JOIN handoffs h ON h.campaign_id=c.id
      WHERE c.workspace_id=? AND c.client_id=?` + selection + ' ORDER BY handed DESC,c.name,c.id',
    org, from, to, org, from, to, ...ids);
    const campaigns = rows.map((item) => ({ ...item, unit_cents: costPerHandoff(item.cost_cents, item.handed) }));
    if (exportReport) return csv([
      ['od', 'do', 'kanal', 'id_kampane', 'kampan', 'projekt', 'naklady_czk', 'predane_poptavky', 'naklad_na_predani_czk', 'dny_se_zaznamem_nakladu'],
      ...campaigns.map((item) => [from, to, item.source, item.code, item.name, item.project,
        asCzk(item.cost_cents), item.handed, asCzk(item.unit_cents), item.cost_days]),
    ]);
    const totalHanded = campaigns.reduce((sum, row) => sum + row.handed, 0);
    const recordedCost = campaigns.some((row) => row.cost_days > 0)
      ? campaigns.reduce((sum, row) => sum + (row.cost_cents ?? 0), 0) : null;
    const missingCost = campaigns.filter((row) => row.handed > 0 && row.cost_cents === null).length;
    const pages = Math.max(1, Math.ceil(totalHanded / pageSize));
    const currentPage = Math.min(page, pages);
    const deliveries = all(`SELECT l.id,l.name,l.email,l.handed_at,d.handed_day,c.name AS campaign,c.project,c.source,c.code
      FROM client_leads d JOIN leads l ON l.id=d.lead_id AND l.workspace_id=d.workspace_id
      JOIN client_campaigns c ON c.id=d.campaign_id AND c.workspace_id=d.workspace_id
      WHERE c.workspace_id=? AND c.client_id=?` + selection + ` AND d.handed_day BETWEEN ? AND ?
      ORDER BY l.handed_at DESC,l.id DESC LIMIT ? OFFSET ?`,
    ...ids, from, to, pageSize, (currentPage - 1) * pageSize);
    return {
      client: client.name, period: { from, to }, campaign_id: campaignId, options, campaigns, deliveries,
      page: currentPage, pages,
      totals: { handed: totalHanded, cost_cents: recordedCost, unit_cents: missingCost ? null : costPerHandoff(recordedCost, totalHanded), missing_cost: missingCost },
    };
  }

  const actions = {
    'create-client'(actor, body) {
      allow(actor, 'admin');
      const name = text(body.name, 'Jméno klienta', 120);
      const { lastInsertRowid } = run('INSERT INTO clients (workspace_id,name) VALUES (?,?)', actor.workspace_id, name);
      event(actor, 'client_created', name);
      return { id: lastInsertRowid };
    },
    'create-campaign'(actor, body) {
      allow(actor, 'admin', 'marketing');
      const client = requireClient(actor, body.client);
      const name = text(body.name, 'Název kampaně', 120);
      const project = text(body.project, 'Projekt');
      const source = text(body.source, 'Kanál', 65);
      const code = campaignCode(body.code);
      const { lastInsertRowid } = run('INSERT INTO client_campaigns (workspace_id,client_id,name,project,source,code) VALUES (?,?,?,?,?,?)',
        actor.workspace_id, client.id, name, project, source, code);
      event(actor, 'campaign_created', name + ' · ' + code);
      return { id: lastInsertRowid };
    },
    'save-campaign-cost'(actor, body) {
      allow(actor, 'admin', 'marketing');
      const assigned = campaign(actor, body.campaign);
      const date = day(body.day);
      if (date > reportDay()) throw new Failure(422, 'Náklady lze evidovat za dnešek nebo minulý den.');
      const cost = amount(body.cost);
      if (cost > 100000000000) throw new Failure(422, 'Denní náklad překračuje 1 miliardu Kč.');
      const key = [actor.workspace_id, assigned.id, date];
      const prior = get('SELECT cost_cents FROM client_campaign_costs WHERE workspace_id=? AND campaign_id=? AND day=?', ...key);
      if (prior?.cost_cents === cost) return;
      run(`INSERT INTO client_campaign_costs (workspace_id,campaign_id,day,cost_cents) VALUES (?,?,?,?)
        ON CONFLICT(workspace_id,campaign_id,day) DO UPDATE SET cost_cents=excluded.cost_cents`, ...key, cost);
      event(actor, 'campaign_cost_saved', assigned.code + ' · ' + date + ' · ' + (prior ? asCzk(prior.cost_cents) + ' → ' : '') + asCzk(cost) + ' Kč');
    },
  };

  return { requireClient, campaign, management, clientName, report, actions };
}
