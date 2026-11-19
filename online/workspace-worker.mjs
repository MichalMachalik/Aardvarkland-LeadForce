import initSqlJs from 'sql.js';
import schema from '../schema.sql';
import { createStore } from '../workspace-store.mjs';
import { createExample, populateClientExample, prepareClaimColleague } from '../demo.mjs';
import { exampleAdsSnapshot, prepareExampleBinding } from '../google-ads-example.mjs';
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

function handle(store, profiles, { path: url, method, body, session, csrf }) {
  const { pathname: path, searchParams } = new URL(url, 'https://workspace.example');
  if (method === 'GET' && path === '/api/config') {
    return result({ choices: Object.entries(profiles).map(([key, { role, name }]) => ({ key, role, name })), googleAds: 'demo' });
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
  if (method === 'POST' && ['/api/login', '/api/invite/accept', '/api/password/reset'].includes(path)) {
    const next = path === '/api/login' ? store.signIn(body) : path === '/api/password/reset' ? store.redeemRecovery(body) : store.claimInvite(body);
    store.signOut(session);
    return sessionResult(next);
  }

  const actor = store.session(session);
  if (!actor) throw new Failure(401, 'Přihlaste se do pracovního prostoru.');
  if (method === 'GET') {
    if (path === '/api/state') return result(store.state(actor));
    if (path === '/api/leads') return result(store.leadQueue(actor, searchParams));
    if (path === '/api/monthly-reports') return result(store.monthlyReports(actor, searchParams));
    const monthly = /^\/api\/monthly-reports\/(\d+)(\.csv)?$/.exec(path);
    if (monthly?.[2]) return { ...result(store.monthlyReport(actor, monthly[1], true)), contentType: 'text/csv; charset=utf-8' };
    if (monthly) return result(store.monthlyReport(actor, monthly[1]));
    const thread = /^\/api\/investor-messages\/(\d+)$/.exec(path);
    if (thread) return result(store.investorThread(actor, thread[1]));
    if (path === '/api/handoffs') return result(store.handoffInbox(actor, searchParams));
    if (path === '/api/handoff-attention') return result(store.handoffAttention(actor, searchParams));
    if (path === '/api/handoff-attention/count') return result(store.handoffAttentionCounts(actor));
    const delivery = /^\/api\/handoffs\/(\d+)$/.exec(path);
    if (delivery) return result(store.handoffDetail(actor, delivery[1]));
    if (path === '/api/client/report') return result(store.clientReport(actor, searchParams));
    if (path === '/api/client/report.csv') return { ...result(store.clientReport(actor, searchParams, true)), contentType: 'text/csv; charset=utf-8' };
    if (path === '/api/export/leads.csv') return { ...result(store.exportLeads(actor)), contentType: 'text/csv; charset=utf-8' };
    if (path === '/api/export/portfolio.csv') return { ...result(store.exportPortfolio(actor)), contentType: 'text/csv; charset=utf-8' };
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
    if (path === '/api/actions/sync-google-ads') {
      const plan = store.googleAds.plan(actor, body);
      return result(store.googleAds.apply(actor, plan, exampleAdsSnapshot(plan, body.scenario)));
    }
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
        const db = sqliteConnection(sqlite);
        const open = (options) => createStore(db, schema, credentials, options);
        const { store, profiles } = record ? { store: open(), profiles: record.profiles } : createExample(open, credentials.token);
        if (record && store.upgraded && !profiles.client) {
          const profile = populateClientExample(store, credentials.token, profiles.admin.id, profiles.care.id);
          if (profile) profiles.client = profile;
        }
        if (record && !record.adsReady) prepareExampleBinding(store, profiles);
        if (record && !record.claimColleagueReady && !profiles.careBackup) {
          const colleague = prepareClaimColleague(store, credentials.token, profiles.admin.id);
          if (colleague) profiles.careBackup = colleague;
        }
        try { reply = handle(store, profiles, input); } catch (error) {
          if (!(error instanceof Failure)) throw error;
          reply = result({ error: error.message }, error.status);
        }
        if (!record || store.upgraded || !record.adsReady || !record.claimColleagueReady || (input.method === 'POST' && reply.status < 400)) {
          records.put({ profiles, adsReady: true, claimColleagueReady: true, snapshot: sqlite.export() }, 'current');
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
