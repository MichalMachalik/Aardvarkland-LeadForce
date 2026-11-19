import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

export const token = () => btoa(String.fromCharCode(...randomBytes(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const hash = (value) => bytesToHex(sha256(new TextEncoder().encode(value)));

export function passwordDigest(value, salt = bytesToHex(randomBytes(16))) {
  const digest = scrypt(value, salt, { N: 1 << 12, r: 8, p: 1, dkLen: 32 });
  return salt + ':' + bytesToHex(digest);
}

export function passwordMatches(value, digest) {
  return passwordDigest(value, digest.split(':')[0]) === digest;
}
