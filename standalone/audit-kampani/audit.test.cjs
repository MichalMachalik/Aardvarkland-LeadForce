'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const audit = require('./audit-data.js');
const { sampleCsv } = require('./audit-fixtures.js');

function importData(csv, kind) {
  const document = audit.readCsv(csv);
  return audit.importedRows(document, audit.guessFields(document, kind), kind);
}

function importSample() {
  const csv = sampleCsv();
  return audit.prepare(importData(csv.spend, 'spend'), importData(csv.leads, 'leads'), ['Kvalifikovaná']);
}

test('sample reconciles spend, funnel and attribution and recalculates on qualification', () => {
  const data = importSample();
  const start = '2026-11-01';
  const end = '2026-11-03';
  const calculate = () => audit.calculate(data, start, end);
  const report = calculate();
  assert.deepEqual(report.totals, { cents: 2460000, leads: 72, qualified: 23, handedOff: 7 });
  assert.deepEqual(report.rows.map(({ cpl, cpql }) => [cpl, cpql]), [[250, 1500], [400, 800], [500, 1200]]);
  assert.deepEqual([report.unassigned, report.noSpend, report.noStatus, data.duplicates], [1, 1, 1, 1]);
  const meta = audit.calculate(data, start, end, 'Meta');
  assert.deepEqual(meta.totals, { cents: 900000, leads: 36, qualified: 6, handedOff: 2 });
  assert.equal(meta.leads.length, 36);
  data.leads.find(({ id }) => id === 'G-202-13').status = 'Kvalifikovaná';
  const google = calculate().rows.find(({ id }) => id === 'G-202');
  assert.deepEqual([google.leads, google.qualified, Math.round(google.cpql)], [24, 13, 738]);
  assert.deepEqual(audit.calculate(importSample(), start, end), report);
});

test('CSV supports separators, Czech formats, and quoted multiline cells', () => {
  const spend = importData('\uFEFFDatum;Kanál;ID kampaně;Náklady;Název kampaně;Měna\r\n2. 11. 2026;facebook;abc;"9 600,51";"Projekt; \"\"A\"\"\nVýchod";CZK', 'spend');
  assert.deepEqual(spend.rows[0], { date:'2026-11-02', source:'Meta', campaign:'abc', name:'Projekt; "A"\nVýchod', cents:960051 });
  const leads = importData('id\tdate\tsource\tutm_id\tstatus\n1\t2026-11-02T09:15:00+01:00\tFacebook\tabc\tQualified', 'leads');
  assert.equal(leads.rows[0].source, 'Meta');
  assert.equal(leads.rows[0].date, '2026-11-02');
  assert.equal(audit.readCsv('a,b\r\n"comma, value",other').entries[0][0], 'comma, value');
});

test('conflicts, invalid amounts, different currencies and invalid dates are rejected', () => {
  const header = 'date;source;campaign_id;spend;currency\n';
  assert.throws(() => importData(`${header}2026-11-02;Meta;A;100;CZK\n2026-11-02;Facebook;A;101;CZK`, 'spend'), /více různých/);
  for (const [entry, message] of [['2026-11-02;Meta;A;100;EUR', /Měna/], ['2026-11-31;Meta;A;100;CZK', /Datum/], ['2026-11-02;Meta;A;-100;CZK', /nezáporná/]]) {
    assert.throws(() => importData(header + entry, 'spend'), message);
  }
  assert.throws(() => importData('id;date;source;campaign_id;status\n1;2026-11-01;Meta;A;Qualified\n1;2026-11-01;Meta;A;New', 'leads'), /odlišné/);
  assert.throws(() => audit.readCsv('id;date\n1;"2026-11-01'), /neuzavřené/);
  assert.throws(() => audit.readCsv('Id;ID\n1;2'), /vlastní název/);
});

test('source is part of the campaign key and blank denominators stay blank in export', () => {
  const spend = importData('date;source;campaign_id;campaign_name;spend\n2026-11-02;Meta;1;=2+3;100\n2026-11-02;Google;1;Hledání;200', 'spend');
  const leads = importData('id;date;source;campaign_id;status\n1;2026-11-02;Meta;1;New\n2;2026-11-02;Google;1;Qualified\n3;2026-11-02;Sklik;1;Qualified\n4;2026-11-03;Google;1;Qualified', 'leads');
  const report = audit.calculate(audit.prepare(spend, leads, ['qualified']), '2026-11-02', '2026-11-02');
  assert.deepEqual(report.rows.map(({ qualified, cpql }) => [qualified, cpql]), [[0, null], [1, 200]]);
  assert.equal(report.noSpend, 1);
  assert.equal(report.leads.length, 3);
  const csv = audit.exportCsv(report, '2026-11-02', '2026-11-02');
  assert.ok(csv.includes(`"'=2+3"`));
  assert.ok(csv.includes('"100,00";"";"0,00"\r\n'));
});

