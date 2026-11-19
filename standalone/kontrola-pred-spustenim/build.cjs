'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fontStyles } = require('./font-styles.cjs');
const production = process.argv.includes('--production');
if (production && process.argv.includes('--pages')) throw new Error('Choose --production or --pages.');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8').replaceAll('\r\n', '\n');
const fonts = fontStyles(path.join(__dirname, 'assets'));
const license = `<!--\n${read('NOTICE').trimEnd()}\n\n${read('LICENSE').trimEnd()}\n-->`;
const css = [fonts.rules, read('workspace.css'), read('launch.css'), read('shell.css')].join('\n');
const js = [...(production ? [] : ['demo-handoff.js', 'launch-fixtures.js']), 'shell.js', 'links.js', 'launch-ui.js'].map(read).join('\n');
const hash = createHash('sha256').update(js).digest('base64');
const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
const template = read('index.html');
const output = template
  .replace('<!-- security -->', `<meta http-equiv="Content-Security-Policy" content="${policy}">`)
  .replace('<!-- styles -->', () => `${license}\n${fonts.license}\n<style>${css}</style>`)
  .replace('<!-- scripts -->', () => `<script>${js}</script>`);
const dist = path.join(__dirname, production ? 'dist-production' : process.argv.includes('--pages') ? 'docs' : 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), output);
