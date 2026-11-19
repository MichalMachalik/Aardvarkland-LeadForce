import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = resolve(dist, '.' + pathname);
    if (!file.startsWith(dist + sep)) throw new Error('Invalid path.');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await once(server.listen(0, '127.0.0.1'), 'listening');
const origin = 'http://127.0.0.1:' + server.address().port + '/';
const browserEnv = { ...process.env };
for (const key of ['TEST_URL', 'FEEDBACK_ONLY', 'AUDIT_TEST_URL', 'LAUNCH_TEST_URL', 'PORTAL_TEST_URL', 'SCREENSHOTS']) delete browserEnv[key];
const jobs = [
  ['test/browser.cjs', {}],
  ['test/browser.cjs', { TEST_URL: origin }],
  ['standalone/audit-kampani/browser.test.cjs', { AUDIT_TEST_URL: origin + 'audit-kampani/' }],
  ['standalone/kontrola-pred-spustenim/browser.test.cjs', { LAUNCH_TEST_URL: origin + 'kontrola-pred-spustenim/' }],
  ['standalone/portal-investora/browser.test.cjs', { PORTAL_TEST_URL: origin + 'portal-investora/' }],
  ['test/standalone-handoff.cjs', { TEST_URL: origin }],
];
try {
  for (const [file, options] of jobs) {
    const [code] = await once(spawn(process.execPath, [file], { cwd: root, env: { ...browserEnv, ...options }, stdio: 'inherit' }), 'exit');
    if (code !== 0) throw new Error('Ověření selhalo: ' + file);
  }
} finally {
  await new Promise((done) => server.close(done));
}
