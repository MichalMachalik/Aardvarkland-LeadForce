import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { databaseFile } from './config.mjs';
import { openStore } from './store.mjs';

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Spusťte nastavení v interaktivním terminálu.');
let quiet = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!quiet) process.stdout.write(chunk, encoding);
    callback();
  },
});
const prompt = createInterface({ input: process.stdin, output, terminal: true });
let store;
try {
  console.log('Založení organizace');
  const slug = await prompt.question('Identifikátor organizace: ');
  const workspace = await prompt.question('Název organizace: ');
  const name = await prompt.question('Jméno správce: ');
  const email = await prompt.question('E-mail správce: ');
  process.stdout.write('Heslo správce (nejméně 12 znaků): ');
  quiet = true;
  const password = await prompt.question('');
  quiet = false;
  console.log('');
  store = openStore(databaseFile());
  const result = store.bootstrap({ slug, workspace, name, email, password });
  console.log('Organizace ' + result.slug + ' je připravená. Spusťte npm start.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  quiet = false;
  prompt.close();
  store?.close();
}
