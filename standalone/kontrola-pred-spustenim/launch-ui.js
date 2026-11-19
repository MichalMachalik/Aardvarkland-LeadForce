(function () {
  'use strict';
  const tool = window.LaunchCheck;
  const demo = window.CampaignDemo;
  const $ = (id) => document.getElementById(id);
  const views = { check: 'Kontrola odkazů', builder: 'Tvůrce odkazu', crm: 'Ověření CRM' };
  const crmHeaders = ['lead_id', 'created_date', 'source', 'campaign_id', 'status'];
  let results = [];
  let activeRow = null;
  let editing = null;
  let selected = null;
  let generated = '';
  const leads = new Map();
  const recordKey = (row) => tool.isHandoff(row) ? demo.fixture.id : row.fingerprint;
  let statusTimer;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(text, callback, theme = 'secondary') {
    const control = node('button', text, `button ${theme}`);
    control.type = 'button';
    control.addEventListener('click', callback);
    return control;
  }

  function status(text) {
    window.clearTimeout(statusTimer);
    $('app-status').textContent = text;
    $('app-status').hidden = false;
    statusTimer = window.setTimeout(() => { $('app-status').hidden = true; }, 6500);
  }

  function errorSlot(id, error) {
    $(id).textContent = error?.message || '';
    $(id).hidden = !error;
  }

  function route() {
    const hash = window.location.hash.slice(1);
    const current = Object.hasOwn(views, hash) ? hash : 'check';
    for (const key of Object.keys(views)) $(key).hidden = key !== current;
    $('view-name').textContent = views[current];
    document.querySelectorAll('[data-route]').forEach((link) => {
      if (link.dataset.route === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  function navigate(view, focus = `${view}-title`) {
    window.location.hash = view;
    route();
    $(focus).focus();
  }

  function session() {
    try { return window.sessionStorage; } catch { return null; }
  }

  function download(content, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const a = node('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function policy() {
    return tool.rules($('host').value, $('sources').value, $('media').value);
  }

  function clearGenerated() {
    generated = '';
    $('generated-section').hidden = true;
    errorSlot('builder-error', null);
  }

  function clearSuggestedId(resetValue) {
    const id = $('utm_id');
    const suggestion = id.dataset.suggestion;
    if (!suggestion) return;
    if (resetValue && id.value === suggestion) id.value = '';
    delete id.dataset.suggestion;
    if (editing) $('editing').textContent = `Úprava řádku ${editing.number}`;
  }

  function editRow(row) {
    clearGenerated();
    clearSuggestedId(false);
    editing = row;
    $('channel-template').value = '';
    $('base-url').value = row.raw;
    for (const key of tool.keys) $(key).value = row.fields[key] || '';
    const suggestedId = tool.suggestCampaignId(row, results);
    if (suggestedId) {
      $('utm_id').value = suggestedId;
      $('utm_id').dataset.suggestion = suggestedId;
    }
    $('editing').hidden = false;
    $('editing').textContent = suggestedId ? `Řádek ${row.number} · ID ${suggestedId} převzato ze shodné kampaně.` : `Úprava řádku ${row.number}`;
    $('add-link').textContent = 'Nahradit v kontrole';
    navigate('builder', suggestedId ? 'utm_id' : 'base-url');
  }

  function chooseLead(row) {
    selected = row;
    $('lead-topic').selectedIndex = 0;
    $('visitor-id').selectedIndex = 0;
    visits.clear();
    visits.add('Vstupní stránka');
    renderCrm();
    navigate('crm');
  }

  const visits = new Set();

  function renderResults() {
    const invalid = results.filter((item) => item.issues.length).length;
    const ready = results.length - invalid;
    const readyLabel = ready === 1 ? 'připravený' : ready > 1 && ready < 5 ? 'připravené' : 'připravených';
    $('counts').textContent = results.length ? `${ready} ${readyLabel} · ${invalid} k úpravě · ${results.length} celkem` : 'Spusťte kontrolu vložených odkazů.';
    $('save-check').disabled = !results.length;
    $('results-filters').hidden = !results.length;
    $('jump-results').hidden = !results.length;
    $('jump-results').textContent = `Výsledky · ${results.length}`;
    const filter = $('result-filter').value;
    const source = $('result-source');
    const previous = source.value;
    const sources = [...new Set(results.map((row) => row.fields.utm_source).filter(Boolean))].sort();
    source.replaceChildren(new Option('Všechny kanály', ''), ...sources.map((value) => new Option(value, value)));
    source.value = sources.includes(previous) ? previous : '';
    const search = $('result-search').value.trim().toLowerCase();
    const visible = results.filter((row) => {
      if (filter === 'issues' && !row.issues.length || filter === 'ready' && row.issues.length) return false;
      if (filter === 'conflict' && !row.issues.some(({ code }) => code === 'campaign-conflict')) return false;
      if (source.value && row.fields.utm_source !== source.value) return false;
      return row.raw.toLowerCase().includes(search);
    });
    const list = $('result-list');
    list.replaceChildren();
    $('results-empty').hidden = Boolean(visible.length) || !results.length;
    $('visible-count').textContent = `${visible.length} z ${results.length} odkazů`;
    $('visible-count').hidden = !results.length || (filter === 'all' && !source.value && !search);
    for (const row of visible) {
      const card = node('article', undefined, 'result-card');
      const top = node('div', undefined, 'result-top');
      const heading = row.fields.utm_campaign ? `${row.fields.utm_campaign} · ${row.fields.utm_source || 'neznámý zdroj'}` : `Odkaz ${row.number}`;
      const label = row.issues.some(({ code }) => code === 'campaign-conflict') ? 'Konflikt označení'
        : row.issues.length ? 'K úpravě' : leads.has(recordKey(row)) ? 'Předání ověřeno' : 'Připraveno';
      top.append(node('h3', heading), node('span', label, `product-status${row.issues.length ? ' issue' : ''}`));
      const address = node('p', undefined, 'result-url');
      const parts = row.raw.length <= 4096 ? row.raw.split(/(?=[?&]utm_)/i) : [row.raw];
      for (const [index, part] of parts.entries()) {
        if (index) address.append(node('wbr'));
        address.append(part);
      }
      card.append(top, address);
      if (row.issues.length) {
        const details = node('ul', undefined, 'result-details');
        for (const issue of row.issues) details.append(node('li', issue.description));
        card.append(details);
      } else {
        card.append(node('p', `ID kampaně ${row.fields.utm_id} · ${row.fields.utm_medium}`, 'result-details'));
      }
      const actions = node('div', undefined, 'actions');
      actions.append(button('Upravit odkaz', () => editRow(row)));
      if (!row.issues.length) actions.append(button('Ověřit předání', () => chooseLead(row)));
      card.append(actions);
      list.append(card);
    }
  }

  function runCheck() {
    errorSlot('scan-error', null);
    selected = null;
    renderCrm();
    try {
      results = tool.scan($('links').value, policy());
      activeRow = $('links').value;
    } catch (error) {
      errorSlot('scan-error', error);
      results = [];
      activeRow = null;
    }
    renderResults();
  }

  function clearResults() {
    clearGenerated();
    errorSlot('scan-error', null);
    if (!results.length) return;
    results = [];
    activeRow = null;
    selected = null;
    renderResults();
    renderCrm();
  }

  function resetResultFilters() {
    $('result-filter').value = 'all';
    $('result-source').value = '';
    $('result-search').value = '';
  }

  function initializeBatch() {
    if (!tool.sample) {
      renderResults();
      renderCrm();
      return;
    }
    $('host').value = tool.sample.host;
    $('sources').value = tool.sample.sources;
    $('media').value = tool.sample.media;
    $('links').value = tool.sample.links.join('\n');
    resetResultFilters();
    $('channel-template').value = '';
    $('base-url').value = `https://${tool.sample.host}/prohlidka`;
    $('utm_source').value = 'google';
    $('utm_medium').value = 'cpc';
    $('utm_campaign').value = tool.sample.title;
    $('utm_id').value = tool.sample.campaignId;
    $('utm_content').value = '';
    $('utm_term').value = '';
    $('add-link').textContent = 'Přidat do kontroly';
    $('editing').hidden = true;
    editing = null;
    selected = null;
    leads.clear();
    clearGenerated();
    runCheck();
    renderCrm();
  }

  function renderCrm() {
    const record = selected && leads.get(recordKey(selected));
    const values = $('conversion-values');
    values.replaceChildren();
    values.hidden = !selected;
    $('crm-form').hidden = !selected || Boolean(record);
    $('record-lead').disabled = !selected || Boolean(record);
    $('crm-verified').hidden = !record;
    $('crm-verified').textContent = record ? `Předání ověřeno · ${record.lead.id}` : '';
    const canHandoff = Boolean(record && tool.isHandoff(selected));
    $('handoff-actions').hidden = !canHandoff || window.location.protocol === 'file:';
    $('handoff-hint').hidden = !canHandoff || window.location.protocol !== 'file:';
    $('conversion-context').hidden = Boolean(selected);
    if (selected) {
      const fields = selected.fields;
      for (const [name, value] of [['Zdroj', fields.utm_source], ['Médium', fields.utm_medium], ['ID kampaně', fields.utm_id]]) {
        const box = node('dl');
        box.append(node('dt', name), node('dd', value));
        values.append(box);
      }
    }
    $('visit-panel').hidden = !selected;
    const measured = new Set(record?.visits || visits);
    $('visit-events').replaceChildren(...['Vstupní stránka', 'Detail projektu', 'Odeslání formuláře'].map((name) => {
      const observed = measured.has(name);
      return node('li', `${name} · ${observed ? '1 událost' : '0 událostí'}`, observed ? 'observed' : '');
    }));
    $('visit-detail').hidden = Boolean(record) || measured.has('Detail projektu');
    $('identity').hidden = !record;
    const identity = record?.known ? 'Stávající kontakt' : 'Nový kontakt';
    $('identity').textContent = record ? `${identity} · ${record.topic}` : '';
    const target = $('crm-rows');
    target.replaceChildren();
    if (!leads.size) {
      const row = node('tr');
      const message = node('td', 'Zatím žádné záznamy.', 'empty');
      message.colSpan = 5;
      row.append(message);
      target.append(row);
    }
    for (const { lead } of leads.values()) {
      const row = node('tr');
      for (const value of Object.values(lead)) row.append(node('td', value));
      target.append(row);
    }
    $('save-crm').disabled = !leads.size;
  }

  $('check-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runCheck();
    if (results.length) $('results-title').focus();
  });
  $('jump-results').addEventListener('click', () => {
    const heading = $('results-title');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start' });
  });
  for (const id of ['host', 'sources', 'media', 'links']) $(id).addEventListener('input', clearResults);
  $('result-filter').addEventListener('change', renderResults);
  $('result-source').addEventListener('change', renderResults);
  $('result-search').addEventListener('input', renderResults);
  $('clear-result-filters').addEventListener('click', () => {
    resetResultFilters();
    renderResults();
    $('result-search').focus();
  });
  $('new-check').addEventListener('click', () => {
    $('links').value = '';
    clearSuggestedId(true);
    editing = null;
    $('editing').hidden = true;
    $('add-link').textContent = 'Přidat do kontroly';
    resetResultFilters();
    clearResults();
    $('links').focus();
  });
  $('save-check').addEventListener('click', () => download(tool.exportCsv(['odkaz', 'stav', 'zdroj', 'id_kampane', 'zjisteni'], results.map((row) => [row.raw, row.issues.length ? 'K úpravě' : 'Připraveno', row.fields.utm_source, row.fields.utm_id, row.issues.map(({ description }) => description).join(' ')])), 'kontrola-kampani.csv'));

  $('builder-form').addEventListener('input', clearGenerated);
  $('channel-template').addEventListener('change', () => {
    const preset = tool.templates[$('channel-template').value];
    if (preset) {
      clearSuggestedId(true);
      [$('utm_source').value, $('utm_medium').value] = preset;
    }
  });
  for (const key of ['utm_source', 'utm_medium']) $(key).addEventListener('input', () => { $('channel-template').value = ''; });
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) $(key).addEventListener('input', () => clearSuggestedId(true));
  $('utm_id').addEventListener('input', () => clearSuggestedId(false));
  $('new-link').addEventListener('click', () => {
    clearGenerated();
    clearSuggestedId(false);
    editing = null;
    $('channel-template').value = '';
    const host = $('host').value.split(',').map((value) => value.trim()).find(Boolean);
    $('base-url').value = host ? `https://${host}/` : '';
    for (const key of tool.keys) $(key).value = '';
    $('add-link').textContent = 'Přidat do kontroly';
    $('editing').hidden = true;
    $('base-url').focus();
  });
  $('builder-form').addEventListener('submit', (event) => {
    event.preventDefault();
    clearGenerated();
    try {
      generated = tool.compose($('base-url').value, Object.fromEntries(tool.keys.map((key) => [key, $(key).value])), policy());
      $('generated').value = generated;
      $('generated-section').hidden = false;
    } catch (error) { errorSlot('builder-error', error); }
  });
  $('copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(generated); status('Odkaz byl zkopírován.'); }
    catch { $('generated').select(); status('Odkaz je vybraný. Pro zkopírování použijte klávesovou zkratku pro kopírování.'); }
  });
  $('add-link').addEventListener('click', () => {
    if (!generated) return;
    const all = $('links').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (editing) {
      const index = editing.number - 1;
      if (all[index] !== editing.raw || activeRow !== $('links').value) {
        errorSlot('builder-error', new Error('Dávka se změnila. Spusťte kontrolu a vyberte odkaz znovu.'));
        return;
      }
      all[index] = generated;
    } else all.push(generated);
    if (all.length > 500) {
      errorSlot('builder-error', new Error('Dávka už obsahuje 500 odkazů.'));
      return;
    }
    $('links').value = all.join('\n');
    resetResultFilters();
    clearSuggestedId(false);
    editing = null;
    $('add-link').textContent = 'Přidat do kontroly';
    $('editing').hidden = true;
    clearGenerated();
    runCheck();
    navigate('check');
  });

  $('visit-detail').addEventListener('click', () => { visits.add('Detail projektu'); renderCrm(); $('lead-topic').focus(); });
  $('crm-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selected || leads.has(recordKey(selected))) return;
    const date = new Date();
    const today = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
    const lead = tool.isHandoff(selected) ? { ...demo.fixture } : tool.testLead(selected, `CRM-${leads.size + 1}`, today);
    visits.add('Odeslání formuláře');
    leads.set(recordKey(selected), { lead, visits: [...visits], topic: $('lead-topic').value, known: $('visitor-id').value === 'existing' });
    renderCrm();
    renderResults();
    status(`Poptávka ${lead.id} uložena.`);
    ($('handoff-actions').hidden ? $('save-crm') : $('handoff')).focus();
  });
  $('handoff').addEventListener('click', () => {
    if (!selected || !tool.isHandoff(selected) || !leads.has(recordKey(selected))) return;
    if (demo.save(session())) window.location.assign(new URL('../audit-kampani/?predani=1#leads', window.location.href));
    else { $('handoff-hint').hidden = false; $('save-crm').focus(); }
  });
  $('save-crm').addEventListener('click', () => download(tool.exportCsv(crmHeaders, [...leads.values()].map(({ lead }) => Object.values(lead))), 'poptavky-crm.csv'));
  window.addEventListener('hashchange', route);
  initializeBatch();
  route();
})();
