import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const require = createRequire(import.meta.url);
const sqliteDist = dirname(require.resolve('sql.js'));
await mkdir(dist, { recursive: true });
await cp(join(root, 'public'), dist, { recursive: true });
await cp(join(root, 'tools'), join(dist, 'tools'), { recursive: true });

const indexPath = join(dist, 'index.html');
const index = await readFile(indexPath, 'utf8');
await writeFile(indexPath, index.replace('<head>', '<head>\n  <meta name="workspace-mode" content="browser">'));

await build({
  absWorkingDir: root,
  entryPoints: ['online/workspace-worker.mjs'],
  outfile: join(dist, 'workspace-worker.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  legalComments: 'linked',
  loader: { '.sql': 'text' },
});
await copyFile(join(sqliteDist, 'sql-wasm-browser.wasm'), join(dist, 'workspace-sql.wasm'));
await copyFile(join(sqliteDist, '..', 'LICENSE'), join(dist, 'SQL-JS-LICENSE.txt'));
await copyFile(join(root, 'node_modules', '@noble', 'hashes', 'LICENSE'), join(dist, 'NOBLE-HASHES-LICENSE.txt'));
await copyFile(join(root, 'LICENSE'), join(dist, 'LICENSE.txt'));
await copyFile(join(root, 'NOTICE'), join(dist, 'NOTICE.txt'));
