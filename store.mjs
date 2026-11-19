import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as security from './security.mjs';
import { createStore } from './workspace-store.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  try {
    if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
    return createStore(db, schema, security);
  } catch (error) {
    db.close();
    throw error;
  }
}
