(function (root) {
  'use strict';

  const schema = {
    spend: [
      { key: 'date', label: 'Datum výdajů', aliases: ['date', 'day', 'datum', 'den'] },
      { key: 'source', label: 'Kanál', aliases: ['source', 'channel', 'platform', 'zdroj', 'kanal', 'utm_source'] },
      { key: 'campaign', label: 'ID kampaně', aliases: ['campaign_id', 'campaign id', 'id kampane', 'utm_id'] },
      { key: 'name', label: 'Název kampaně', aliases: ['campaign_name', 'campaign name', 'nazev kampane', 'kampan'], optional: true },
      { key: 'spend', label: 'Náklady v Kč', aliases: ['spend_czk', 'spend', 'cost', 'naklady', 'castka'] },
      { key: 'currency', label: 'Měna', aliases: ['currency', 'mena', 'currency code'], optional: true },
    ],
    leads: [
      { key: 'id', label: 'ID poptávky', aliases: ['lead_id', 'contact_id', 'id poptavky', 'id kontaktu', 'id'] },
      { key: 'date', label: 'Datum vzniku', aliases: ['created_date', 'created_at', 'date', 'datum vzniku', 'datum', 'created time'] },
      { key: 'source', label: 'Kanál', aliases: ['source', 'channel', 'platform', 'zdroj', 'kanal', 'utm_source'] },
      { key: 'campaign', label: 'ID kampaně', aliases: ['campaign_id', 'campaign id', 'id kampane', 'utm_id'] },
      { key: 'status', label: 'Stav poptávky', aliases: ['status', 'stage', 'stav', 'stav poptavky', 'qualification'] },
      { key: 'handedOff', label: 'Datum předání', aliases: ['handed_off_date', 'handed_off_at', 'datum predani', 'predano klientovi'], optional: true },
    ],
  };

  const normalized = (value) => value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
  const sourceAliases = new Map([
    ['google', 'Google Ads'], ['google ads', 'Google Ads'], ['google_ads', 'Google Ads'], ['adwords', 'Google Ads'],
    ['facebook', 'Meta'], ['instagram', 'Meta'], ['fb', 'Meta'], ['meta', 'Meta'], ['meta ads', 'Meta'], ['sklik', 'Sklik'],
    ['linkedin', 'LinkedIn'], ['linkedin ads', 'LinkedIn'], ['linkedin_ads', 'LinkedIn'],
    ['vlastni', 'Vlastní'], ['vlastni kanaly', 'Vlastní'],
  ]);
  const sourceKey = (value) => sourceAliases.get(normalized(value)) || normalized(value);
  const campaignKey = (source, campaign) => JSON.stringify([source, campaign]);
  const missingKey = (value) => ['', '-', 'n/a', '(not set)', '(none)'].includes(normalized(value));

  function splitCsv(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    let afterQuote = false;
    const finishCell = () => {
      row.push(cell.trim());
      cell = '';
      afterQuote = false;
    };
    const finishRow = () => {
      finishCell();
      if (row.some(Boolean)) rows.push(row);
      row = [];
    };
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (inQuotes) {
        if (char !== '"') cell += char;
        else if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (char === delimiter) finishCell();
      else if (char === '\r' || char === '\n') {
        finishRow();
        if (char === '\r' && text[index + 1] === '\n') index++;
      } else if (afterQuote) {
        if (char !== ' ' && char !== '\t') throw new Error(`Záznam ${rows.length + 1} má neplatný text za uvozovkami.`);
      } else if (char === '"') {
        if (cell.length) throw new Error(`Záznam ${rows.length + 1} má uvozovky uvnitř neuzavřeného pole.`);
        inQuotes = true;
      } else cell += char;
    }
    if (inQuotes) throw new Error('V CSV zůstalo neuzavřené pole v uvozovkách.');
    finishRow();
    return rows;
  }

  function readCsv(raw) {
    const text = raw.replace(/^\uFEFF/, '');
    if (text.length > 8_000_000) throw new Error('CSV je větší než limit 8 MB. Zvolte kratší období exportu.');
    const candidates = [];
    let lastError;
    for (const delimiter of [';', ',', '\t']) {
      try {
        const rows = splitCsv(text, delimiter);
        if (rows.length && rows[0].length > 1) candidates.push(rows);
      } catch (error) {
        lastError = error;
      }
    }
    const rows = candidates.find((candidate) => candidate.every((row) => row.length === candidate[0].length)) || candidates[0];
    if (!rows) throw lastError || new Error('CSV musí obsahovat hlavičku s více sloupci.');
    const [headings, ...entries] = rows;
    if (headings.some((field) => !field) || new Set(headings.map(normalized)).size !== headings.length) {
      throw new Error('Každý sloupec CSV potřebuje vlastní název.');
    }
    if (headings.length > 150 || entries.length > 100_000) throw new Error('CSV může mít nejvýše 150 sloupců a 100 000 záznamů.');
    entries.forEach((row, index) => {
      if (row.length !== headings.length) throw new Error(`Záznam ${index + 2} má ${row.length} polí, hlavička má ${headings.length}.`);
    });
    return { headings, entries };
  }

  function guessFields(document, kind) {
    const headers = document.headings.map(normalized);
    return Object.fromEntries(schema[kind].map(({ key, aliases }) => [key, headers.findIndex((field) => aliases.includes(field))]));
  }

  function dateValue(value) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):?[0-5]\d)?)?$/.exec(value);
    const czech = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(value);
    const date = iso ? iso[0].slice(0, 10) : czech && `${czech[3]}-${czech[2].padStart(2, '0')}-${czech[1].padStart(2, '0')}`;
    const milliseconds = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== date) {
      throw new Error('Datum musí být platné, ve formátu RRRR-MM-DD nebo D. M. RRRR.');
    }
    return date;
  }

  function amount(value) {
    const plain = value.replace(/\s*Kč\s*$/i, '');
    if (!/^(?:\d+|\d{1,3}(?:[ \u00A0\u202F]\d{3})+)(?:[.,]\d{1,2})?$/.test(plain)) {
      throw new Error('Náklad musí být nezáporná částka v Kč, například 2 450,50.');
    }
    const [whole, fraction = ''] = plain.replace(/[ \u00A0\u202F]/g, '').split(/[.,]/);
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents > 1e10) throw new Error('Náklad na řádku přesahuje 100 milionů Kč.');
    return cents;
  }

  function handoffDate(value, created) {
    if (!value) return '';
    const date = dateValue(value);
    if (date < created) throw new Error('Datum předání nesmí předcházet vzniku poptávky.');
    return date;
  }

  function inspectRows(document, mapping, kind) {
    const used = new Set();
    for (const field of schema[kind]) {
      const index = mapping[field.key];
      if (field.optional && (index === -1 || index === undefined)) continue;
      if (!Number.isInteger(index) || index < 0 || index >= document.headings.length) throw new Error(`Přiřaďte sloupec „${field.label}“.`);
      if (used.has(index)) throw new Error('Každé pole musí mít jiný zdrojový sloupec.');
      used.add(index);
    }
    const data = new Map();
    let duplicates = 0;
    const errors = [];
    const duplicateRecords = [];
    let invalidCount = 0;
    document.entries.forEach((row, index) => {
      const get = (key) => row[mapping[key]] || '';
      try {
        const date = dateValue(get('date'));
        const source = missingKey(get('source')) ? '' : sourceKey(get('source'));
        const campaign = missingKey(get('campaign')) ? '' : get('campaign');
        let key;
        let item;
        if (kind === 'spend') {
          if (!source || !campaign) throw new Error('Výdaje musí mít kanál i ID kampaně.');
          if (mapping.currency >= 0 && get('currency').toUpperCase() !== 'CZK' && get('currency') !== 'Kč') {
            throw new Error('Měna musí být CZK pro všechny řádky.');
          }
          key = JSON.stringify([source, campaign, date]);
          item = { date, source, campaign, name: get('name') || campaign, cents: amount(get('spend')) };
        } else {
          key = get('id');
          if (missingKey(key)) throw new Error('Poptávka musí mít ID.');
          item = { id: key, date, source, campaign, status: get('status'), handedOff: handoffDate(get('handedOff'), date) };
        }
        for (const [field, value] of Object.entries(item)) {
          if (typeof value === 'string' && value.length > 200) throw new Error(`Hodnota „${schema[kind].find((entry) => entry.key === field)?.label || field}“ je delší než 200 znaků.`);
        }
        const first = data.get(key);
        if (!first) data.set(key, { item, record: index + 2 });
        else if (JSON.stringify(first.item) === JSON.stringify(item)) {
          duplicates++;
          duplicateRecords.push({ kind, record: index + 2, original: first.record, label: item.id || `${item.source} · ${item.campaign} · ${item.date}` });
        } else throw new Error(kind === 'spend' ? `Kampaň má v jednom dni více různých řádků. Rozpor se záznamem ${first.record}. Slučte členění do jednoho součtu za den.` : `ID poptávky má odlišné záznamy. Rozpor se záznamem ${first.record}. Exportujte jeden aktuální stav pro každé ID.`);
      } catch (error) {
        invalidCount++;
        if (errors.length < 5) errors.push(`Záznam ${index + 2}: ${error.message}`);
      }
    });
    const rows = Array.from(data.values(), ({ item }) => item);
    return { rows, duplicates, duplicateRecords, invalidCount, errors, dates: dateRange(rows),
      tracksHandoffs: kind === 'leads' && mapping.handedOff >= 0 };
  }

  function importedRows(document, mapping, kind) {
    const result = inspectRows(document, mapping, kind);
    if (result.invalidCount) throw new Error(`${result.invalidCount} chybných záznamů. ${result.errors.join(' ')}`);
    return result;
  }

  function dateRange(rows) {
    if (!rows.length) return null;
    return rows.reduce(([start, end], { date }) => [date < start ? date : start, date > end ? date : end], [rows[0].date, rows[0].date]);
  }

  function prepare(spend, leads, qualified) {
    const match = new Set(qualified.map(normalized).filter(Boolean));
    if (!match.size) throw new Error('Zvolte alespoň jeden stav započítaný jako potvrzený zájem.');
    if (!spend.rows.length) throw new Error('Export výdajů musí obsahovat alespoň jeden záznam.');
    const spendDates = spend.dates ?? dateRange(spend.rows);
    const leadDates = leads.dates ?? dateRange(leads.rows);
    const dates = leadDates ? [spendDates[0] < leadDates[0] ? spendDates[0] : leadDates[0], spendDates[1] > leadDates[1] ? spendDates[1] : leadDates[1]] : spendDates;
    return {
      spend: spend.rows, leads: leads.rows, duplicates: spend.duplicates + leads.duplicates,
      duplicateRecords: [...(spend.duplicateRecords || []), ...(leads.duplicateRecords || [])], match,
      qualifiedLabel: qualified.find((status) => normalized(status)).trim(), dates, spendDates, leadDates,
      tracksHandoffs: Boolean(leads.tracksHandoffs),
    };
  }

  const isQualified = (dataset, status) => dataset.match.has(normalized(status));

  function calculate(dataset, start, end, source = '') {
    const inPeriod = (row) => row.date >= start && row.date <= end && (!source || row.source === source);
    const campaigns = new Map();
    const knownCampaigns = new Set();
    const leads = [];
    let unassigned = 0;
    let noSpend = 0;
    let outsideSpend = 0;
    let noStatus = 0;
    for (const row of dataset.spend) {
      const key = campaignKey(row.source, row.campaign);
      knownCampaigns.add(key);
      if (!inPeriod(row)) continue;
      if (!campaigns.has(key)) campaigns.set(key, { key, source: row.source, id: row.campaign, name: row.name, cents: 0, leads: 0, qualified: 0, handedOff: 0 });
      campaigns.get(key).cents += row.cents;
    }
    for (const row of dataset.leads.filter(inPeriod)) {
      const key = campaignKey(row.source, row.campaign);
      const campaign = campaigns.get(key);
      const qualified = isQualified(dataset, row.status);
      if (!row.status) noStatus++;
      let issue = '';
      let attribution = 'matched';
      if (!row.source || !row.campaign) {
        unassigned++;
        issue = 'Bez přiřazení';
        attribution = 'missing-key';
      } else if (!campaign) {
        noSpend++;
        issue = 'Bez výdajů v období';
        attribution = knownCampaigns.has(key) ? 'outside-period' : 'unknown-campaign';
        if (attribution === 'outside-period') outsideSpend++;
      } else {
        campaign.leads++;
        if (qualified) campaign.qualified++;
        if (row.handedOff) campaign.handedOff++;
      }
      leads.push({ ...row, qualified, issue, attribution, key });
    }
    const cost = (cents, n) => n ? cents / 100 / n : null;
    const rows = Array.from(campaigns.values()).map((row) => ({
      ...row,
      cpl: cost(row.cents, row.leads),
      cpql: cost(row.cents, row.qualified),
      costPerHandoff: cost(row.cents, row.handedOff),
      rate: row.leads ? row.qualified / row.leads : null,
    }));
    const totals = rows.reduce((total, row) => ({
      cents: total.cents + row.cents,
      leads: total.leads + row.leads,
      qualified: total.qualified + row.qualified,
      handedOff: total.handedOff + row.handedOff,
    }), { cents: 0, leads: 0, qualified: 0, handedOff: 0 });
    return { rows, totals, leads, unassigned, noSpend, outsideSpend, noStatus, tracksHandoffs: dataset.tracksHandoffs, cpql: cost(totals.cents, totals.qualified),
      costPerHandoff: cost(totals.cents, totals.handedOff), rate: totals.leads ? totals.qualified / totals.leads : null };
  }

  function csvCell(value) {
    const text = String(value ?? '');
    const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }

  const csvRows = (rows) => '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';

  function exportInput(dataset, kind) {
    if (kind === 'spend') {
      return csvRows([['date', 'source', 'campaign_id', 'campaign_name', 'spend_czk', 'currency'],
        ...dataset.spend.map((row) => [row.date, row.source, row.campaign, row.name, (row.cents / 100).toFixed(2), 'CZK'])]);
    }
    const headers = ['lead_id', 'created_date', 'source', 'campaign_id', 'status'];
    if (dataset.tracksHandoffs) headers.push('handed_off_date');
    return csvRows([headers, ...dataset.leads.map((row) => {
      const values = [row.id, row.date, row.source, row.campaign, row.status];
      if (dataset.tracksHandoffs) values.push(row.handedOff);
      return values;
    })]);
  }
  const attributionLabels = { matched: 'Přiřazeno', 'missing-key': 'Chybí kanál nebo ID', 'outside-period': 'Výdaje jsou v jiném období', 'unknown-campaign': 'Kampaň ve výdajích chybí' };

  function exportFindings(report) {
    const header = ['id_poptavky', 'datum', 'kanal', 'id_kampane', 'prirazeni', 'stav_crm'];
    const items = report.leads.filter((row) => row.issue || !row.status);
    return csvRows([header, ...items.map((row) => [row.id, row.date, row.source, row.campaign, attributionLabels[row.attribution], row.status || 'Chybí stav CRM'])]);
  }

  function exportCsv(report, start, end) {
    const decimal = (number) => number === null ? '' : number.toFixed(2).replace('.', ',');
    const header = ['od', 'do', 'kanal', 'id_kampane', 'kampan', 'naklady_czk', 'prirazene_poptavky', 'kvalifikovane', 'cena_za_poptavku_czk', 'cena_za_kvalifikovanou_czk', 'podil_kvalifikovanych_pct'];
    const records = report.rows.map((row) => [start, end, row.source, row.id, row.name, decimal(row.cents / 100), row.leads, row.qualified, decimal(row.cpl), decimal(row.cpql), decimal(row.rate === null ? null : row.rate * 100)]);
    if (report.tracksHandoffs) {
      header.push('predane_klientovi', 'cena_za_predanou_czk');
      records.forEach((row, index) => row.push(report.rows[index].handedOff, decimal(report.rows[index].costPerHandoff)));
    }
    return csvRows([header, ...records]);
  }

  function emptyDataset(date) {
    return { spend: [], leads: [], duplicates: 0, duplicateRecords: [], dates: [date, date], spendDates: null, leadDates: null,
      qualifiedLabel: 'Kvalifikovaná', match: new Set(['kvalifikovana']), tracksHandoffs: false };
  }

  const api = { schema, readCsv, guessFields, inspectRows, importedRows, prepare, emptyDataset, calculate, isQualified, attributionLabels, exportInput, exportFindings, exportCsv, sourceKey, handoffDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampaignAudit = api;
})(globalThis);
