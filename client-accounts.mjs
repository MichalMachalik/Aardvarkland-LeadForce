import { amount, campaignCode, csv, day, Failure, id, text } from './validation.mjs';

const reportTimezone = { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' };
const calendar = new Intl.DateTimeFormat('sv-SE', reportTimezone);
const dayMilliseconds = 86_400_000;
const pageSize = 25;
export const reportDay = (date = new Date()) => calendar.format(date);
const shiftDay = (iso, offset) => new Date(Date.parse(iso) + offset * dayMilliseconds).toISOString().slice(0, 10);
const costPerHandoff = (cost, count) => cost === null || count === 0 ? null : Math.round(cost / count);
const asCzk = (cents) => cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

function reportCsv({ period: { from, to }, campaigns }) {
  return csv([
    ['od', 'do', 'kanal', 'id_kampane', 'kampan', 'projekt', 'naklady_czk', 'predane_poptavky', 'naklad_na_predani_czk', 'dny_se_zaznamem_nakladu', 'chybejici_dny_google_ads'],
    ...campaigns.map((item) => [from, to, item.source, item.code, item.name, item.project,
      asCzk(item.cost_cents), item.handed, asCzk(item.unit_cents), item.cost_days, item.import_missing]),
  ]);
}

function monthPeriod(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new Failure(422, 'Vyberte měsíc ve formátu RRRR-MM.');
  const from = day(month + '-01');
  if (month >= reportDay().slice(0, 7)) throw new Failure(422, 'Vyberte již uzavřený měsíc.');
  const next = new Date(from + 'T00:00:00Z');
  const to = new Date(next.setUTCMonth(next.getUTCMonth() + 1) - dayMilliseconds).toISOString().slice(0, 10);
  return { from, to };
}

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

export function clientAccounts({ get, all, run, event, allow, hash }) {
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

  function calculate(actor, client, query, summaryOnly = false) {
    const { from, to, campaignId, page } = filters(query);
    const org = actor.workspace_id;
    const options = all('SELECT id,name,source,code FROM client_campaigns WHERE workspace_id=? AND client_id=? ORDER BY name,id', org, client.id);
    if (campaignId && !options.some((item) => item.id === campaignId)) throw new Failure(404, 'Kampaň nebyla nalezena.');
    const selection = campaignId ? ' AND c.id=?' : '';
    const ids = [org, client.id, ...(campaignId ? [campaignId] : [])];
    const rows = all(`WITH costs AS (
        SELECT r.campaign_id,SUM(COALESCE(CASE WHEN g.missing=1 THEN m.cost_cents END,r.cost_cents)) AS cost_cents,COUNT(*) AS cost_days
        FROM client_report_costs r
        LEFT JOIN google_ads_days g ON g.workspace_id=r.workspace_id AND g.campaign_id=r.campaign_id AND g.day=r.day
        LEFT JOIN client_campaign_costs m ON m.workspace_id=r.workspace_id AND m.campaign_id=r.campaign_id AND m.day=r.day
        WHERE r.workspace_id=? AND r.day BETWEEN ? AND ? GROUP BY r.campaign_id
      ), handoffs AS (
        SELECT campaign_id,COUNT(*) AS handed FROM client_leads
        WHERE workspace_id=? AND handed_day BETWEEN ? AND ? GROUP BY campaign_id
      ), gaps AS (
        SELECT g.campaign_id,COUNT(*) AS days_missing FROM google_ads_days g
        WHERE g.workspace_id=? AND g.missing=1 AND g.day BETWEEN ? AND ? AND NOT EXISTS (
          SELECT 1 FROM client_campaign_costs m WHERE m.workspace_id=g.workspace_id AND m.campaign_id=g.campaign_id AND m.day=g.day
        ) GROUP BY g.campaign_id
      )
      SELECT c.id,c.name,c.project,c.source,c.code,p.cost_cents,COALESCE(p.cost_days,0) AS cost_days,
        COALESCE(h.handed,0) AS handed,COALESCE(g.days_missing,0) AS import_missing
      FROM client_campaigns c LEFT JOIN costs p ON p.campaign_id=c.id LEFT JOIN handoffs h ON h.campaign_id=c.id
      LEFT JOIN gaps g ON g.campaign_id=c.id
      WHERE c.workspace_id=? AND c.client_id=?` + selection + ' ORDER BY handed DESC,c.name,c.id',
    org, from, to, org, from, to, org, from, to, ...ids);
    const campaigns = rows.map((item) => ({ ...item, unit_cents: item.import_missing ? null : costPerHandoff(item.cost_cents, item.handed) }));
    const totalHanded = campaigns.reduce((sum, row) => sum + row.handed, 0);
    const recordedCost = campaigns.some((row) => row.cost_days > 0)
      ? campaigns.reduce((sum, row) => sum + (row.cost_cents ?? 0), 0) : null;
    const missingCost = campaigns.filter((row) => row.handed > 0 && row.cost_cents === null).length;
    const importMissing = campaigns.reduce((sum, row) => sum + row.import_missing, 0);
    const summary = {
      client: client.name, period: { from, to }, campaigns, import_missing: importMissing,
      totals: { handed: totalHanded, cost_cents: recordedCost, unit_cents: missingCost || importMissing ? null : costPerHandoff(recordedCost, totalHanded), missing_cost: missingCost },
    };
    if (summaryOnly) return summary;
    const pages = Math.max(1, Math.ceil(totalHanded / pageSize));
    const currentPage = Math.min(page, pages);
    const deliveries = all(`SELECT l.id,l.name,l.email,l.handed_at,d.handed_day,c.name AS campaign,c.project,c.source,c.code,
      r.confirmed_at,(SELECT q.status FROM handoff_claims q WHERE q.workspace_id=d.workspace_id AND q.lead_id=d.lead_id
        ORDER BY q.id DESC LIMIT 1) AS claim_status,
      (SELECT m.kind FROM handoff_claims q JOIN handoff_claim_messages m ON m.workspace_id=q.workspace_id AND m.claim_id=q.id
        WHERE q.workspace_id=d.workspace_id AND q.lead_id=d.lead_id AND q.status='review' ORDER BY m.id DESC LIMIT 1) AS claim_turn
      FROM client_leads d JOIN leads l ON l.id=d.lead_id AND l.workspace_id=d.workspace_id
      JOIN client_campaigns c ON c.id=d.campaign_id AND c.workspace_id=d.workspace_id
      LEFT JOIN handoff_receipts r ON r.workspace_id=d.workspace_id AND r.lead_id=d.lead_id
      WHERE c.workspace_id=? AND c.client_id=?` + selection + ` AND d.handed_day BETWEEN ? AND ?
      ORDER BY l.handed_at DESC,l.id DESC LIMIT ? OFFSET ?`,
    ...ids, from, to, pageSize, (currentPage - 1) * pageSize);
    return {
      ...summary, campaign_id: campaignId, options, deliveries, page: currentPage, pages,
    };
  }

  function report(actor, query, exportReport = false) {
    const result = calculate(actor, clientName(actor), query, exportReport);
    return exportReport ? reportCsv(result) : result;
  }

  function publishedScope(actor, value) {
    if (actor.role === 'client') return clientName(actor);
    allow(actor, 'admin', 'marketing');
    return requireClient(actor, value);
  }

  function monthlyReports(actor, query) {
    const client = publishedScope(actor, query.get('client'));
    const rows = all(`SELECT id,month,revision,note,published_at FROM client_monthly_reports
      WHERE workspace_id=? AND client_id=? ORDER BY month DESC,revision DESC`, actor.workspace_id, client.id);
    const month = query.get('month');
    if (!month || actor.role === 'client') return { rows };
    const period = monthPeriod(month);
    const preview = calculate(actor, client, new URLSearchParams(period), true);
    return { rows, preview, previewKey: hash(JSON.stringify(preview)) };
  }

  function monthlyReport(actor, value, exportReport = false) {
    allow(actor, 'admin', 'marketing', 'client');
    const org = actor.workspace_id;
    const row = get(`SELECT id,month,revision,note,published_at,client_id,payload FROM client_monthly_reports
      WHERE workspace_id=? AND id=?`, org, id(value));
    if (!row || actor.role === 'client' && row.client_id !== clientName(actor).id) throw new Failure(404, 'Uzávěrka nebyla nalezena.');
    const { client_id, payload, ...metadata } = row;
    const report = JSON.parse(payload);
    return exportReport ? reportCsv(report) : { ...metadata, report };
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
    'publish-monthly-report'(actor, body) {
      allow(actor, 'admin');
      const client = requireClient(actor, body.client);
      const period = monthPeriod(body.month);
      const report = calculate(actor, client, new URLSearchParams(period), true);
      if (report.import_missing || report.totals.missing_cost || report.totals.cost_cents === null) {
        throw new Failure(409, 'Před uzávěrkou doplňte náklady a ověřte chybějící dny importu.');
      }
      const payload = JSON.stringify(report);
      const last = get(`SELECT id,revision,payload FROM client_monthly_reports
        WHERE workspace_id=? AND client_id=? AND month=? ORDER BY revision DESC LIMIT 1`, actor.workspace_id, client.id, body.month);
      if (last?.payload === payload) return { id: last.id };
      if (Number(body.revision) !== (last?.revision ?? 0) || body.preview !== hash(payload)) {
        throw new Failure(409, 'Podklady nebo uzávěrku mezitím někdo změnil. Načtěte náhled znovu.');
      }
      const optional = body.note == null || typeof body.note === 'string' && !body.note.trim();
      const note = last || !optional ? text(body.note, 'Důvod revize nebo poznámka k uzávěrce', 500) : '';
      const revision = (last?.revision ?? 0) + 1;
      const { lastInsertRowid } = run(`INSERT INTO client_monthly_reports
        (workspace_id,client_id,month,revision,payload,note,published_by,published_at) VALUES (?,?,?,?,?,?,?,?)`,
      actor.workspace_id, client.id, body.month, revision, payload, note, actor.id, new Date().toISOString());
      event(actor, 'monthly_report_published', client.name + ' · ' + body.month + ' · v' + revision);
      return { id: lastInsertRowid };
    },
  };

  return { requireClient, campaign, management, clientName, report, monthlyReports, monthlyReport, actions };
}
