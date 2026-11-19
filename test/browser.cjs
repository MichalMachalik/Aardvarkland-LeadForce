'use strict';

const { once } = require('node:events');
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { readFile } = require('node:fs/promises');
const playwright = require('playwright');

const btn = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const goto = (page, name) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
const titled = (page, name) => page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
const set = async (page, values) => {
  for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(value);
};

async function openCase(demo, callback) {
  const { createWorkspaceServer } = await import('../server.mjs');
  const { openStore } = await import('../store.mjs');
  const { populateExample } = await import('../demo.mjs');
  const { token } = await import('../security.mjs');
  const probe = createServer();
  await once(probe.listen(0, '127.0.0.1'), 'listening');
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const origin = 'http://127.0.0.1:' + port;
  const store = openStore(':memory:');
  const errors = [];
  const profiles = demo ? populateExample(store, token) : null;
  if (!demo) store.bootstrap({
    workspace: 'Prázdná organizace', slug: 'prazdna', name: 'Správce testu',
    email: 'spravce@test.example', password: 'Testovaci_heslo_2026',
  });
  const server = createWorkspaceServer(store, { origin, profiles, log: (error) => errors.push(error.message) });
  await once(server.listen(port, '127.0.0.1'), 'listening');
  try {
    await exerciseBrowser(origin, errors, callback);
  } finally {
    await new Promise((done) => server.close(done));
    store.close();
  }
}

async function exerciseBrowser(origin, errors, callback, publicDemo = false) {
  const engine = process.env.TEST_ENGINE || 'chromium';
  const browser = await playwright[engine].launch({ executablePath: process.env.CHROME_PATH });
  const contexts = [];
  const newContext = async () => {
    const context = await browser.newContext();
    context.on('request', (request) => {
      if (!request.url().startsWith(new URL(origin).origin + '/') && !request.url().startsWith('blob:')) errors.push('External request ' + request.url());
    });
    context.on('weberror', (error) => errors.push(error.error().message));
    contexts.push(context);
    return context;
  };
  const shared = publicDemo ? await newContext() : null;
  async function page(width = 1366, isolated = false) {
    const context = !isolated && shared ? shared : await newContext();
    const tab = await context.newPage();
    await tab.setViewportSize({ width, height: 850 });
    tab.setDefaultTimeout(10000);
    await tab.goto(origin);
    await titled(tab, 'Přihlášení do pracovního prostoru');
    assert.equal(await tab.locator('.login-brand img').evaluate((img) => img.complete && img.naturalWidth > 0), true);
    return tab;
  }
  try {
    await callback({ page, origin });
    assert.deepEqual(errors, []);
  } catch (error) {
    for (const context of contexts) for (const tab of context.pages()) {
      console.error(new URL(tab.url()).hash, (await tab.locator('h1').allTextContents()).join(' · '),
        (await tab.locator('#notice').allTextContents()).join(' '), (await tab.locator('select').evaluateAll((items) =>
          items.map((item) => [item.name, [...item.options].map((option) => option.textContent)]))));
    }
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
  }
}

