export const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export class Failure extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function text(value, label, length = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > length) {
    throw new Failure(422, label + ' musí mít 1 až ' + length + ' znaků.');
  }
  return value.trim();
}

export function email(value) {
  const address = text(value, 'E-mail', 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Failure(422, 'Zadejte platný e-mail.');
  return address;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new Failure(422, 'Heslo musí mít 12 až 128 znaků.');
  }
  return value;
}

export function id(value) {
  const number = typeof value === 'number' || /^\d{1,12}$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1) throw new Failure(422, 'Neplatný identifikátor.');
  return number;
}

export function day(value) {
  const raw = text(value, 'Datum', 10);
  const date = new Date(raw + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Failure(422, 'Zadejte platné datum.');
  }
  return raw;
}
