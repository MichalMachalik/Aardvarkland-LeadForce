import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export * from './validation.mjs';

const scrypt = { N: 1 << 17, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value) => createHash('sha256').update(value).digest('hex');

export function sameSecret(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  const left = Buffer.from(first, 'utf8');
  const right = Buffer.from(second, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function passwordDigest(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64, scrypt).toString('hex');
}

export function passwordMatches(password, digest) {
  const salt = digest.split(':')[0];
  return sameSecret(passwordDigest(password, salt), digest);
}
