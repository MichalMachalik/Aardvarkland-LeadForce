'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const portal = require('./portal-data.js');

test('portfolio excludes completed principal and finds the earliest active payment', () => {
  const summary = portal.portfolio();
  assert.equal(summary.invested, 400000);
  assert.equal(summary.active.length, 2);
  assert.deepEqual([summary.next.position.id, summary.next.date, summary.next.amount], ['MD-101', '2026-12-18', 6250]);
  const closed = portal.positions.filter((item) => item.status === 'closed');
  const csv = portal.exportPortfolio(closed);
  assert.match(csv, /"MS-087";"Mlýn u Sadu";"100000";"Splacená";"2026-10-30";"";""/);
  assert.doesNotMatch(csv, /MD-101/);
});

test('catalog searches without Czech accents and combines category and saved filters', () => {
  const saved = new Set(['stran']);
  assert.deepEqual(portal.filterOpportunities('  STRANI  ', 'Rezidenční výstavba', true, saved).map((item) => item.id), ['stran']);
  assert.deepEqual(portal.filterOpportunities('javorova', '', true, saved), []);
  assert.deepEqual(portal.filterOpportunities('javorova', 'Obnova budov', false, saved).map((item) => item.id), ['javor']);
});

test('payment calendar contains stable unique all-day demo events in portfolio order', () => {
  const schedule = portal.paymentSchedule(portal.positions);
  assert.deepEqual(schedule.map(({ date }) => date), ['2026-12-18','2027-01-22','2027-03-19','2027-04-23']);
  assert.equal(schedule.reduce((sum, { amount }) => sum + amount, 0), 20000);
  const calendar = portal.exportCalendar(schedule, new Date('2026-11-19T10:11:12.000Z'));
  assert.match(calendar, /DTSTAMP:20261119T101112Z\r\nDTSTART;VALUE=DATE:20261218/);
  assert.match(calendar, /SUMMARY:Platba · Projekt Modrý Dvůr/);
  assert.equal(new Set(calendar.match(/UID:[^\r\n]+/g)).size, 4);
  assert.ok(calendar.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75));
  assert.doesNotMatch(calendar, /MS-087/);
  assert.deepEqual(portal.paymentSchedule(portal.positions.filter(({ status }) => status === 'closed')), []);
});

test('communication follows the simulated journey and does not duplicate events', () => {
  assert.equal(portal.messages(0).length, 3);
  assert.deepEqual(portal.messages(2).filter(({ step }) => step).map(({ id }) => id), ['case-email']);
  const final = portal.messages(4);
  assert.deepEqual(final.filter(({ step }) => step).map(({ id }) => id), ['case-reengaged','case-check-in','case-email']);
  assert.equal(final.length, new Set(final.map(({ id }) => id)).size);
});

test('stored preferences restore known IDs only and work with inaccessible or broken storage', () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const state = portal.defaultState();
  state.saved.add('stran');
  state.interest.add('javor');
  state.read.add('case-reengaged');
  assert.equal(portal.save(storage, state), true);
  assert.deepEqual(portal.load(storage), state);
  entries.set(portal.stateKey, '{"version":1,"saved":["stran","stran","other"],"interest":"javor","read":["portfolio-list","other"]}');
  assert.deepEqual(portal.load(storage), { saved: new Set(['stran']), interest: new Set(), read: new Set(['portfolio-list']) });
  entries.set(portal.stateKey, '{');
  assert.equal(portal.load(storage), null);
  assert.equal(portal.load(null), null);
  assert.equal(portal.save(null, state), false);
});

test('portfolio import accepts an empty workspace and rejects invalid or duplicate production records', () => {
  const empty = { positions: [], opportunities: [], messages: [] };
  assert.deepEqual(portal.parsePortfolio(JSON.stringify(empty)), empty);
  const position = { id: 'P-1', name: 'Portfolio A', category: 'Fondy', principal: 123.45, status: 'active', maturity: '2028-02-29',
    schedule: [{ date: '2026-12-08', amount: 4.25 }, { date: '2026-12-03', amount: 1.03 }] };
  const parse = (positions) => portal.parsePortfolio(JSON.stringify({ ...empty, positions }));
  assert.deepEqual(parse([position]).positions[0].schedule.map(({ date }) => date), ['2026-12-03', '2026-12-08']);
  assert.throws(() => parse([position, position]), /opakovaná hodnota id/);
  assert.throws(() => parse([{ ...position, maturity: '2027-02-29' }]), /maturity/);
  assert.throws(() => parse([{ ...position, principal: 1.111 }]), /principal/);
  assert.throws(() => parse([{ ...position, status: 'closed' }]), /schedule/);
  const message = { id: 'M-1', date: '2026-11-03', type: 'Reporting', title: 'Průběh', positionId: position.id };
  assert.equal(portal.parsePortfolio(JSON.stringify({ ...empty, positions: [position], messages: [message] })).messages[0].positionId, position.id);
  assert.throws(() => portal.parsePortfolio(JSON.stringify({ ...empty, messages: [message] })), /neznámá pozice/);
});