test('the import window includes leads outside the spend window and retains diagnostic counts', () => {
  const spend = importData('date;source;campaign_id;spend\n2026-11-02;Google;G;100', 'spend');
  const leads = importData('id;date;source;campaign_id;status\n1;2026-11-01;Sklik;S;New\n1;2026-11-01;Sklik;S;New\n2;2026-11-03;Bing;B;New', 'leads');
  const data = audit.prepare(spend, leads, ['Qualified']);
  assert.deepEqual(data.dates, ['2026-11-01', '2026-11-03']);
  const report = audit.calculate(data, ...data.dates);
  assert.equal(report.noSpend, 2);
  assert.equal(data.duplicateRecords.length, 1);
  assert.equal(report.rows[0].rate, null);
  const parsed = audit.readCsv('date;source;campaign_id;spend\n2026-11-02;Google;G;100\nbad;Google;G;100');
  const preview = audit.inspectRows(parsed, audit.guessFields(parsed, 'spend'), 'spend');
  assert.deepEqual([preview.rows.length, preview.invalidCount], [1, 1]);
});

test('only the fixed demo record can be restored and removal of qualification resets its follow-up', () => {
  const demo = require('./demo-handoff.js');
  let entry;
  const storage = { getItem: () => entry, setItem: (_, value) => { entry = value; }, removeItem: () => { entry = undefined; } };
  assert.equal(demo.save(null), false);
  assert.equal(demo.save(storage), true);
  assert.deepEqual(demo.get(storage), { qualified: false, lead: demo.fixture, step: 0 });
  demo.save(storage, true, 4);
  demo.save(storage);
  assert.equal(demo.get(storage).step, 4);
  demo.save(storage, false);
  assert.equal(demo.get(storage).step, 0);
  entry = entry.replace('QA-SCENAR-01', 'OTHER');
  assert.equal(demo.get(storage), null);
  demo.forget(storage);
  assert.equal(entry, undefined);
});

test('findings distinguish date coverage from unknown campaign and keep incomplete rows traceable', () => {
  const spend = importData('date;source;campaign_id;spend\n2026-11-01;Google;A;100\n2026-11-02;Meta;A;100\n2026-11-02;Google;C;100', 'spend');
  const leads = importData('id;date;source;campaign_id;status\n=old;2026-11-02;Google;A;Qualified\nforeign;2026-11-02;Sklik;A;New\nstatus;2026-11-02;Google;C;\nclear;2026-11-02;Meta;A;New', 'leads');
  const report = audit.calculate(audit.prepare(spend, leads, ['qualified']), '2026-11-02', '2026-11-02');
  assert.deepEqual(report.leads.map((row) => row.attribution), ['outside-period', 'unknown-campaign', 'matched', 'matched']);
  assert.deepEqual([report.outsideSpend, report.noSpend, report.noStatus, report.totals.leads], [1, 2, 1, 2]);
  const csv = audit.exportFindings(report);
  assert.match(csv, /"'=old"[^\r\n]*Výdaje jsou v jiném období/);
  assert.match(csv, /foreign[^\r\n]*Kampaň ve výdajích chybí/);
  assert.match(csv, /status[^\r\n]*Přiřazeno[^\r\n]*Chybí stav CRM/);
  assert.doesNotMatch(csv, /clear/);
});

test('input export can be imported again with precise amounts and CRM states', () => {
  const spend = importData('date;source;campaign_id;spend\n2026-11-01;Google;A;12,34', 'spend');
  const leads = importData('id;date;source;campaign_id;status\nT-01;2026-11-01;Google;A;Schůzka', 'leads');
  const dataset = audit.prepare(spend, leads, ['  Schůzka ', 'Qualified']);
  assert.equal(dataset.qualifiedLabel, 'Schůzka');
  assert.equal(audit.isQualified(dataset, 'SCHUZKA'), true);
  assert.deepEqual(importData(audit.exportInput(dataset, 'spend'), 'spend').rows, spend.rows);
  assert.deepEqual(importData(audit.exportInput(dataset, 'leads'), 'leads').rows, leads.rows);
});

test('handoff is distinct from qualification and costs follow the attributed creation cohort', () => {
  const spend = importData('date;source;campaign_id;spend\n2026-11-01;LinkedIn Ads;A;900', 'spend');
  const header = 'id;date;source;campaign_id;status;handed_off_date\n';
  const qualified = 'L-1;2026-11-01;linkedin;A;Schůzka;\n';
  const delivered = 'L-2;2026-11-01;linkedin;A;Uzavřená;2026-11-03\n';
  const unattributed = 'L-3;2026-11-01;linkedin;B;Schůzka;2026-11-03\n';
  const leads = importData(header + qualified + delivered + unattributed, 'leads');
  const data = audit.prepare(spend, leads, ['Schůzka']);
  const report = audit.calculate(data, '2026-11-01', '2026-11-01');
  assert.equal(report.tracksHandoffs, true);
  assert.deepEqual([report.totals.leads, report.totals.qualified, report.totals.handedOff, report.costPerHandoff], [2, 1, 1, 900]);
  assert.match(audit.exportCsv(report, '2026-11-01', '2026-11-01'), /"predane_klientovi";"cena_za_predanou_czk"/);
  assert.deepEqual(importData(audit.exportInput(data, 'leads'), 'leads').rows, leads.rows);
  assert.throws(() => importData(header + delivered.replace('2026-11-03', '2026-10-30'), 'leads'), /nesmí předcházet/);
});
