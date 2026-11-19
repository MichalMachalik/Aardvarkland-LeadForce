import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimDeadlineCalculator, defaultClaimCalendar, validateClaimCalendar } from '../claim-calendar.mjs';

test('Prague complaint calendar carries partial hours over weekends, clock changes and Czech holidays', () => {
  const due = claimDeadlineCalculator();
  const cases = [
    ['2026-03-28T20:00:00.000Z', 1, '2026-03-30T07:00:00.000Z'],
    ['2026-04-02T13:30:00.123Z', 2, '2026-04-07T07:30:00.123Z'],
    ['2026-10-23T13:30:00.000Z', 1, '2026-10-26T07:30:00.000Z'],
    ['2026-12-23T15:30:00.000Z', 1, '2026-12-28T08:00:00.000Z'],
    ['2026-12-31T15:00:00.000Z', 1, '2027-01-04T08:00:00.000Z'],
  ];
  for (const [start, teamHours, expected] of cases) {
    const policy = { ...defaultClaimCalendar, teamHours };
    assert.equal(due(start, 0, JSON.stringify(policy)), expected);
  }
});

test('custom shift, client duration and additional closures override the default for the organisation', () => {
  const due = claimDeadlineCalculator();
  const start = '2026-05-06T07:29:59.999Z';
  const policy = validateClaimCalendar({
    opens: '09:30', closes: '12:00', teamHours: '5', clientHours: 1, closures: '2026-05-07\r\n\r\n2026-05-07',
  });
  assert.deepEqual(policy.closures, ['2026-05-07']);
  const saved = JSON.stringify(policy);
  assert.equal(due(start, 0, saved), '2026-05-11T10:00:00.000Z');
  assert.equal(due(start, 1, saved), '2026-05-06T08:30:00.000Z');
  assert.equal(due(start, 0, null), '2026-05-12T07:29:59.999Z');
});
