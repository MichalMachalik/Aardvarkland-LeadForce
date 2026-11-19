import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, configuration, databaseFile } from './config.mjs';
import { Failure, sameSecret, token } from './security.mjs';
import { googleAdsProvider } from './google-ads-provider.mjs';
import { openStore } from './store.mjs';

const standard = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/transport.js': ['transport.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/assets/inter-latin.woff2': ['assets/inter-latin.woff2', 'font/woff2'],
  '/assets/inter-latin-ext.woff2': ['assets/inter-latin-ext.woff2', 'font/woff2'],
  '/assets/aardvarkland.png': ['assets/aardvarkland.png', 'image/png'],
};
const tools = Object.fromEntries(['kontrola-pred-spustenim', 'audit-kampani', 'portal-investora']
  .map((slug) => ['/tools/' + slug + '/index.html', slug + '/index.html']));

function send(res, code, body, headers) {
  res.writeHead(code, { ...standard, ...headers });
  return res.end(body);
}
const json = (res, code, value, headers) => send(res, code, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...headers });

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new Failure(415, 'Použijte JSON.');
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 32768) throw new Failure(413, 'Požadavek je příliš velký.');
    parts.push(part);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new Failure(400, 'Neplatná data požadavku.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Failure(400, 'Neplatná data požadavku.');
  return result;
}

