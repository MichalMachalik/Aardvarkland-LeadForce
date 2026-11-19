import { DatabaseSync, backup } from 'node:sqlite';
import { chmod, link, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseFile } from './config.mjs';

export async function backupDatabase(source, destination) {
  const target = resolve(destination);
  if (resolve(source) === target) throw new Error('Zálohu uložte do jiného souboru než živou databázi.');
  const folder = await mkdtemp(join(dirname(target), '.leadforce-backup-'));
  try {
    const snapshot = join(folder, 'snapshot.sqlite');
    const live = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(live, snapshot);
    } finally {
      live.close();
    }
    const restored = new DatabaseSync(snapshot, { readOnly: true });
    try {
      if (restored.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
          restored.prepare('PRAGMA foreign_key_check').get() ||
          !restored.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='workspaces'").get()) {
        throw new Error('Konzistenci zálohy LeadForce se nepodařilo ověřit.');
      }
    } finally {
      restored.close();
    }
    await chmod(snapshot, 0o600);
    try {
      await link(snapshot, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw new Error('Zadaný soubor už existuje. Pro zálohu zvolte nový název.');
    }
    return target;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const destination = process.argv[2];
    if (!destination || process.argv.length !== 3) throw new Error('Použití: npm run backup -- cesta-k-zaloze.sqlite');
    console.log(await backupDatabase(databaseFile(), destination));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
