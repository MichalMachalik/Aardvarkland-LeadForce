import initSqlJs from 'sql.js';
import schema from '../schema.sql';
import { createStore } from '../workspace-store.mjs';
import { populateExample } from '../demo.mjs';
import { Failure } from '../validation.mjs';
import * as credentials from './credentials.mjs';
import { sqliteConnection } from './sqlite.mjs';

const storage = new Promise((resolve, reject) => {
  const request = indexedDB.open('aardvarkland-leadforce', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('workspace');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const ready = Promise.all([initSqlJs({ locateFile: () => new URL('./workspace-sql.wasm', import.meta.url).href }), storage]);
const result = (body, status = 200) => ({ status, body });
const sessionResult = (session) => ({ ...result({ ok: true }), session });

function handle(store, profiles, { path, method, body, session, csrf }) {
  if (method === 'GET' && path === '/api/config') {
    return result({ choices: Object.values(profiles).map(({ role, name }) => ({ role, name })) });
  }
  if (method === 'POST' && typeof body.email === 'string' && !/\.example$/i.test(body.email.trim())) {
    throw new Failure(422, 'Použijte smyšlenou e-mailovou adresu s doménou .example.');
  }
  if (method === 'POST' && path === '/api/example/session') {
    if (!Object.hasOwn(profiles, body.role)) throw new Failure(404, 'Profil nebyl nalezen.');
    const userId = profiles[body.role].id;
    const next = store.createSession(userId);
    if (!store.session(next)) throw new Failure(403, 'Ukázkový účet je deaktivovaný.');
    store.signOut(session);
    return sessionResult(next);
  }
  if (method === 'POST' && ['/api/login', '/api/invite/accept'].includes(path)) {
    const next = path === '/api/login' ? store.signIn(body) : store.claimInvite(body);
    store.signOut(session);
    return sessionResult(next);
  }

  const actor = store.session(session);
  if (!actor) throw new Failure(401, 'Přihlaste se do pracovního prostoru.');
  if (method === 'GET') {
    if (path === '/api/state') return result(store.state(actor));
    if (path === '/api/export/leads.csv') return { ...result(store.exportLeads(actor)), contentType: 'text/csv; charset=utf-8' };
    const lead = /^\/api\/leads\/(\d+)$/.exec(path);
    if (lead) return result(store.leadDetail(actor, lead[1]));
  }
  if (method === 'POST') {
    if (csrf !== actor.csrf) throw new Failure(403, 'Obnovte stránku a zkuste akci znovu.');
    if (path === '/api/logout') {
      store.signOut(session);
      return sessionResult(null);
    }
    if (path === '/api/password') return sessionResult(store.changePassword(actor, body));
    const action = /^\/api\/actions\/([a-z-]+)$/.exec(path);
    if (action) return result(store.command(actor, action[1], body));
  }
  throw new Failure(404, 'Cesta nebyla nalezena.');
}

async function transact(input) {
  const [SQL, database] = await ready;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('workspace', 'readwrite');
    const records = transaction.objectStore('workspace');
    let reply;
    transaction.oncomplete = () => resolve(reply);
    transaction.onabort = () => reject(transaction.error ?? new Error('Změnu se nepodařilo uložit.'));
    if (input.path === '/api/example/reset' && input.method === 'POST') {
      records.delete('current');
      reply = sessionResult(null);
      return;
    }
    const read = records.get('current');
    read.onsuccess = () => {
      const record = read.result;
      const sqlite = new SQL.Database(record?.snapshot);
      try {
        const store = createStore(sqliteConnection(sqlite), schema, credentials);
        const profiles = record?.profiles ?? populateExample(store, credentials.token);
        try { reply = handle(store, profiles, input); } catch (error) {
          if (!(error instanceof Failure)) throw error;
          reply = result({ error: error.message }, error.status);
        }
        if (!record || (input.method === 'POST' && reply.status < 400)) {
          records.put({ profiles, snapshot: sqlite.export() }, 'current');
        }
      } catch (error) {
        reject(error);
        transaction.abort();
      } finally {
        sqlite.close();
      }
    };
  });
}

self.addEventListener('message', async ({ data }) => {
  let reply;
  try { reply = await transact(data.input); } catch (error) {
    console.error(error);
    reply = result({ error: 'Ukázku se nepodařilo otevřít. Povolte úložiště pro tento web a zkuste to znovu.' }, 500);
  }
  self.postMessage({ id: data.id, reply });
});
