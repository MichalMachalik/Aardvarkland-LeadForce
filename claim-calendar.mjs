import { reportDay } from './client-accounts.mjs';
import { day, Failure } from './validation.mjs';

const minute = 60_000;
const hour = 60 * minute;
const dayLength = 24 * hour;
const fixedHolidays = new Set(['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26']);
const localTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', timeStyle: 'short', hourCycle: 'h23' });
const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export const defaultClaimCalendar = Object.freeze({
  opens: '08:00', closes: '16:00', teamHours: 24, clientHours: 72, closures: Object.freeze([]),
});

function responseHours(value, label) {
  const hours = typeof value === 'number' || typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(hours) || hours < 1 || hours > 240) throw new Failure(422, label + ' musí být 1 až 240 pracovních hodin.');
  return hours;
}

export function validateClaimCalendar(body) {
  const { opens, closes } = body;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (typeof opens !== 'string' || typeof closes !== 'string' || !time.test(opens) || !time.test(closes) || opens >= closes) {
    throw new Failure(422, 'Konec pracovní doby musí být později než začátek.');
  }
  const teamHours = responseHours(body.teamHours, 'Lhůta týmu');
  const clientHours = responseHours(body.clientHours, 'Lhůta klienta');
  if (typeof body.closures !== 'string' || body.closures.length > 4_096) {
    throw new Failure(422, 'Zadejte nejvýše 366 dnů volna, každý na nový řádek.');
  }
  const closures = [...new Set(body.closures.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(day))].sort();
  if (closures.length > 366) throw new Failure(422, 'Zadejte nejvýše 366 dnů volna.');
  return { opens, closes, teamHours, clientHours, closures };
}

function easterSunday(year) {
  // Gregorian computus (Meeus/Jones/Butcher).
  const cycle = year % 19;
  const century = Math.floor(year / 100);
  const remainder = year % 100;
  const correction = Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3);
  const moon = (19 * cycle + century - Math.floor(century / 4) - correction + 15) % 30;
  const weekday = (32 + 2 * (century % 4) + 2 * Math.floor(remainder / 4) - moon - remainder % 4) % 7;
  const adjusted = moon + weekday - 7 * Math.floor((cycle + 11 * moon + 22 * weekday) / 451) + 114;
  return Date.UTC(year, Math.floor(adjusted / 31) - 1, adjusted % 31 + 1);
}

function pragueInstant(wallDay, localMinutes) {
  const wallTime = wallDay + localMinutes * minute;
  // All shift boundaries are on weekdays, away from Prague's Sunday clock changes.
  const offsetTime = Date.parse(reportDay(new Date(wallTime)) + 'T' + localTime.format(wallTime) + ':00Z');
  return wallTime - (offsetTime - wallTime);
}

export function claimDeadlineCalculator() {
  let currentPolicy;
  let policy;
  let closures;
  let opening;
  let shiftLength;
  const easters = new Map();
  const deadlines = new Map();

  function isWorkingDay(wallDay) {
    const date = new Date(wallDay);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    const iso = date.toISOString().slice(0, 10);
    if (fixedHolidays.has(iso.slice(5)) || closures.has(iso)) return false;
    const year = date.getUTCFullYear();
    if (!easters.has(year)) easters.set(year, easterSunday(year));
    const easter = easters.get(year);
    return wallDay !== easter - 2 * dayLength && wallDay !== easter + dayLength;
  }

  return (start, clientTurn, serializedPolicy) => {
    if (start === null) return null;
    if (!policy || currentPolicy !== serializedPolicy) {
      currentPolicy = serializedPolicy;
      policy = serializedPolicy === null ? defaultClaimCalendar : JSON.parse(serializedPolicy);
      closures = new Set(policy.closures);
      opening = minutes(policy.opens);
      shiftLength = (minutes(policy.closes) - opening) * minute;
      deadlines.clear();
    }
    const key = clientTurn + '/' + start;
    if (deadlines.has(key)) return deadlines.get(key);
    const from = Date.parse(start);
    let remaining = (clientTurn ? policy.clientHours : policy.teamHours) * hour;
    const firstDay = Date.parse(reportDay(new Date(from)));
    for (let wallDay = firstDay; ; wallDay += dayLength) {
      if (!isWorkingDay(wallDay)) continue;
      let available = shiftLength;
      let eligible;
      if (wallDay === firstDay) {
        const open = pragueInstant(wallDay, opening);
        eligible = Math.max(open, from);
        available -= eligible - open;
        if (available <= 0) continue;
      }
      if (remaining <= available) {
        const due = new Date((eligible ?? pragueInstant(wallDay, opening)) + remaining).toISOString();
        if (deadlines.size >= 2_048) deadlines.clear();
        deadlines.set(key, due);
        return due;
      }
      remaining -= available;
    }
  };
}