export function createWorkspaceServer(store, { origin, profiles = null, googleAds = null, log = console.error }) {
  const secure = origin.startsWith('https:');
  const cookie = secure ? '__Host-workspace' : 'workspace';
  const setCookie = (value, maxAge = 8 * 60 * 60) => cookie + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
  const attempts = new Map();

  function limit(req, res) {
    const key = req.socket.remoteAddress;
    const time = Date.now();
    for (const [ip, value] of attempts) if (value.until <= time) attempts.delete(ip);
    const item = attempts.get(key) ?? { count: 0, until: time + 60_000 };
    if (item.count >= 18 || (attempts.size >= 512 && !attempts.has(key))) {
      res.setHeader('Retry-After', '60');
      throw new Failure(429, 'Zkuste to znovu za minutu.');
    }
    item.count++;
    attempts.set(key, item);
  }

  async function handler(req, res) {
    const { pathname, searchParams } = new URL(req.url, origin);
    if (req.method === 'GET' && pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && pathname === '/ready') return json(res, 200, { ok: store.ready() });
    if (req.method === 'GET' && Object.hasOwn(assets, pathname)) {
      const [file, mime] = assets[pathname];
      return send(res, 200, await readFile(resolve(base, 'public', file)), { 'Content-Type': mime, 'Content-Security-Policy': policy });
    }
    if (req.method === 'GET' && pathname === '/api/config') {
      const choices = profiles ? Object.entries(profiles).map(([key, { role, name }]) => ({ key, role, name })) : [];
      return json(res, 200, { choices, ...(googleAds ? { googleAds: googleAds.mode } : {}) });
    }

    const raw = req.headers.cookie?.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(cookie + '='))?.slice(cookie.length + 1);
    if (req.method === 'POST') {
      if (req.headers.origin !== origin) throw new Failure(403, 'Požadavek musí přijít z otevřené aplikace.');
      if (['/api/login', '/api/invite/accept', '/api/password/reset', '/api/example/session'].includes(pathname)) {
        limit(req, res);
        if (pathname.endsWith('example/session') && !profiles) throw new Failure(404, 'Cesta nebyla nalezena.');
        const body = await readJson(req);
        let next;
        if (pathname === '/api/login') next = store.signIn(body);
        else if (pathname === '/api/invite/accept') next = store.claimInvite(body);
        else if (pathname === '/api/password/reset') next = store.redeemRecovery(body);
        else {
          const profile = typeof body.role === 'string' && Object.hasOwn(profiles, body.role) ? profiles[body.role] : null;
          if (!profile) throw new Failure(404, 'Profil nebyl nalezen.');
          next = store.createSession(profile.id);
        }
        store.signOut(raw);
        return json(res, 200, { ok: true }, { 'Set-Cookie': setCookie(next) });
      }
    }
    const actor = store.session(raw);
    if (!actor) throw new Failure(401, 'Přihlaste se do pracovního prostoru.');

    if (req.method === 'GET') {
      if (pathname === '/api/state') return json(res, 200, store.state(actor));
      if (pathname === '/api/leads') return json(res, 200, store.leadQueue(actor, searchParams));
      if (pathname === '/api/monthly-reports') return json(res, 200, store.monthlyReports(actor, searchParams));
      const monthly = /^\/api\/monthly-reports\/(\d+)(\.csv)?$/.exec(pathname);
      if (monthly?.[2]) return send(res, 200, store.monthlyReport(actor, monthly[1], true), {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mesicni-uzaverka.csv"',
      });
      if (monthly) return json(res, 200, store.monthlyReport(actor, monthly[1]));
      const thread = /^\/api\/investor-messages\/(\d+)$/.exec(pathname);
      if (thread) return json(res, 200, store.investorThread(actor, thread[1]));
      if (pathname === '/api/handoffs') return json(res, 200, store.handoffInbox(actor, searchParams));
      if (pathname === '/api/handoff-attention') return json(res, 200, store.handoffAttention(actor, searchParams));
      if (pathname === '/api/handoff-attention/count') return json(res, 200, store.handoffAttentionCounts(actor));
      const delivered = /^\/api\/handoffs\/(\d+)$/.exec(pathname);
      if (delivered) return json(res, 200, store.handoffDetail(actor, delivered[1]));
      if (pathname === '/api/client/report') return json(res, 200, store.clientReport(actor, searchParams));
      if (pathname === '/api/client/report.csv') return send(res, 200, store.clientReport(actor, searchParams, true), {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="kampane.csv"',
      });
      const lead = /^\/api\/leads\/(\d+)$/.exec(pathname);
      if (lead) return json(res, 200, store.leadDetail(actor, lead[1]));
      if (pathname === '/api/export/leads.csv') return send(res, 200, store.exportLeads(actor), {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="poptavky.csv"',
      });
      if (pathname === '/api/export/portfolio.csv') return send(res, 200, store.exportPortfolio(actor), {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="portfolio.csv"',
      });
      if (Object.hasOwn(tools, pathname)) {
        if (!['admin', 'marketing'].includes(actor.role)) throw new Failure(403, 'K nástroji nemáte přístup.');
        let body;
        try { body = await readFile(resolve(base, 'tools', tools[pathname])); }
        catch (error) {
          if (error.code === 'ENOENT') throw new Failure(404, 'Propojené nástroje nejsou přiložené.');
          throw error;
        }
        return send(res, 200, body, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "frame-ancestors 'none'" });
      }
    }

    if (req.method === 'POST') {
      if (!sameSecret(req.headers['x-workspace-csrf'], actor.csrf)) throw new Failure(403, 'Obnovte stránku a zkuste akci znovu.');
      const body = await readJson(req);
      const current = store.session(raw);
      if (!current) throw new Failure(401, 'Přihlaste se do pracovního prostoru.');
      if (pathname === '/api/logout') {
        store.signOut(raw);
        return json(res, 200, { ok: true }, { 'Set-Cookie': setCookie('', 0) });
      }
      if (pathname === '/api/password') {
        limit(req, res);
        return json(res, 200, { ok: true }, { 'Set-Cookie': setCookie(store.changePassword(current, body)) });
      }
      if (pathname === '/api/actions/sync-google-ads') {
        const plan = store.googleAds.plan(current, body);
        if (!googleAds) throw new Failure(503, 'Google Ads čeká na konfiguraci serveru.');
        const snapshot = await googleAds.read(plan, body.scenario);
        const authorized = store.session(raw);
        if (!authorized) throw new Failure(401, 'Přihlaste se do pracovního prostoru.');
        return json(res, 200, store.googleAds.apply(authorized, plan, snapshot));
      }
      const action = /^\/api\/actions\/([a-z-]+)$/.exec(pathname);
      if (action) return json(res, 200, store.command(current, action[1], body));
    }
    throw new Failure(404, 'Cesta nebyla nalezena.');
  }

  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    handler(req, res).catch((error) => {
      if (res.headersSent) return res.destroy();
      if (error instanceof Failure) return json(res, error.status, { error: error.message });
      log(error);
      return json(res, 500, { error: 'Akci se nepodařilo dokončit.' });
    });
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes('--demo');
  const config = configuration(demo);
  const { store, profiles } = demo ? (await import('./demo.mjs')).createExample((options) => openStore(':memory:', options), token)
    : { store: openStore(databaseFile()), profiles: null };
  const googleAds = demo ? { mode: 'demo', read: (await import('./google-ads-example.mjs')).exampleAdsSnapshot } : googleAdsProvider();
  const server = createWorkspaceServer(store, { origin: config.origin, profiles, googleAds });
  server.listen(config.port, '127.0.0.1', () => console.log(config.origin));
  const stop = () => server.close(() => store.close());
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
