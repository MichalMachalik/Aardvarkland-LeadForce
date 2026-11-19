(function (root) {
  'use strict';

  const fixtures = typeof module === 'object' && module.exports ? require('./portal-fixtures.js') : root.InvestorFixtures;
  let { positions = [], opportunities = [], baseMessages = [], journeyMessages = [] } = fixtures ?? {};

  const stateKey = 'portal-investora.demo.v1';
  const pragueDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' });
  const today = () => pragueDay.format(new Date());
  const knownIds = (values, allowed) => new Set(Array.isArray(values) ? values.filter((id) => allowed.has(id)) : []);
  const defaultState = () => ({ saved: new Set(), interest: new Set(), read: new Set(fixtures?.read) });

  function load(storage) {
    try {
      const raw = storage.getItem(stateKey);
      if (!raw || raw.length > 4000) return null;
      const value = JSON.parse(raw);
      if (value?.version !== 1) return null;
      const opportunityIds = new Set(opportunities.map(({ id }) => id));
      const messageIds = new Set([...baseMessages, ...journeyMessages].map(({ id }) => id));
      return { saved: knownIds(value.saved, opportunityIds), interest: knownIds(value.interest, opportunityIds), read: knownIds(value.read, messageIds) };
    } catch { return null; }
  }

  function parsePortfolio(text) {
    let payload;
    try { payload = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('Soubor není platný JSON.'); }
    const invalid = (field) => { throw new Error(`Neplatná hodnota v poli ${field}.`); };
    const list = (value, field) => Array.isArray(value) ? value : invalid(field);
    const string = (value, field, optional = false) => {
      if (optional && (value === undefined || value === null)) return '';
      if (typeof value !== 'string' || (!optional && !value.trim())) invalid(field);
      return value.trim();
    };
    const id = (value, field) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) ? value : invalid(field);
    const date = (value, field) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field);
      const day = new Date(`${value}T00:00:00Z`);
      if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) invalid(field);
      return value;
    };
    const money = (value, field) => {
      if (typeof value !== 'number' || value < 0 || !Number.isSafeInteger(Math.round(value * 100))
        || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) invalid(field);
      return value;
    };
    const unique = (rows, field, key = 'id') => {
      if (new Set(rows.map((row) => row[key])).size !== rows.length) invalid(`${field} (opakovaná hodnota ${key})`);
      return rows;
    };
    const parsedPositions = list(payload?.positions, 'positions').map((row, index) => {
      const field = `positions[${index}]`;
      if (row?.status !== 'active' && row?.status !== 'closed') invalid(`${field}.status`);
      const schedule = list(row.schedule, `${field}.schedule`).map((payment, number) => ({
        date: date(payment?.date, `${field}.schedule[${number}].date`), amount: money(payment?.amount, `${field}.schedule[${number}].amount`),
      }));
      if (row.status === 'closed' && schedule.length) invalid(`${field}.schedule`);
      return { id: id(row.id, `${field}.id`), name: string(row.name, `${field}.name`), category: string(row.category, `${field}.category`),
        principal: money(row.principal, `${field}.principal`), status: row.status, maturity: date(row.maturity, `${field}.maturity`),
        schedule: unique(schedule, `${field}.schedule`, 'date').sort((a, b) => a.date.localeCompare(b.date)), note: string(row.note, `${field}.note`, true) };
    });
    const parsedOpportunities = list(payload.opportunities, 'opportunities').map((row, index) => {
      const field = `opportunities[${index}]`;
      return { id: id(row?.id, `${field}.id`), name: string(row.name, `${field}.name`), category: string(row.category, `${field}.category`),
        horizon: string(row.horizon, `${field}.horizon`), phase: string(row.phase, `${field}.phase`), note: string(row.note, `${field}.note`, true) };
    });
    const positionIds = new Set(unique(parsedPositions, 'positions').map((position) => position.id));
    const parsedMessages = list(payload.messages, 'messages').map((row, index) => {
      const field = `messages[${index}]`;
      const messageId = id(row?.id, `${field}.id`);
      const positionId = string(row.positionId, `${field}.positionId`, true);
      if (positionId && !positionIds.has(positionId)) invalid(`${field}.positionId (neznámá pozice)`);
      return { id: messageId, date: date(row.date, `${field}.date`), type: string(row.type, `${field}.type`),
        title: string(row.title, `${field}.title`), text: string(row.text, `${field}.text`, true), positionId };
    });
    if (!Number.isSafeInteger(sumCents(parsedPositions, 'principal'))) invalid('positions.principal');
    if (!Number.isSafeInteger(sumCents(parsedPositions.flatMap((row) => row.schedule), 'amount'))) invalid('positions.schedule.amount');
    return { positions: parsedPositions, opportunities: unique(parsedOpportunities, 'opportunities'), messages: unique(parsedMessages, 'messages') };
  }

  function usePortfolio(data) {
    positions = data.positions;
    opportunities = data.opportunities;
    baseMessages = data.messages;
    journeyMessages = [];
  }

  function save(storage, state) {
    try {
      const snapshot = Object.fromEntries(Object.entries(state).map(([key, ids]) => [key, [...ids]]));
      storage.setItem(stateKey, JSON.stringify({ version: 1, ...snapshot }));
      return true;
    } catch { return false; }
  }

  function paymentSchedule(entries) {
    return entries.filter((position) => position.status === 'active')
      .flatMap((position) => position.schedule.map((entry) => ({ ...entry, position })))
      .sort((first, second) => first.date.localeCompare(second.date) || first.position.id.localeCompare(second.position.id));
  }

  function portfolio(from = today()) {
    const active = positions.filter((position) => position.status === 'active');
    const next = paymentSchedule(active).find((payment) => payment.date >= from);
    return { active, invested: sumMoney(active, 'principal'), next };
  }

  const sumCents = (rows, field) => rows.reduce((sum, row) => sum + Math.round(row[field] * 100), 0);
  const sumMoney = (rows, field) => sumCents(rows, field) / 100;

  const normalize = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  function filterOpportunities(query, category, savedOnly, saved) {
    const search = normalize(query);
    return opportunities.filter((item) => (!category || item.category === category) && (!savedOnly || saved.has(item.id))
      && normalize(`${item.name} ${item.category} ${item.phase}`).includes(search));
  }

  function messages(stage) {
    return [...journeyMessages.filter(({ step }) => step <= stage).reverse(), ...baseMessages]
      .sort((first, second) => second.date.localeCompare(first.date));
  }

  const positionStatus = { active: 'Aktivní', closed: 'Splacená' };
  function exportPortfolio(entries, from = today()) {
    const csv = (cells) => cells.map((value) => {
      const text = String(value);
      const escaped = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${escaped.replaceAll('"', '""')}"`;
    }).join(';');
    const headings = ['ID pozice', 'Projekt', 'Vložená částka CZK', 'Stav', 'Datum splatnosti', 'Nejbližší platba', 'Částka platby CZK'];
    const rows = entries.map((item) => {
      const next = item.status === 'active' ? item.schedule.find((payment) => payment.date >= from) : undefined;
      return [item.id, item.name, item.principal, positionStatus[item.status], item.maturity, next?.date ?? '', next?.amount ?? ''];
    });
    return '\uFEFF' + [headings, ...rows].map(csv).join('\r\n') + '\r\n';
  }

  function exportCalendar(payments, timestamp = new Date()) {
    const stamp = timestamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const text = (value) => value.replaceAll('\\', '\\\\').replace(/\r\n|[\r\n]/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Michal Machalik//Portal investora//CS', 'CALSCALE:GREGORIAN'];
    for (const { position, date, amount } of payments) {
      const day = date.replaceAll('-', '');
      lines.push('BEGIN:VEVENT', `UID:${position.id}-${day}@portal-investora.michalmachalik.github.io`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day}`, `SUMMARY:${text(`Platba · ${position.name}`)}`,
        `DESCRIPTION:${text(`Plánovaná částka ${amount} Kč · Portál investora`)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const utf8 = new TextEncoder();
    return lines.map((line) => {
      let folded = '';
      let bytes = 0;
      for (const character of line) {
        const width = utf8.encode(character).length;
        if (bytes + width > 75) { folded += '\r\n '; bytes = 1; }
        folded += character;
        bytes += width;
      }
      return folded;
    }).join('\r\n') + '\r\n';
  }

  const api = { get positions() { return positions; }, get opportunities() { return opportunities; }, positionStatus, portfolio,
    parsePortfolio, usePortfolio, sumMoney, paymentSchedule, exportCalendar, filterOpportunities, messages, normalize, defaultState, load, save, stateKey, exportPortfolio };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvestorDemo = api;
})(globalThis);
