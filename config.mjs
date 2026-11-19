import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const base = dirname(fileURLToPath(import.meta.url));

export function databaseFile() {
  const file = resolve(process.env.WORKSPACE_DATA || resolve(base, 'data', 'workspace.sqlite'));
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return file;
}

export function configuration(demo) {
  const port = Number(process.env.WORKSPACE_PORT || (demo ? 4191 : 4190));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WORKSPACE_PORT musí být platné číslo portu.');
  const local = 'http://127.0.0.1:' + port;
  const origin = new URL(process.env.WORKSPACE_ORIGIN || local);
  if (origin.href !== origin.origin + '/' || (origin.protocol !== 'https:' && origin.origin !== local)) {
    throw new Error('WORKSPACE_ORIGIN musí být lokální adresa služby nebo HTTPS původ bez cesty.');
  }
  if (demo && origin.origin !== local) throw new Error('Demo je dostupné na místní adrese 127.0.0.1.');
  return { port, origin: origin.origin };
}
