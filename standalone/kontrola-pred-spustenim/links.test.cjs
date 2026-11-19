'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const launch = require('./links.js');
const demo = require('./demo-handoff.js');
const sample = launch.sample;
const config = launch.rules(sample.host, sample.sources, sample.media);

test('sample detects missing IDs, repeated keys and wrong destination', () => {
  assert.deepEqual(launch.scan(sample.links.join('\n'), config).map((item) => item.issues.map(({ code }) => code)), [[], ['missing'], ['duplicate-parameter'], ['https','domain'], ['missing']]);
});

test('builder replaces stale tracking and preserves other URL data', () => {
  const url = launch.compose(`https://${sample.host}/byt?ref=agency&UTM_ID=old&utm_id=duplicate#details`, {
    utm_source:'meta', utm_medium:'paid_social', utm_id:'M-101', utm_campaign:'Rezidence Na Stráni', utm_content:'Varianta B',
  }, config);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('ref'), 'agency');
  assert.equal(parsed.hash, '#details');
  assert.deepEqual(parsed.searchParams.getAll('utm_id'), ['M-101']);
  assert.equal(parsed.searchParams.get('utm_content'), 'varianta-b');
  assert.deepEqual(launch.inspect(url, config).issues, []);
});

test('repeat links are identified across query order and fragment differences', () => {
  const first = sample.links[0];
  const reordered = new URL(first);
  reordered.searchParams.sort();
  reordered.hash = 'info';
  assert.equal(launch.scan(`${first}\n${reordered.href}`, config)[1].issues.at(-1).code, 'duplicate-link');
  assert.throws(() => launch.rules('https://site.example', sample.sources, sample.media), /doménu/);
  assert.equal(launch.inspect('not-a-url', config).issues[0].code, 'invalid-url');
  assert.ok(launch.inspect(first.replace('google', 'Google'), config).issues.some(({ code }) => code === 'source'));
  assert.ok(launch.inspect(first.replace(sample.host, `unauthorized.${sample.host}`), config).issues.some(({ code }) => code === 'domain'));
});

test('a batch permits several exact hosts and rejects an unlisted subdomain', () => {
  const rules = launch.rules(sample.host + ', PARTNER.EXAMPLE', sample.sources, sample.media);
  const first = sample.links[0];
  const partner = first.replace(sample.host, 'partner.example');
  const unrelated = first.replace(sample.host, 'new.partner.example');
  assert.deepEqual(launch.scan([first, partner, unrelated].join('\n'), rules).map((row) => row.issues.map(({ code }) => code)), [[], [], ['domain']]);
});

test('CRM export preserves attribution and only the repaired fixture is eligible for the handoff', () => {
  const repaired = launch.inspect(`${sample.links.at(-1)}&utm_id=G-202`, config);
  assert.equal(launch.isHandoff(repaired), true);
  assert.equal(launch.isHandoff(launch.inspect(sample.links[0], config)), false);
  assert.equal(launch.isHandoff(launch.inspect(`${repaired.raw}&other=not-the-fixture`, config)), false);
  const row = launch.testLead(repaired, demo.fixture.id, sample.date);
  assert.deepEqual(row, demo.fixture);
  assert.throws(() => launch.testLead(launch.inspect(sample.links[1], config), 'QA-2'));
  const leadCsv = launch.exportCsv(['lead_id','created_date','source','campaign_id','status'], [Object.values(row)]);
  assert.match(leadCsv, /"QA-SCENAR-01";"2026-11-03";"google";"G-202";"Nová"/);
  assert.equal(launch.exportCsv(['x'], [['=2+2']]).includes(`"'=2+2"`), true);
});

test('campaign consistency blocks conflicting rows without grouping other sources or creative variants', () => {
  const first = sample.links[0];
  const different = `${first.replace('rezidence-na-strani', 'rezidence-jaro')}&utm_content=varianta-b`;
  const meta = different.replace('google', 'meta').replace('cpc', 'paid_social');
  const variant = `${first}&utm_content=varianta-c`;
  const rows = launch.scan([first, different.replace('cpc', 'display'), meta, variant].join('\n'), config);
  assert.deepEqual(rows.map((row) => row.issues.map(({ code }) => code)), [['campaign-conflict','campaign-conflict'],['campaign-conflict','campaign-conflict'],[],['campaign-conflict','campaign-conflict']]);
  assert.match(rows[0].issues[0].description, /řádku 2/);
  assert.match(rows[1].issues[0].description, /řádku 1/);
  assert.deepEqual(launch.scan([first, variant].join('\n'), config).map((row) => row.issues), [[], []]);
});

test('an ID is suggested only for an unambiguous matching campaign in the checked batch', () => {
  const [ready, missing] = [sample.links[0], sample.links.at(-1)];
  const rows = launch.scan([ready, missing].join('\n'), config);
  assert.equal(launch.suggestCampaignId(rows[1], rows), 'G-202');
  assert.equal(launch.suggestCampaignId(rows[0], rows), '');
  const ambiguous = launch.scan([ready, missing, `${ready.replace('G-202', 'G-203')}&utm_content=other`].join('\n'), config);
  assert.equal(launch.suggestCampaignId(ambiguous[1], ambiguous), '');
  const foreign = launch.scan([ready, missing.replace('google', 'meta')].join('\n'), config);
  assert.equal(launch.suggestCampaignId(foreign[1], foreign), '');
});
