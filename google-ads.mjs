import { reportDay } from './client-accounts.mjs';
import { day, Failure } from './validation.mjs';

const dateStep = 86_400_000;
const shifted = (day, offset) => new Date(Date.parse(day) + offset * dateStep).toISOString().slice(0, 10);

export function syncWindow(anchor = reportDay(), length = 7) {
  return { from: shifted(anchor, -length), to: shifted(anchor, -1) };
}

export function syncDays(input, today = reportDay()) {
  const from = day(input.from);
  const to = day(input.to);
  const length = (Date.parse(to) - Date.parse(from)) / dateStep + 1;
  if (length < 1 || length > 31 || to >= today) {
    throw new Failure(422, 'Vyberte nejvýše 31 uzavřených dnů končících nejpozději včera.');
  }
  return Array.from({ length }, (_, index) => shifted(from, index));
}

export function adsIds(input) {
  const customer = typeof input.customer === 'string' ? input.customer.replaceAll('-', '').trim() : '';
  const external = typeof input.external === 'string' ? input.external.trim() : '';
  if (!/^\d{10}$/.test(customer) || !/^[1-9]\d{0,18}$/.test(external) || BigInt(external) > 9223372036854775807n) {
    throw new Failure(422, 'Zadejte desetimístné ID účtu a platné číselné ID kampaně Google Ads.');
  }
  return { customer, external };
}

function providerFailure(message = 'Zdroj Google Ads vrátil neplatná data. Zkuste synchronizaci znovu.') {
  return new Failure(502, message);
}

function rows(payload) {
  if (!Array.isArray(payload)) throw providerFailure();
  return payload.flatMap((batch) => {
    if (!batch || typeof batch !== 'object' || (batch.results !== undefined && !Array.isArray(batch.results))) throw providerFailure();
    return batch.results ?? [];
  });
}

export function normalizeAdsCosts(plan, snapshot) {
  const accounts = rows(snapshot?.account);
  if (accounts.length !== 1 || String(accounts[0]?.customer?.id) !== plan.customer) throw providerFailure();
  const account = accounts[0].customer;
  if (account.currencyCode !== 'CZK' || account.timeZone !== 'Europe/Prague') {
    throw new Failure(422, 'Pilot podporuje účty Google Ads v CZK s časovým pásmem Europe/Prague.');
  }
  const costs = new Map();
  const requested = new Set(plan.days);
  for (const item of rows(snapshot?.campaigns)) {
    const date = item?.segments?.date;
    if (!requested.has(date) || String(item?.campaign?.id) !== plan.external) throw providerFailure();
    const value = item.metrics?.costMicros ?? '0';
    if (typeof value !== 'string' && !Number.isSafeInteger(value)) throw providerFailure();
    const micros = String(value);
    if (!/^\d{1,16}$/.test(micros)) throw providerFailure();
    const raw = BigInt(micros);
    const cents = (raw + 5000n) / 10000n;
    if (cents > 100000000000n) throw providerFailure();
    const previous = costs.get(date);
    if (previous && previous.micros !== raw.toString()) {
      throw providerFailure('Zdroj vrátil dva různé náklady pro stejnou kampaň a den.');
    }
    costs.set(date, { micros: raw.toString(), cents: Number(cents) });
  }
  return costs;
}