async function demo({ page }) {
  const marketing = await page();
  await btn(marketing, /^Marketing ·/).click();
  await titled(marketing, 'Přehled týmu');
  const [file] = await Promise.all([
    marketing.waitForEvent('download'),
    marketing.getByRole('link', { name: 'Export poptávek CSV' }).click({ noWaitAfter: true }),
  ]);
  const csv = await readFile(await file.path(), 'utf8');
  assert.match(csv, /"handed_off_date"/);
  assert.doesNotMatch(csv, /@javorova|@kontakty/);
  const [audit] = await Promise.all([
    marketing.context().waitForEvent('page'),
    marketing.getByRole('link', { name: 'Audit kampaní' }).click(),
  ]);
  await titled(audit, 'Přehled kampaní');
  assert.match(await audit.locator('#data-scope').textContent(), /bez záznamů/);
  await audit.close();
  await goto(marketing, 'Poptávky');
  await titled(marketing, 'Poptávky');
  await set(marketing, { Jméno: 'Karolína Procházková', 'E-mail': 'karolina@test.example', Projekt: 'Habr 2', Kanál: 'Meta', 'ID kampaně': 'M-222' });
  await btn(marketing, 'Přidat poptávku').click();
  await marketing.getByText('Meta · M-222', { exact: true }).waitFor();
  assert.equal(await marketing.getByText('Karolína Procházková', { exact: true }).count(), 0);

  const agent = await page();
  await btn(agent, /^Kvalifikace ·/).click();
  await titled(agent, 'Přehled týmu');
  await goto(agent, 'Poptávky');
  await agent.getByRole('link', { name: 'Karolína Procházková' }).click();
  await titled(agent, 'Karolína Procházková');
  await btn(agent, 'Převzít poptávku').click();
  await btn(agent, 'Označit jako kontaktovanou').click();
  await agent.getByText('Kontaktována', { exact: true }).waitFor();
  await set(agent, { 'Interní poznámka': 'Předání domluveno na dopoledne.' });
  await agent.getByLabel('Upozornit kolegu').selectOption({ label: 'Adéla Novotná' });
  await btn(agent, 'Přidat poznámku').click();
  await agent.getByText('Předání domluveno na dopoledne.', { exact: true }).waitFor();
  await btn(agent, 'Kvalifikovat').click();
  await agent.getByText('Kvalifikovaná', { exact: true }).waitFor();

  const admin = await page();
  await btn(admin, /^Správce ·/).click();
  await titled(admin, 'Přehled týmu');
  await goto(admin, 'Upozornění');
  const notification = admin.getByRole('row', { name: /Interní poznámka.*Habr 2/ });
  await notification.getByRole('button', { name: 'Označit jako přečtené' }).click();
  await notification.getByText('Přečtené', { exact: true }).waitFor();
  await notification.getByRole('link', { name: 'Habr 2', exact: true }).click();
  await admin.getByText('Předání domluveno na dopoledne.', { exact: true }).waitFor();

  const care = await page();
  await btn(care, /^Péče ·/).click();
  await titled(care, 'Přehled týmu');
  await goto(care, 'Poptávky');
  await care.getByRole('link', { name: 'Karolína Procházková' }).click();
  await titled(care, 'Karolína Procházková');
  await care.getByText('Předání domluveno na dopoledne.', { exact: true }).waitFor();
  await btn(care, 'Převzít poptávku').click();
  await btn(care, 'Předat klientovi').click();
  await care.getByText('Předaná', { exact: true }).waitFor();
  await btn(care, 'Připojit účet investora').click();
  const invite = await care.getByLabel('Odkaz pozvánky').inputValue();
  const newInvestor = await page();
  await newInvestor.goto(invite);
  await titled(newInvestor, 'Přijmout pozvánku');
  await set(newInvestor, { Jméno: 'Karolína Procházková', 'Nové heslo': 'Beruska_Testovaci_2026' });
  await btn(newInvestor, 'Založit účet').click();
  await titled(newInvestor, 'Přehled investora');
  await goto(newInvestor, 'Portfolio');
  await newInvestor.getByText('Zatím žádné pozice.').waitFor();
  await care.reload();
  await care.getByText('Propojený', { exact: true }).waitFor();
  await set(care, { 'Úkol': 'Domluvit schůzku', Termín: '2026-12-18' });
  await btn(care, 'Přidat úkol').click();
  await care.getByText('Změna uložena.', { exact: true }).waitFor();
  await goto(care, 'Úkoly');
  await care.getByRole('row', { name: /Domluvit schůzku/ }).getByRole('button', { name: 'Dokončit' }).click();
  await care.getByRole('row', { name: /Domluvit schůzku.*Hotovo/ }).waitFor();

  await goto(care, 'Investoři');
  await titled(care, 'Pozice investorů');
  await care.getByLabel('Investor', { exact: true }).selectOption({ label: 'Karolína Procházková · karolina@test.example' });
  await set(care, { Projekt: 'Habr 2', 'Kapitál v Kč': '1250,50', Splatnost: '2028-09-30' });
  await btn(care, 'Uložit pozici').click();
  await care.getByRole('row', { name: /Habr 2.*Karolína/ }).waitFor();
  await goto(care, 'Zprávy pro investory');
  await titled(care, 'Zprávy pro investory');
  await care.getByLabel('Investor', { exact: true }).selectOption({ label: 'Karolína Procházková · karolina@test.example' });
  await set(care, { Předmět: 'Přehled Habr 2', Zpráva: 'Připravili jsme aktualizaci k projektu.' });
  await btn(care, 'Uložit koncept').click();
  await care.getByRole('row', { name: /Přehled Habr 2.*Koncept/ }).waitFor();
  await newInvestor.reload();
  await newInvestor.getByRole('row', { name: /Habr 2/ }).waitFor();
  assert.equal(await newInvestor.getByText('Park Habr', { exact: true }).count(), 0);
  await goto(newInvestor, 'Zprávy');
  await newInvestor.getByText('Zatím žádné zprávy.').waitFor();
  care.once('dialog', (dialog) => dialog.accept());
  await care.getByRole('row', { name: /Přehled Habr 2/ }).getByRole('button', { name: 'Zveřejnit' }).click();
  await care.getByRole('row', { name: /Přehled Habr 2.*Nepřečtená/ }).waitFor();
  await newInvestor.reload();
  await btn(newInvestor, 'Přehled Habr 2').click();
  await newInvestor.getByRole('dialog').getByText('Připravili jsme aktualizaci k projektu.').waitFor();
  await btn(newInvestor, 'Zavřít').click();
  await newInvestor.getByRole('row', { name: /Přehled Habr 2.*Přečtená/ }).waitFor();
  assert.equal(await newInvestor.getByText('Předání domluveno na dopoledne.').count(), 0);
  assert.equal(await newInvestor.getByRole('link', { name: 'Upozornění' }).count(), 0);

  const mobile = await page(320);
  await btn(mobile, /^Investor ·/).click();
  await titled(mobile, 'Přehled investora');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await btn(mobile, 'Navigace').click();
  await goto(mobile, 'Zprávy');
  await titled(mobile, 'Moje zprávy');
  assert.equal(await mobile.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  await btn(mobile, 'Podzimní přehled projektu').click();
  await mobile.getByRole('dialog').waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

async function blank({ page }) {
  const admin = await page();
  assert.equal(await btn(admin, /^Správce ·/).count(), 0);
  await set(admin, { Organizace: 'prazdna', 'E-mail': 'spravce@test.example', Heslo: 'Testovaci_heslo_2026' });
  await btn(admin, 'Přihlásit se').click();
  await titled(admin, 'Přehled týmu');
  assert.deepEqual(await admin.locator('.metric dd').allTextContents(), ['0', '0', '0', '0', '0']);
  await goto(admin, 'Uživatelé');
  await titled(admin, 'Uživatelé');
  assert.equal(await admin.locator('tbody tr').count(), 1);
  await btn(admin, 'Odhlásit').click();
  await titled(admin, 'Přihlášení do pracovního prostoru');
}

async function published(context) {
  await demo(context);
  const isolated = await context.page(1366, true);
  await btn(isolated, /^Správce ·/).click();
  await goto(isolated, 'Poptávky');
  await titled(isolated, 'Poptávky');
  assert.equal(await isolated.getByText('Karolína Procházková', { exact: true }).count(), 0);

  const [second] = await Promise.all([
    isolated.context().waitForEvent('page'),
    goto(isolated, 'Otevřít další roli'),
  ]);
  await titled(second, 'Přihlášení do pracovního prostoru');
  await btn(second, /^Marketing ·/).click();
  await titled(second, 'Přehled týmu');
  assert.equal(await isolated.getByRole('link', { name: 'Uživatelé', exact: true }).count(), 1);

  const reset = await context.page();
  reset.once('dialog', (dialog) => dialog.accept());
  await btn(reset, 'Obnovit výchozí data').click();
  await reset.getByText('Ukázka byla obnovena.', { exact: true }).waitFor();
  await btn(reset, /^Správce ·/).click();
  await goto(reset, 'Poptávky');
  await titled(reset, 'Poptávky');
  assert.equal(await reset.getByText('Karolína Procházková', { exact: true }).count(), 0);
}

const check = process.env.TEST_URL
  ? exerciseBrowser(process.env.TEST_URL, [], published, true)
  : openCase(true, demo).then(() => openCase(false, blank));
check.then(() => {
  console.log('PASS workspace browser: roles, queue, notes, handoff and invite, tasks, portfolio, draft/publication/receipt and empty production login');
}).catch((error) => { console.error(error); process.exitCode = 1; });
