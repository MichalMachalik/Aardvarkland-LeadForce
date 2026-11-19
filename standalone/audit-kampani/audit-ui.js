(function () {
  'use strict';
  const audit = window.CampaignAudit;
  const demo = window.CampaignDemo;
  const fixtures = window.AuditFixtures;
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat('cs-CZ');
  const currency = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat('cs-CZ', { style: 'percent', maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'UTC' });
  const money = (value) => value === null ? '—' : currency.format(value);
  const day = (value) => dateFormat.format(new Date(`${value}T00:00:00Z`));
  const range = (dates) => dates ? `${day(dates[0])}–${day(dates[1])}` : 'bez záznamů';
  const rate = (value) => value === null ? '—' : percent.format(value);
  const storage = () => { try { return window.sessionStorage; } catch { return null; } };
  const hosted = ['https:', 'http:'].includes(location.protocol);
  const portalUrl = '../portal-investora/index.html';
  const inputs = { spend: null, leads: null };
  const revisions = { spend: 0, leads: 0 };
  const views = { report: 'Přehled kampaní', import: 'Import dat', leads: 'Poptávky' };
  if (fixtures) views.investor = 'Portál investora';
  const pageSize = 15;
  let dataset;
  let report;
  let start;
  let end;
  let source = '';
  let isDemo;
  let pageIndex = 0;
  let campaignFilter = '';
  let statusTimeout;
  let pendingImport = null;
  let journeyStep = 0;
  const journeyLabels = ['Reklama a web', 'Návštěva', 'Poptávka', 'Kvalifikace', 'Předání', 'Péče', 'Dlouhodobý vztah'];
  const journeyActions = ['Zaznamenat předání', 'Připravit kontrolní e-mail', 'Naplánovat oslovení', 'Zaznamenat obnovený zájem'];
  const savedOpportunities = new Set();
  const originalStatuses = new Map();

  if (fixtures) {
    try {
      const saved = JSON.parse(storage()?.getItem('kampane.demo.oblibene.v1') || '[]');
      for (const { id } of fixtures.opportunities) if (Array.isArray(saved) && saved.includes(id)) savedOpportunities.add(id);
    } catch { /* The built-in investor view also works without browser storage. */ }
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function showStatus(text) {
    window.clearTimeout(statusTimeout);
    $('app-status').textContent = text;
    $('app-status').hidden = false;
    statusTimeout = window.setTimeout(() => { $('app-status').hidden = true; }, 7000);
  }

  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function emptyRow(text, columns) {
    const row = element('tr');
    const cell = element('td', text, 'empty');
    cell.colSpan = columns;
    row.append(cell);
    return row;
  }

  function button(text, action, className = 'row-link') {
    const control = element('button', text, className);
    control.type = 'button';
    control.addEventListener('click', action);
    return control;
  }

  function openDetails(title, children) {
    $('details-title').textContent = title;
    $('details-body').replaceChildren(...children);
    $('details').showModal();
  }

  function campaignDetail(row) {
    const items = [
      ['Výdaje', money(row.cents / 100)],
      ['Přiřazené poptávky', String(row.leads)],
      ['Kvalifikované poptávky', String(row.qualified)],
      ['Podíl kvalifikovaných', rate(row.rate)],
    ];
    if (report.tracksHandoffs) items.push(['Předané klientovi', String(row.handedOff)], ['Cena za předanou', money(row.costPerHandoff)]);
    const summary = element('dl', undefined, 'detail-values');
    items.forEach(([label, value]) => summary.append(element('dt', label), element('dd', value)));
    const raw = row.cpl === null ? 'Cena za poptávku je nedostupná, protože v období nejsou přiřazené poptávky.' : `Cena za poptávku · ${money(row.cents / 100)} ÷ ${row.leads} = ${money(row.cpl)}`;
    const qualified = row.cpql === null ? 'Cena za kvalifikovanou je nedostupná, protože v období není žádná kvalifikovaná poptávka.' : `Cena za kvalifikovanou · ${money(row.cents / 100)} ÷ ${row.qualified} = ${money(row.cpql)}`;
    const open = (filter) => { $('details').close(); openLeads(row.key, filter); };
    const actions = element('div', undefined, 'actions');
    actions.append(button('Zobrazit poptávky', () => open('all'), 'button secondary'));
    if (row.qualified) actions.append(button('Zobrazit kvalifikované', () => open('qualified'), 'button primary'));
    if (row.handedOff) actions.append(button('Zobrazit předané', () => open('handed-off'), 'button secondary'));
    openDetails(`${row.source} · ${row.id}`, [element('p', `${row.name} · ${day(start)}–${day(end)}`), summary, element('p', raw, 'formula'), element('p', qualified, 'formula'), actions]);
  }

  function duplicateDetail() {
    const matches = dataset.duplicateRecords;
    const list = element('ul', undefined, 'detail-list');
    for (const item of matches.slice(0, 50)) {
      list.append(element('li', `${item.kind === 'spend' ? 'Výdaje' : 'Poptávky'} · ${item.label} · záznam ${item.record} je shodný se záznamem ${item.original}`));
    }
    const additional = matches.length > 50 ? ' Zobrazeno prvních 50.' : '';
    openDetails('Shodné záznamy v importu', [element('p', `${number.format(matches.length)} přeskočených záznamů.${additional}`), list]);
  }

  function cheapest(metric) {
    const comparable = report.rows.filter((row) => row[metric] !== null);
    if (!comparable.length) return null;
    const sorted = comparable.sort((a, b) => a[metric] - b[metric]);
    return !sorted[1] || sorted[0][metric] < sorted[1][metric] ? sorted[0] : null;
  }

  function renderBars(rows) {
    const target = $('cost-bars');
    target.replaceChildren();
    const visible = rows.slice(0, 5);
    if (!visible.length) target.append(element('p', 'V tomto období nejsou výdaje za kampaně.'));
    const highest = Math.max(1, ...visible.flatMap((row) => [row.cpl || 0, row.cpql || 0]));
    for (const row of visible) {
      const group = element('div');
      group.append(element('span', `${row.source} · ${row.id}`, 'chart-label'));
      for (const [value, kind, desc] of [[row.cpl, 'raw', 'Cena za poptávku'], [row.cpql, 'qualified', 'Cena za kvalifikovanou poptávku']]) {
        const line = element('div', undefined, 'bar-line');
        const track = element('div', undefined, 'bar-track');
        const fill = element('i', undefined, `bar-fill bar-${kind}`);
        track.setAttribute('aria-hidden', 'true');
        fill.style.width = `${100 * (value || 0) / highest}%`;
        track.append(fill);
        const label = element('span', money(value), 'bar-number');
        label.setAttribute('aria-label', `${desc} ${value === null ? 'není k dispozici' : money(value)}`);
        line.append(track, label);
        group.append(line);
      }
      target.append(group);
    }
    if (rows.length > visible.length) target.append(element('p', 'Další kampaně jsou v tabulce.'));
    const raw = cheapest('cpl');
    const qualified = cheapest('cpql');
    const insight = $('insight');
    const showInsight = raw && qualified && raw.key !== qualified.key;
    insight.hidden = !showInsight;
    if (showInsight) {
      insight.textContent = `Nejnižší cenu za poptávku má ${raw.source} (${raw.id}). Po započtení kvalifikace vychází nejlevněji ${qualified.source} (${qualified.id}) za ${money(qualified.cpql)}.`;
    }
  }

  function renderSummaries() {
    const funnel = $('funnel');
    const stages = [['Zachycené poptávky', report.leads.length], ['Přiřazené ke kampani', report.totals.leads], ['Kvalifikované', report.totals.qualified]];
    funnel.replaceChildren(...stages.map(([label, value]) => summaryBar(label, number.format(value), value / Math.max(1, report.leads.length))));
    const handoff = $('handoff-summary');
    handoff.hidden = !report.tracksHandoffs;
    if (report.tracksHandoffs) {
      const count = report.totals.handedOff;
      const label = `Předané klientovi · ${number.format(count)}`;
      handoff.replaceChildren(count ? button(label, () => openLeads('', 'handed-off')) : element('strong', label),
        element('p', `Cena za předanou ${money(report.costPerHandoff)}`));
    }
    const totals = new Map();
    for (const row of report.rows) totals.set(row.source, (totals.get(row.source) || 0) + row.cents);
    const channels = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs'));
    $('channel-bars').replaceChildren(...channels.map(([channel, cents]) => summaryBar(channel, money(cents / 100), cents / Math.max(1, channels[0][1]))));
    if (!channels.length) $('channel-bars').append(element('p', 'V tomto období nejsou výdaje.'));
  }

  function summaryBar(label, value, portion) {
    const row = element('div', undefined, 'summary-bar');
    const track = element('div', undefined, 'bar-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = element('i', undefined, 'bar-fill bar-qualified');
    fill.style.width = `${portion * 100}%`;
    track.append(fill);
    row.append(element('span', label), element('strong', value), track);
    return row;
  }

  function renderReport() {
    $('data-scope').textContent = `Výdaje ${range(dataset.spendDates)} · CRM ${range(dataset.leadDates)}`;
    const metrics = [
      ['Výdaje za reklamu', money(report.totals.cents / 100)],
      ['Přiřazené poptávky', number.format(report.totals.leads)],
      ['Kvalifikované', number.format(report.totals.qualified)],
      ['Cena za kvalifikovanou', money(report.cpql)],
    ];
    $('metrics').replaceChildren(...metrics.map(([label, value], index) => {
      const box = element('dl', undefined, index === 3 ? 'metric metric-emphasis' : 'metric');
      box.append(element('dt', label), element('dd', value));
      if (index === 2 && report.rate !== null) box.append(element('dd', `${rate(report.rate)} z přiřazených`, 'metric-note'));
      return box;
    }));
    const diagnostics = [
      ['Chybí kanál nebo kampaň', report.unassigned, () => openLeads('', 'missing-key')],
      [audit.attributionLabels['outside-period'], report.outsideSpend, () => openLeads('', 'outside-period')],
      [audit.attributionLabels['unknown-campaign'], report.noSpend - report.outsideSpend, () => openLeads('', 'unknown-campaign')],
      ['Chybí stav CRM', report.noStatus, () => openLeads('', 'missing-status')],
      ['Shodné řádky v importu', dataset.duplicates, duplicateDetail],
    ];
    $('quality-list').replaceChildren(...diagnostics.map(([label, value, action]) => {
      const line = element('li');
      line.append(value ? button(label, action) : element('span', label), element('strong', number.format(value), value ? 'quality-value warning' : 'quality-value'));
      return line;
    }));
    $('coverage').textContent = report.leads.length
      ? `${rate(report.totals.leads / report.leads.length)} přiřazeno · ${number.format(report.totals.leads)} z ${number.format(report.leads.length)} poptávek`
      : 'Ve zvoleném období žádné poptávky.';
    $('show-issues').disabled = !report.unassigned && !report.noSpend;
    $('export-findings').disabled = !report.unassigned && !report.noSpend && !report.noStatus;
    $('export').disabled = !report.rows.length;
    renderSummaries();

    const byCost = (a, b) => (a.cpql ?? Infinity) - (b.cpql ?? Infinity);
    const sorts = { cpql: byCost, rate: (a, b) => (b.rate ?? -1) - (a.rate ?? -1), spend: (a, b) => b.cents - a.cents, name: () => 0 };
    const byName = (a, b) => a.name.localeCompare(b.name, 'cs');
    const order = sorts[$('campaign-sort').value];
    const ordered = [...report.rows].sort((a, b) => order(a, b) || byName(a, b));
    renderBars([...report.rows].sort((a, b) => byCost(a, b) || byName(a, b)));
    const target = $('campaign-rows');
    target.replaceChildren();
    if (!ordered.length) target.append(emptyRow('Ve zvoleném období nejsou žádné kampaně.', 7));
    const rows = document.createDocumentFragment();
    for (const row of ordered) {
      const line = element('tr');
      const label = element('td');
      const link = button(row.name, () => openLeads(row.key, 'all'));
      label.append(link, element('span', `${row.source} · ${row.id}`, 'row-sub'));
      line.append(label);
      for (const [value, label] of [[money(row.cents / 100), 'Výdaje'], [number.format(row.leads), 'Poptávky'], [number.format(row.qualified), 'Kvalifikované'], [rate(row.rate), 'Podíl'], [money(row.cpl), 'Cena za poptávku'], [money(row.cpql), 'Cena za kvalifikovanou']]) {
        const cell = element('td');
        const detail = button(value, () => campaignDetail(row), 'row-link metric-link');
        detail.setAttribute('aria-label', `${label} · ${row.id} · ${value}`);
        cell.append(detail);
        line.append(cell);
      }
      rows.append(line);
    }
    target.append(rows);
  }

  function renderLeads() {
    const issue = $('filter-issue').value;
    const query = $('filter-search').value.trim().toLowerCase();
    const predicates = { all: () => true, issue: (row) => Boolean(row.issue), matched: (row) => !row.issue,
      'missing-key': (row) => !row.source || !row.campaign, 'missing-spend': (row) => row.issue === 'Bez výdajů v období',
      'outside-period': (row) => row.attribution === 'outside-period', 'unknown-campaign': (row) => row.attribution === 'unknown-campaign',
      'missing-status': (row) => !row.status, qualified: (row) => row.qualified && !row.issue,
      'handed-off': (row) => Boolean(row.handedOff) && !row.issue };
    const filtered = report.leads.filter((row) => (!campaignFilter || row.key === campaignFilter)
      && predicates[issue](row)
      && (!query || row.id.toLowerCase().includes(query)));
    const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
    pageIndex = Math.min(lastPage, Math.max(0, pageIndex));
    const first = pageIndex * pageSize;
    const visible = filtered.slice(first, first + pageSize);
    $('leads-period').textContent = `${day(start)} až ${day(end)} · podle data vzniku poptávky`;
    $('lead-count').textContent = filtered.length ? `${number.format(first + 1)}–${number.format(first + visible.length)} z ${number.format(filtered.length)}` : '0 poptávek';
    $('page-prev').disabled = pageIndex === 0;
    $('page-next').disabled = pageIndex === lastPage;
    const target = $('lead-rows');
    target.replaceChildren();
    if (!visible.length) target.append(emptyRow('Filtru neodpovídá žádná poptávka.', 7));
    for (const item of visible) {
      const line = element('tr');
      line.append(element('th', item.id));
      line.firstChild.scope = 'row';
      line.append(element('td', day(item.date), 'nowrap'), element('td', item.source || '—'), element('td', item.campaign || '—'));
      const state = element('td', item.status || 'Chybí stav', item.qualified ? 'lead-qualified' : '');
      if (item.handedOff) state.append(element('span', `Předáno ${day(item.handedOff)}`, 'row-sub'));
      line.append(state);
      const attribution = element('td', item.issue || 'Přiřazeno', item.issue ? 'lead-issue' : '');
      if (item.issue) attribution.append(element('span', audit.attributionLabels[item.attribution], 'row-sub'));
      line.append(attribution);
      const cell = element('td');
      const edit = button('Upravit stav', () => editStatus(item), 'button secondary');
      edit.dataset.lead = item.id;
      cell.append(edit);
      line.append(cell);
      target.append(line);
    }
    renderJourney(filtered);
  }

  function editStatus(item) {
    const form = element('form', undefined, 'status-editor');
    const input = element('input');
    input.id = 'lead-status-value';
    input.value = item.status;
    input.autocomplete = 'off';
    input.maxLength = 200;
    const label = element('label', 'Stav CRM');
    label.htmlFor = input.id;
    const journeyLead = isDemo && item.id === demo.fixture.id;
    const handoff = element('input');
    handoff.type = 'date';
    handoff.id = 'lead-handoff-date';
    handoff.min = item.date;
    handoff.value = item.handedOff || '';
    const handoffLabel = element('label', 'Datum předání');
    handoffLabel.htmlFor = handoff.id;
    const errorSlot = element('p', '', 'form-error');
    errorSlot.setAttribute('role', 'alert');
    errorSlot.hidden = true;
    const actions = element('div', undefined, 'actions');
    const save = element('button', 'Uložit stav', 'button primary');
    save.type = 'submit';
    actions.append(save);
    const apply = (value, restore = false, handedOff = item.handedOff || '') => {
      const next = value.trim();
      const owned = dataset.leads.find((row) => row.id === item.id);
      try {
        owned.handedOff = audit.handoffDate(handedOff, owned.date);
      } catch (error) {
        errorSlot.textContent = error.message;
        errorSlot.hidden = false;
        return;
      }
      if (owned.handedOff) dataset.tracksHandoffs = true;
      if (next !== owned.status) {
        if (restore) originalStatuses.delete(item.id);
        else originalStatuses.set(item.id, owned.status);
        owned.status = next;
        if (journeyLead) {
          const qualified = audit.isQualified(dataset, next);
          if (!qualified) {
            journeyStep = 0;
            owned.handedOff = '';
          }
          demo.save(storage(), qualified, journeyStep);
        }
      }
      $('details').close();
      refresh();
      [...$('lead-rows').querySelectorAll('button')].find((candidate) => candidate.dataset.lead === item.id)?.focus();
      showStatus(`Poptávka ${item.id} uložena.`);
    };
    if (!item.qualified) actions.append(button('Potvrdit zájem', () => apply(dataset.qualifiedLabel), 'button secondary'));
    if (originalStatuses.has(item.id)) actions.append(button('Vrátit předchozí stav', () => apply(originalStatuses.get(item.id), true), 'button secondary'));
    form.append(label, input);
    if (!journeyLead) form.append(handoffLabel, handoff);
    form.append(errorSlot, actions);
    form.addEventListener('submit', (event) => { event.preventDefault(); apply(input.value, false, handoff.value); });
    openDetails(`Stav poptávky · ${item.id}`, [form]);
    input.focus();
  }

  function casePortalDestination() {
    if (!hosted) return '#investor';
    return demo.get(storage())?.step === journeyStep ? `${portalUrl}?predani=1#komunikace` : '#investor';
  }

  function renderJourney(filtered) {
    if (!fixtures) return;
    const lead = isDemo && filtered.find(({ id }) => id === demo.fixture.id);
    $('journey').hidden = !lead;
    if (!lead) return;
    const completed = lead.qualified ? [4, 5, 6, 6, 7][journeyStep] : 3;
    $('journey-steps').replaceChildren(...journeyLabels.map((label, index) => {
      const step = element('li', label, index < completed ? 'complete' : '');
      if (index === completed) step.setAttribute('aria-current', 'step');
      return step;
    }));
    $('journey-note').textContent = fixtures.journeyNotes[journeyStep];
    $('journey-next').hidden = !lead.qualified || journeyStep >= journeyActions.length;
    $('journey-next').textContent = journeyActions[journeyStep] || '';
    $('journey-portal').hidden = journeyStep < 2;
    $('journey-portal').href = casePortalDestination();
  }

  function renderInvestor() {
    const items = fixtures.investorUpdates.filter(([step]) => step <= journeyStep);
    $('investor-updates').replaceChildren(...items.map(([, date, text]) => element('li', `${date} · ${text}`)));
    $('investor-saved-count').textContent = String(savedOpportunities.size);
    const onlySaved = $('investor-filter').value === 'saved';
    const target = $('investor-opportunities');
    target.replaceChildren();
    for (const item of fixtures.opportunities) {
      if (onlySaved && !savedOpportunities.has(item.id)) continue;
      const row = element('div', undefined, 'investor-item');
      const label = element('div');
      label.append(element('strong', item.name), element('p', item.type));
      if (savedOpportunities.has(item.id)) label.append(element('span', 'Uloženo', 'saved-label'));
      const details = button('Otevřít detail', () => investorDetails(item, details), 'button secondary');
      details.setAttribute('aria-label', `Otevřít detail · ${item.name}`);
      row.append(label, details);
      target.append(row);
    }
    if (!target.childElementCount) target.append(element('p', 'Žádná uložená příležitost.'));
  }

  function investorDetails(item, opener) {
    const label = () => savedOpportunities.has(item.id) ? 'Odebrat z uložených' : 'Uložit příležitost';
    const save = button(label(), () => {
      if (savedOpportunities.has(item.id)) savedOpportunities.delete(item.id);
      else savedOpportunities.add(item.id);
      try { storage()?.setItem('kampane.demo.oblibene.v1', JSON.stringify([...savedOpportunities])); }
      catch { /* Keep the selection for the current page. */ }
      save.textContent = label();
      $('investor-saved-count').textContent = String(savedOpportunities.size);
    }, 'button primary');
    $('details').addEventListener('close', () => {
      renderInvestor();
      const detail = [...$('investor-opportunities').querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === opener.getAttribute('aria-label'));
      (detail || $('investor-filter')).focus();
    }, { once: true });
    openDetails(item.name, [element('p', item.type), element('p', item.note, 'formula'), save]);
  }

  function renderCampaignFilter() {
    const filter = $('filter-campaign');
    filter.replaceChildren(new Option('Všechny kampaně', ''));
    for (const item of report.rows) filter.add(new Option(`${item.source} · ${item.id} · ${item.name}`, item.key));
    filter.value = campaignFilter;
    if (filter.selectedIndex === -1) {
      filter.value = '';
      campaignFilter = '';
    }
  }

  function refresh() {
    report = audit.calculate(dataset, start, end, source);
    renderReport();
    renderCampaignFilter();
    renderLeads();
  }

  function route() {
    let requested = location.hash.slice(1);
    if (requested === 'investor' && (!fixtures || journeyStep < 2 || casePortalDestination() !== '#investor')) {
      history.replaceState(history.state, '', '#report');
      requested = 'report';
    }
    const active = Object.hasOwn(views, requested) ? requested : 'report';
    $('view-name').textContent = views[active];
    for (const name of Object.keys(views)) $(name).hidden = name !== active;
    if (active === 'investor') renderInvestor();
    document.querySelectorAll('[data-route]').forEach((link) => {
      if (link.dataset.route === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  function openLeads(campaign, issue, query = '') {
    campaignFilter = campaign;
    pageIndex = 0;
    $('filter-issue').value = issue;
    $('filter-search').value = query;
    renderCampaignFilter();
    renderLeads();
    location.hash = 'leads';
  }

  function useDataset(next, demoFlag) {
    dataset = next;
    isDemo = demoFlag;
    [start, end] = next.dates;
    $('date-from').value = start;
    $('date-to').value = end;
    const names = new Set();
    for (const rows of [dataset.spend, dataset.leads]) for (const item of rows) if (item.source) names.add(item.source);
    const sources = [...names].sort((a, b) => a.localeCompare(b, 'cs'));
    const sourceOptions = document.createDocumentFragment();
    sourceOptions.append(new Option('Všechny kanály', ''));
    for (const label of sources) sourceOptions.append(new Option(label, label));
    $('report-source').replaceChildren(sourceOptions);
    source = '';
    setPeriodError();
    $('filter-issue').value = 'all';
    $('filter-search').value = '';
    campaignFilter = '';
    originalStatuses.clear();
    pageIndex = 0;
    refresh();
  }

  function loadSample(received = null) {
    journeyStep = received?.step || 0;
    const sample = fixtures.sampleCsv();
    const spend = audit.readCsv(sample.spend);
    const leads = audit.readCsv(sample.leads);
    const spendData = audit.importedRows(spend, audit.guessFields(spend, 'spend'), 'spend');
    const leadData = audit.importedRows(leads, audit.guessFields(leads, 'leads'), 'leads');
    if (received && !leadData.rows.some(({ id }) => id === received.lead.id)) {
      leadData.rows.push({ ...received.lead, source: audit.sourceKey(received.lead.source), status: received.qualified ? 'Kvalifikovaná' : received.lead.status,
        handedOff: journeyStep > 0 ? fixtures.handedOffDate : '' });
    }
    useDataset(audit.prepare(spendData, leadData, ['Kvalifikovaná']), true);
    if (received?.qualified) originalStatuses.set(received.lead.id, received.lead.status);
  }

  function showError(text) {
    $('import-error').textContent = text;
    $('import-error').hidden = !text;
  }

  function setPeriodError(text = '') {
    const message = $('period-error');
    message.textContent = text;
    message.hidden = !text;
    for (const field of [$('date-from'), $('date-to')]) {
      if (text) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
  }

  function updateImportAction() {
    const waitingForCurrency = Boolean(pendingImport) && !$('confirm-czk').checked;
    $('use-files').disabled = !pendingImport || waitingForCurrency;
    $('import-confirmation').hidden = !waitingForCurrency;
  }

  function invalidatePreview() {
    pendingImport = null;
    updateImportAction();
    $('import-preview').hidden = true;
    showError('');
  }

  function previewFile(kind, label) {
    const fields = Object.fromEntries(audit.schema[kind].map(({ key }) => [key, Number($(`map-${kind}-${key}`).value)]));
    const check = audit.inspectRows(inputs[kind], fields, kind);
    const card = element('article', undefined, 'preview-card');
    card.append(element('h3', label), element('p', `Rozsah ${range(check.dates)}`),
      element('p', `${check.rows.length} použitelných · ${check.duplicates} duplicit · ${check.invalidCount} chybných`));
    const sampleRows = element('ul', undefined, 'detail-list');
    for (const row of check.rows.slice(0, 3)) {
      const text = kind === 'spend' ? `${day(row.date)} · ${row.source} · ${row.campaign} · ${money(row.cents / 100)}` : `${row.id} · ${day(row.date)} · ${row.campaign || 'bez kampaně'} · ${row.status || 'chybí stav'}`;
      sampleRows.append(element('li', text));
    }
    if (sampleRows.childElementCount) card.append(sampleRows);
    if (check.errors.length) {
      const invalid = element('ul', undefined, 'detail-list preview-errors');
      for (const message of check.errors) invalid.append(element('li', message));
      if (check.invalidCount > check.errors.length) invalid.append(element('li', `Další chybné záznamy · ${check.invalidCount - check.errors.length}`));
      card.append(invalid);
    }
    return { check, card };
  }

  function previewImport() {
    invalidatePreview();
    try {
      if (!inputs.spend || !inputs.leads) throw new Error('Nejprve načtěte oba CSV soubory.');
      const files = [['spend', 'Reklamní výdaje'], ['leads', 'CRM poptávky']];
      const panel = $('import-preview');
      const results = [];
      const cards = files.map(([kind, label]) => {
        try {
          const parsed = previewFile(kind, label);
          results.push(parsed.check);
          return parsed.card;
        } catch (error) {
          const card = element('article', undefined, 'preview-card');
          card.append(element('h3', label), element('p', error.message, 'preview-errors'));
          return card;
        }
      });
      panel.replaceChildren(...cards);
      panel.hidden = false;
      if (results.length !== files.length || results.some((file) => file.invalidCount)) {
        throw new Error('Opravte zjištění v náhledu. Otevřený report zůstává bez změny.');
      }
      pendingImport = audit.prepare(results[0], results[1], $('qualified-states').value.split(';'));
      updateImportAction();
    } catch (error) { showError(error.message); }
  }

  function renderMapping(kind, doc) {
    const defaults = audit.guessFields(doc, kind);
    const container = $(`map-${kind}`);
    for (const field of audit.schema[kind]) {
      const label = element('label', field.label);
      const select = element('select');
      select.id = `map-${kind}-${field.key}`;
      select.add(new Option(field.optional ? 'Nepoužít' : 'Vyberte sloupec', '-1'));
      doc.headings.forEach((value, index) => select.add(new Option(value, String(index))));
      select.value = String(defaults[field.key]);
      select.addEventListener('change', invalidatePreview);
      label.append(select);
      container.append(label);
    }
  }

  function decode(bytes) {
    const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
    if (prefix[0] === 0xff && prefix[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (prefix[0] === 0xfe && prefix[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder('windows-1250').decode(bytes); }
  }

  for (const kind of ['spend', 'leads']) {
    $(`file-${kind}`).addEventListener('change', async (event) => {
      const revision = ++revisions[kind];
      const file = event.target.files[0];
      inputs[kind] = null;
      $(`map-${kind}`).replaceChildren();
      const details = $(`file-${kind}-info`);
      details.textContent = file ? `Čtu ${file.name}…` : '';
      invalidatePreview();
      if (!file) return;
      try {
        if (file.size > 8_000_000) throw new Error('Soubor je větší než 8 MB. Zvolte kratší období.');
        const document = audit.readCsv(decode(await file.arrayBuffer()));
        if (revisions[kind] !== revision) return;
        renderMapping(kind, document);
        inputs[kind] = document;
        details.textContent = `${file.name} · ${number.format(document.entries.length)} záznamů`;
      } catch (error) {
        if (revisions[kind] !== revision) return;
        details.textContent = `${file.name} — ${error.message}`;
      }
    });
  }

  $('import-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingImport || !$('confirm-czk').checked) return;
    const result = pendingImport;
    useDataset({ ...result, leads: result.leads.map((row) => ({ ...row })) }, false);
    const url = new URL(location.href);
    if (url.searchParams.has('predani')) {
      url.searchParams.delete('predani');
      history.replaceState(null, '', url);
    }
    location.hash = 'report';
    showStatus(`Importováno ${number.format(result.spend.length)} řádků výdajů a ${number.format(result.leads.length)} poptávek. Přeskočené shodné řádky · ${number.format(result.duplicates)}.`);
  });
  $('preview-files').addEventListener('click', previewImport);
  $('qualified-states').addEventListener('input', invalidatePreview);
  $('confirm-czk').addEventListener('change', updateImportAction);

  $('journey-next')?.addEventListener('click', () => {
    if (!isDemo || journeyStep >= journeyActions.length) return;
    const lead = dataset.leads.find((row) => row.id === demo.fixture.id);
    if (!lead || !audit.isQualified(dataset, lead.status)) return;
    journeyStep++;
    if (journeyStep === 1) lead.handedOff = fixtures.handedOffDate;
    demo.save(storage(), true, journeyStep);
    refresh();
    showStatus(fixtures.journeyNotes[journeyStep]);
    if (journeyStep >= journeyActions.length) $('journey-portal').focus();
  });
  $('investor-filter')?.addEventListener('change', renderInvestor);
  document.querySelectorAll('[data-export-input]').forEach((button) => button.addEventListener('click', () => {
    const kind = button.dataset.exportInput;
    download(audit.exportInput(dataset, kind), kind === 'spend' ? 'vydaje.csv' : 'poptavky.csv');
  }));
  $('period').addEventListener('submit', (event) => {
    event.preventDefault();
    const nextStart = $('date-from').value;
    const nextEnd = $('date-to').value;
    if (nextStart > nextEnd) {
      setPeriodError('Datum Od musí předcházet datu Do nebo mu být rovno.');
      return;
    }
    setPeriodError();
    [start, end] = [nextStart, nextEnd];
    source = $('report-source').value;
    pageIndex = 0;
    refresh();
  });
  for (const id of ['date-from', 'date-to']) $(id).addEventListener('input', () => {
    if (!$('period-error').hidden && $('date-from').value <= $('date-to').value) setPeriodError();
  });
  $('export').addEventListener('click', () => download(audit.exportCsv(report, start, end), `audit-kampani-${start}_${end}.csv`));
  $('export-findings').addEventListener('click', () => download(audit.exportFindings(report), `audit-zjisteni-${start}_${end}.csv`));
  $('show-issues').addEventListener('click', () => openLeads('', 'issue'));
  $('campaign-sort').addEventListener('change', renderReport);
  $('filter-campaign').addEventListener('change', (event) => {
    campaignFilter = event.target.value;
    pageIndex = 0;
    renderLeads();
  });
  for (const [id, event] of [['filter-issue', 'change'], ['filter-search', 'input']]) {
    $(id).addEventListener(event, () => {
      pageIndex = 0;
      renderLeads();
    });
  }
  $('page-next').addEventListener('click', () => { pageIndex++; renderLeads(); });
  $('page-prev').addEventListener('click', () => { pageIndex--; renderLeads(); });
  window.addEventListener('hashchange', () => {
    route();
    const heading = document.querySelector('.view:not([hidden]) h1');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  const fromHandoff = Boolean(demo) && new URLSearchParams(location.search).get('predani') === '1';
  const received = fromHandoff ? demo.get(storage()) : null;
  if (fixtures) loadSample(received);
  else {
    const today = new Date();
    const date = [today.getFullYear(), today.getMonth() + 1, today.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
    useDataset(audit.emptyDataset(date), false);
  }
  if (received && (!location.hash || location.hash === '#leads')) {
    openLeads('', 'all', received.lead.id);
    showStatus(`${received.lead.id} · přijato z Kontroly odkazů.`);
  } else if (fromHandoff && !received) showStatus('Předaný záznam není v této kartě dostupný. Pro ruční přenos použijte export CRM a import CSV.');
  route();
})();
