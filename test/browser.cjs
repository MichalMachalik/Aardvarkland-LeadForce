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
  const { createExample } = await import('../demo.mjs');
  const { exampleAdsSnapshot } = await import('../google-ads-example.mjs');
  const { token } = await import('../security.mjs');
  const probe = createServer();
  await once(probe.listen(0, '127.0.0.1'), 'listening');
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const origin = 'http://127.0.0.1:' + port;
  const errors = [];
  const { store, profiles } = demo ? createExample((options) => openStore(':memory:', options), token)
    : { store: openStore(':memory:'), profiles: null };
  if (!demo) store.bootstrap({
    workspace: 'Prázdná organizace', slug: 'prazdna', name: 'Správce testu',
    email: 'spravce@test.example', password: 'Testovaci_heslo_2026',
  });
  const googleAds = demo ? { mode: 'demo', read: exampleAdsSnapshot } : null;
  const server = createWorkspaceServer(store, { origin, profiles, googleAds, log: (error) => errors.push(error.message) });
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
  await set(marketing, { Jméno: 'Karolína Procházková', 'E-mail': 'karolina-omyl@test.example', Projekt: 'Habr 2', Kanál: 'Meta', 'ID kampaně': 'M-222' });
  await btn(marketing, 'Přidat poptávku').click();
  await marketing.getByText('Meta · M-222', { exact: true }).waitFor();
  assert.equal(await marketing.getByText('Karolína Procházková', { exact: true }).count(), 0);

  const agent = await page();
  await btn(agent, /^Kvalifikace ·/).click();
  await titled(agent, 'Přehled týmu');
  await goto(agent, 'Poptávky');
  await agent.getByLabel('Hledat poptávku').fill('karolina prochazkova');
  await agent.getByRole('link', { name: 'Karolína Procházková' }).click();
  await titled(agent, 'Karolína Procházková');
  await btn(agent, 'Převzít poptávku').click();
  await agent.getByText('Upravit kontakt', { exact: true }).click();
  await set(agent, { 'E-mail kontaktu': 'karolina@test.example' });
  await btn(agent, 'Uložit kontakt').click();
  await agent.getByText('Kontakt byl opraven.').waitFor();
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
  await btn(care, 'Péče · Klára Dvořáková').click();
  await titled(care, 'Přehled týmu');
  await goto(care, 'Poptávky');
  await care.getByRole('link', { name: 'Karolína Procházková' }).click();
  await titled(care, 'Karolína Procházková');
  await care.getByText('Předání domluveno na dopoledne.', { exact: true }).waitFor();
  await btn(care, 'Převzít poptávku').click();
  assert.equal(await btn(care, 'Předat klientovi').count(), 0);
  await btn(care, 'Zaznamenat předání mimo LeadForce').click();
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
  await care.getByRole('row', { name: /Domluvit schůzku/ }).getByRole('button', { name: 'Upravit úkol' }).click();
  await set(care, { 'Název úkolu': 'Potvrdit schůzku', 'Termín úkolu': '2026-12-19' });
  await btn(care, 'Uložit úkol').click();
  const task = care.getByRole('row').filter({ hasText: 'Potvrdit schůzku' });
  await task.getByRole('button', { name: 'Dokončit', exact: true }).click();
  await task.getByRole('button', { name: 'Znovu otevřít', exact: true }).click();
  await task.getByRole('button', { name: 'Dokončit', exact: true }).waitFor();

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
  const draft = care.getByRole('row', { name: /Přehled Habr 2.*Koncept/ });
  await draft.getByRole('button', { name: 'Upravit koncept' }).click();
  await set(care.getByRole('dialog'), { Zpráva: 'Připravili jsme aktualizaci k projektu na pátek.' });
  await btn(care, 'Uložit změny konceptu').click();
  await care.getByText('Koncept byl upraven.').waitFor();
  await newInvestor.reload();
  await newInvestor.getByRole('row', { name: /Habr 2/ }).waitFor();
  await newInvestor.getByRole('columnheader', { name: 'Investovaná částka', exact: true }).waitFor();
  const [portfolio] = await Promise.all([
    newInvestor.waitForEvent('download'),
    newInvestor.getByRole('link', { name: 'Stáhnout portfolio CSV' }).click(),
  ]);
  assert.match(await readFile(await portfolio.path(), 'utf8'), /"Habr 2";"1250,50";"2028-09-30"/);
  assert.equal(await newInvestor.getByText('Park Habr', { exact: true }).count(), 0);
  await goto(newInvestor, 'Zprávy');
  await newInvestor.getByText('Zatím žádné zprávy.').waitFor();
  care.once('dialog', (dialog) => dialog.accept());
  await care.getByRole('row', { name: /Přehled Habr 2/ }).getByRole('button', { name: 'Zveřejnit' }).click();
  await care.getByRole('row', { name: /Přehled Habr 2.*Nepřečtená/ }).waitFor();
  await newInvestor.reload();
  await btn(newInvestor, 'Přehled Habr 2').click();
  await newInvestor.getByRole('dialog').getByText('Připravili jsme aktualizaci k projektu na pátek.').waitFor();
  await set(newInvestor.getByRole('dialog'), { Odpověď: 'Děkuji, pátek mi vyhovuje.' });
  await btn(newInvestor, 'Odeslat odpověď').click();
  await newInvestor.getByRole('dialog').getByText('Děkuji, pátek mi vyhovuje.').waitFor();
  await btn(newInvestor, 'Zavřít').click();
  await newInvestor.getByRole('row', { name: /Přehled Habr 2.*Přečtená/ }).waitFor();
  await care.reload();
  await care.getByText('Nové odpovědi · 1', { exact: true }).waitFor();
  await btn(care, 'Přehled Habr 2').click();
  await care.getByRole('dialog').getByText('Děkuji, pátek mi vyhovuje.').waitFor();
  await btn(care, 'Zavřít').click();
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
  await goto(admin, 'Klienti a kampaně');
  await titled(admin, 'Klienti a kampaně');
  await admin.getByText('Zatím žádní klienti.').waitFor();
  await admin.getByText('Zatím žádné klientské kampaně.').waitFor();
  assert.equal(await btn(admin, 'Uložit denní náklad').count(), 0);
  await goto(admin, 'Předání klientům');
  await titled(admin, 'Předání klientům');
  assert.deepEqual(await admin.locator('.metric dd').allTextContents(), ['0', '0', '0']);
  await admin.getByText('V tomto přehledu zatím nejsou žádné předané poptávky.').waitFor();
  await goto(admin, 'Uživatelé');
  await titled(admin, 'Uživatelé');
  assert.equal(await admin.locator('tbody tr').count(), 1);
  await btn(admin, 'Odhlásit').click();
  await titled(admin, 'Přihlášení do pracovního prostoru');
}

async function clientPortal({ page }) {
  const client = await page(320);
  await btn(client, /^Klient ·/).click();
  await titled(client, 'Klientský přehled');
  await client.getByText('Zuzana Šedá', { exact: true }).waitFor();
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await client.getByText('Ateliéry u Řeky', { exact: true }).count(), 0);
  assert.equal(await client.getByText('David Koutný', { exact: true }).count(), 0);
  assert.equal(await client.getByText('Petr Skála', { exact: true }).count(), 0);
  await client.getByLabel('Kampaň', { exact: true }).selectOption({ label: 'Byty pod Lípou · LPF-601' });
  await btn(client, 'Použít filtry').click();
  await client.waitForFunction(() => document.querySelector('.client-metrics dd').textContent === '2');
  assert.deepEqual((await client.locator('.client-metrics dd').allTextContents()).map((text) => text.replace(/\s/g, '')), ['2', '1890Kč', '945Kč']);
  assert.equal(await client.getByText('Hana Vítová', { exact: true }).count(), 0);
  const [file] = await Promise.all([
    client.waitForEvent('download'),
    client.getByRole('link', { name: 'Stáhnout report CSV' }).click(),
  ]);
  const csv = await readFile(await file.path(), 'utf8');
  assert.match(csv, /"1890,00";"2";"945,00"/);
  assert.doesNotMatch(csv, /LPF-602|LPF-699|@leadforce/);
  await set(client, { Od: '2020-02-01', Do: '2020-02-02' });
  await btn(client, 'Použít filtry').click();
  await client.getByText('Ve zvoleném období nebyla předána žádná poptávka.').waitFor();
  await client.getByText('Bez evidence', { exact: true }).waitFor();

  const admin = await page();
  await btn(admin, /^Správce ·/).click();
  await titled(admin, 'Přehled týmu');
  await goto(admin, 'Klienti a kampaně');
  await titled(admin, 'Klienti a kampaně');
  await admin.getByRole('row', { name: /Byty pod Lípou · LPF-601/ }).getByRole('button', { name: 'Upravit' }).click();
  assert.equal(await admin.getByLabel('Náklad v Kč').inputValue(), '1890,00');
  await set(admin, { 'Náklad v Kč': '2100' });
  await btn(admin, 'Uložit denní náklad').click();
  await admin.getByText('Denní náklad uložen.').waitFor();
  await goto(admin, 'Poptávky');
  await titled(admin, 'Poptávky');
  await set(admin, { Jméno: 'Erik Zelený', 'E-mail': 'erik@qa.example' });
  await admin.getByLabel('Klientská kampaň').selectOption({ label: 'Byty pod Lípou · LPF-601 · Lípové bydlení' });
  await btn(admin, 'Přidat poptávku').click();
  await admin.getByRole('link', { name: 'Erik Zelený', exact: true }).waitFor();
  await client.reload();
  await titled(client, 'Klientský přehled');
  assert.equal(await client.getByText('Erik Zelený', { exact: true }).count(), 0);

  await admin.getByRole('link', { name: 'Erik Zelený', exact: true }).click();
  await titled(admin, 'Erik Zelený');
  await btn(admin, 'Označit jako kontaktovanou').click();
  await admin.getByText('Kontaktována', { exact: true }).waitFor();
  await btn(admin, 'Kvalifikovat').click();
  await admin.getByText('Kvalifikovaná', { exact: true }).waitFor();
  await admin.getByLabel('Odpovídá').selectOption({ label: 'Klára Dvořáková' });
  await btn(admin, 'Přiřadit').click();
  await admin.locator('.detail-grid dd').filter({ hasText: /^Klára Dvořáková$/ }).waitFor();
  await btn(admin, 'Předat klientovi').click();
  await admin.getByText('Předaná', { exact: true }).waitFor();
  await client.reload();
  await client.getByText('Erik Zelený', { exact: true }).waitFor();
  await client.getByRole('row', { name: /Byty pod Lípou LPF-601.*700/ }).waitFor();

  await goto(admin, 'Uživatelé');
  await titled(admin, 'Uživatelé');
  await set(admin, { 'E-mail': 'druhy-klient@qa.example' });
  await admin.getByLabel('Role', { exact: true }).selectOption({ label: 'Klient' });
  await admin.getByLabel('Klient', { exact: true }).selectOption({ label: 'Modřínová výstavba' });
  await btn(admin, 'Vytvořit pozvánku').click();
  const invite = await admin.getByLabel('Odkaz pozvánky').inputValue();
  const another = await page();
  await another.goto(invite);
  await titled(another, 'Přijmout pozvánku');
  await set(another, { Jméno: 'Jiný klient', 'Nové heslo': 'Testovaci_heslo_2026' });
  await btn(another, 'Založit účet').click();
  await titled(another, 'Klientský přehled');
  await another.getByText('David Koutný', { exact: true }).waitFor();
  assert.equal(await another.getByText('Erik Zelený', { exact: true }).count(), 0);

  await btn(client, 'Navigace').click();
  await goto(client, 'Měsíční uzávěrky');
  await titled(client, 'Měsíční uzávěrky');
  const reference = client.getByRole('link', { name: /^\d{4}-\d{2}$/ });
  const month = (await reference.textContent()).trim();
  await reference.click();
  await titled(client, month + ' · v1');
  assert.equal((await client.locator('.metric dd').nth(1).textContent()).replace(/\s/g, ''), '1250Kč');
  const [original] = await Promise.all([
    client.waitForEvent('download'),
    client.getByRole('link', { name: 'Stáhnout uzávěrku CSV' }).click(),
  ]);
  assert.match(await readFile(await original.path(), 'utf8'), /"1250,00"/);
  await goto(admin, 'Klienti a kampaně');
  await admin.getByLabel('Kampaň', { exact: true }).selectOption({ label: 'Brandová kampaň · LPF-603 · Lípové bydlení' });
  await set(admin, { 'Datum nákladu': month + '-01', 'Náklad v Kč': '1300' });
  await btn(admin, 'Uložit denní náklad').click();
  await admin.getByText('Denní náklad uložen.').waitFor();
  await goto(admin, 'Měsíční uzávěrky');
  await titled(admin, 'Měsíční uzávěrky');
  await admin.getByRole('combobox', { name: 'Klient', exact: true }).selectOption({ label: 'Lípové bydlení' });
  await set(admin, { Měsíc: month });
  await btn(admin, 'Načíst podklady').click();
  await set(admin, { 'Důvod nové verze': 'Upřesnění nákladů kampaně.' });
  await btn(admin, 'Zveřejnit uzávěrku').click();
  await admin.getByText('Uzávěrka byla zveřejněna.').waitFor();
  await client.reload();
  await titled(client, month + ' · v1');
  assert.equal((await client.locator('.metric dd').nth(1).textContent()).replace(/\s/g, ''), '1250Kč');
  await client.getByRole('link', { name: 'Zpět k uzávěrkám' }).click();
  await client.getByRole('row', { name: /v2/ }).getByRole('link', { name: month }).click();
  await titled(client, month + ' · v2');
  assert.equal((await client.locator('.metric dd').nth(1).textContent()).replace(/\s/g, ''), '1300Kč');
}

async function accessWorkflow({ page }) {
  const admin = await page();
  await btn(admin, /^Správce ·/).click();
  await goto(admin, 'Uživatelé');
  await titled(admin, 'Uživatelé');
  await set(admin, { 'E-mail': 'pozvanka@qa.example' });
  await admin.getByLabel('Role', { exact: true }).selectOption('marketing');
  await btn(admin, 'Vytvořit pozvánku').click();
  const old = await admin.getByLabel('Odkaz pozvánky').inputValue();
  admin.once('dialog', (dialog) => dialog.accept());
  await btn(admin, 'Zrušit pozvánku').click();
  await admin.getByText('Pozvánka byla zrušena.').waitFor();
  const rejected = await page();
  await rejected.goto(old);
  await set(rejected, { Jméno: 'Fiktivní test', 'Nové heslo': 'Fiktivni-Overeni-2026!' });
  await btn(rejected, 'Založit účet').click();
  await rejected.getByText('Pozvánka vypršela nebo již byla použita.').waitFor();
  const existing = await page();
  await btn(existing, /^Marketing ·/).click();
  await titled(existing, 'Přehled týmu');
  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('row', { name: /Nina Vacková/ }).getByRole('button', { name: 'Obnovit heslo' }).click();
  const recovery = await admin.getByLabel('Odkaz pro obnovu hesla').inputValue();
  await rejected.goto(recovery);
  await titled(rejected, 'Obnova hesla');
  await set(rejected, { 'Nové heslo': 'Fiktivni-Obnovene-2026!' });
  await btn(rejected, 'Nastavit nové heslo').click();
  await titled(rejected, 'Přehled týmu');
  await existing.reload();
  await titled(existing, 'Přihlášení do pracovního prostoru');
}

async function published(context) {
  await demo(context);
  await clientPortal(context);
  await googleAdsPilot(context);
  await claimWorkflows(context);
  await accessWorkflow(context);
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

async function googleAdsPilot({ page }) {
  const editor = await page();
  await btn(editor, /^Marketing ·/).click();
  await titled(editor, 'Přehled týmu');
  await goto(editor, 'Klienti a kampaně');
  await editor.getByRole('heading', { name: 'Import Google Ads' }).waitFor();
  const importFrom = await editor.getByLabel('Import od').inputValue();
  const importTo = await editor.getByLabel('Import do').inputValue();
  await editor.getByRole('combobox', { name: 'Kampaň', exact: true }).selectOption({ label: 'Byty pod Lípou · LPF-601 · Lípové bydlení' });
  await set(editor, { 'Náklad v Kč': '2100' });
  await btn(editor, 'Uložit denní náklad').click();
  await editor.getByText('Denní náklad uložen.').waitFor();
  await set(editor, { 'Import od': importFrom, 'Import do': importTo });
  const panel = editor.getByRole('region', { name: 'Výsledek importu Byty pod Lípou' });
  const sync = async (scenario, expected) => {
    await editor.getByLabel('Scénář zdroje').selectOption(scenario);
    await btn(editor, 'Synchronizovat náklady').click();
    await editor.getByText('Synchronizace dokončena.', { exact: true }).waitFor();
    assert.deepEqual(await panel.locator('.sync-counts li').allTextContents(), expected);
  };
  await sync('gap', ['Nové 2', 'Opravené 0', 'Beze změny 0', 'Potvrzená nula 1', 'Chybějící dny 1']);
  await sync('gap', ['Nové 0', 'Opravené 0', 'Beze změny 2', 'Potvrzená nula 1', 'Chybějící dny 1']);
  const client = await page(320);
  await btn(client, /^Klient ·/).click();
  await titled(client, 'Klientský přehled');
  const row = client.getByRole('row', { name: /Byty pod Lípou LPF-601/ });
  await row.getByText('Chybějící dny Google Ads 1', { exact: true }).waitFor();
  assert.equal(await row.getByRole('cell').nth(2).textContent().then((v) => v.replace(/\s/g, '')), '2550Kč');
  assert.equal(await row.getByRole('cell').nth(4).textContent(), '—');
  assert.equal(await btn(client, 'Synchronizovat náklady').count(), 0);
  await sync('complete', ['Nové 1', 'Opravené 0', 'Beze změny 2', 'Potvrzená nula 1', 'Chybějící dny 0']);
  await sync('correction', ['Nové 0', 'Opravené 1', 'Beze změny 2', 'Potvrzená nula 1', 'Chybějící dny 0']);
  await client.reload();
  await titled(client, 'Klientský přehled');
  assert.equal(await row.getByRole('cell').nth(2).textContent().then((v) => v.replace(/\s/g, '')), '3350Kč');
  assert.equal(await row.getByRole('cell').nth(4).textContent().then((v) => v.replace(/\s/g, '')), '1116,67Kč');
}

async function handoffFeedback({ page }) {
  const name = 'Zuzana Šedá';
  const subject = 'Ověřením jsme našli jiné telefonní číslo.';
  const request = 'Doplňte prosím referenci původního záznamu.';
  const transferNote = 'Martin zastupuje Kláru během dovolené.';
  const reply = 'Pro ukázku doplňuji referenci TEST-1234.';
  const outcome = 'Reklamaci uznáváme. Teď ověříme správný kontakt.';
  const badge = (tab) => tab.locator('#handoff-attention-count');
  const focus = async (tab) => {
    await tab.bringToFront();
    await tab.evaluate(() => window.dispatchEvent(new Event('focus')));
  };
  const client = await page(320);
  await btn(client, /^Klient ·/).click();
  await titled(client, 'Klientský přehled');
  await client.getByRole('link', { name, exact: true }).click();
  await titled(client, name);
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await btn(client, 'Potvrdit převzetí').click();
  await client.getByText('Převzetí bylo potvrzeno.', { exact: true }).waitFor();
  await client.getByText('Potvrzeno', { exact: true }).waitFor();
  assert.equal(await btn(client, 'Potvrdit převzetí').count(), 0);
  await client.getByLabel('Důvod reklamace', { exact: true }).selectOption('other');
  assert.equal(await client.getByLabel('Popis reklamace', { exact: true }).getAttribute('required'), '');
  await client.getByLabel('Důvod reklamace', { exact: true }).selectOption('invalid_contact');
  await client.getByLabel('Popis reklamace', { exact: true }).fill(subject);
  await btn(client, 'Podat reklamaci').click();
  await client.getByText('Reklamace byla podána.', { exact: true }).waitFor();
  await client.getByText('Nová reklamace', { exact: true }).waitFor();
  await client.getByText('Termín týmu', { exact: true }).waitFor();
  assert.equal(await client.getByText('Po lhůtě', { exact: true }).isVisible(), false);
  assert.equal(await btn(client, 'Podat reklamaci').count(), 0);

  const staff = await page();
  await btn(staff, 'Péče · Klára Dvořáková').click();
  await titled(staff, 'Přehled týmu');
  await staff.locator('#handoff-escalations-alert').click();
  await titled(staff, 'Eskalace reklamací');
  const late = staff.getByRole('row', { name: /Hana Vítová/ });
  await late.getByRole('cell', { name: 'Klient', exact: true }).waitFor();
  await late.getByText('Po lhůtě', { exact: true }).waitFor();
  assert.equal(await staff.getByRole('row', { name: /Zuzana Šedá/ }).count(), 0);
  await late.getByRole('link', { name: 'Hana Vítová', exact: true }).click();
  await titled(staff, 'Hana Vítová');
  await staff.getByText('Termín klienta', { exact: true }).waitFor();
  await staff.getByRole('link', { name: 'Zpět k eskalacím', exact: true }).click();
  await titled(staff, 'Eskalace reklamací');
  await goto(staff, 'Přehled');
  await titled(staff, 'Přehled týmu');
  await staff.getByRole('link', { name: /^Otevřené reklamace/ }).click();
  await titled(staff, 'Předání klientům');
  const row = staff.getByRole('row', { name: /Zuzana Šedá/ });
  await row.getByText('Nová reklamace', { exact: true }).waitFor();
  await row.getByText('Potvrzeno', { exact: true }).waitFor();
  await row.getByRole('link', { name, exact: true }).click();
  await titled(staff, name);
  await staff.getByText('Neplatné kontaktní údaje', { exact: true }).waitFor();
  await staff.getByText(subject, { exact: true }).waitFor();
  await staff.getByLabel('Nový řešitel').selectOption({ label: 'Klára Dvořáková · já' });
  await btn(staff, 'Přiřadit reklamaci').click();
  await staff.getByText('Reklamace byla přiřazena.', { exact: true }).waitFor();
  await btn(staff, 'Zahájit řešení').click();
  await staff.getByText('Reklamace je v řešení.', { exact: true }).waitFor();
  await btn(client, 'Obnovit detail').click();
  await client.getByText('V řešení', { exact: true }).waitFor();
  await staff.getByLabel('Požadované podklady', { exact: true }).fill(request);
  await btn(staff, 'Vyžádat podklady').click();
  await staff.getByText('Požadavek je ve vlákně reklamace.', { exact: true }).waitFor();
  await staff.getByText('Čeká na klienta', { exact: true }).waitFor();
  await staff.getByText('Termín klienta', { exact: true }).waitFor();
  await focus(client);
  await client.waitForFunction(() => document.querySelector('#handoff-attention-count')?.textContent === '2');
  await client.getByRole('link', { name: 'Zpět do přehledu', exact: true }).click();
  await titled(client, 'Klientský přehled');
  await client.locator('#handoff-alert').click();
  await titled(client, 'Čeká na vaši odpověď');
  await client.getByRole('link', { name: 'Hana Vítová', exact: true }).waitFor();
  await client.getByRole('link', { name, exact: true }).click();
  await titled(client, name);
  await client.getByText(request, { exact: true }).waitFor();
  await client.getByText('Váš termín', { exact: true }).waitFor();
  const deadline = await client.locator('.claim-deadline time').getAttribute('datetime');
  await client.getByLabel('Doplnění podkladů', { exact: true }).fill(reply);

  const colleague = await page();
  await btn(colleague, 'Péče · Martin Jelínek').click();
  await titled(colleague, 'Přehled týmu');
  await colleague.locator('#handoff-assigned-count').waitFor({ state: 'hidden' });
  await staff.getByLabel('Nový řešitel').selectOption({ label: 'Martin Jelínek' });
  await staff.getByLabel('Důvod předání').fill(transferNote);
  await btn(staff, 'Předat reklamaci').click();
  await staff.getByText('Reklamace byla předána.', { exact: true }).waitFor();
  await titled(staff, 'Předání klientům');
  await focus(colleague);
  await colleague.locator('#handoff-assigned-alert').click();
  await titled(colleague, 'Moje reklamace');
  await colleague.getByRole('link', { name, exact: true }).click();
  await titled(colleague, name);
  await colleague.getByText('Termín klienta', { exact: true }).waitFor();
  assert.equal(await colleague.locator('.claim-deadline time').getAttribute('datetime'), deadline);
  await colleague.getByText('Historie přiřazení', { exact: true }).click();
  await colleague.getByText(transferNote, { exact: true }).waitFor();
  assert.equal(await client.getByText('Historie přiřazení').count(), 0);
  assert.equal(await client.getByLabel('Doplnění podkladů', { exact: true }).inputValue(), reply);
  await colleague.getByLabel('Vyjádření pro klienta', { exact: true }).fill(outcome);

  await btn(client, 'Doplnit podklady').click();
  await client.getByText('Podklady byly doplněny.', { exact: true }).waitFor();
  assert.equal(await badge(client).textContent(), '1');
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await focus(colleague);
  await colleague.waitForFunction(() => document.querySelector('#handoff-attention-count')?.textContent === '1');
  assert.equal(await colleague.getByLabel('Vyjádření pro klienta', { exact: true }).inputValue(), outcome);
  await btn(colleague, 'Obnovit detail').click();
  await colleague.getByText(reply, { exact: true }).waitFor();
  await colleague.getByText('Termín týmu', { exact: true }).waitFor();
  await colleague.getByLabel('Výsledek reklamace', { exact: true }).selectOption('accepted');
  await colleague.getByLabel('Vyjádření pro klienta', { exact: true }).fill(outcome);
  await btn(colleague, 'Uložit rozhodnutí').click();
  await colleague.getByText('Rozhodnutí bylo uloženo.', { exact: true }).waitFor();

  await btn(client, 'Obnovit detail').click();
  await client.getByText('Uznaná', { exact: true }).waitFor();
  await client.getByText(outcome, { exact: true }).waitFor();
  await client.getByText(reply, { exact: true }).waitFor();
  assert.equal(await client.getByText('Termín týmu', { exact: true }).count(), 0);
  await client.getByRole('link', { name: 'Zpět k upozorněním', exact: true }).click();
  await titled(client, 'Čeká na vaši odpověď');
  assert.equal(await client.getByRole('link', { name, exact: true }).count(), 0);
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await colleague.getByRole('link', { name: 'Zpět k mým reklamacím', exact: true }).click();
  await titled(colleague, 'Moje reklamace');
  await colleague.getByText('Nemáte přiřazenou žádnou otevřenou reklamaci.', { exact: true }).waitFor();
  await btn(staff, 'Obnovit seznam').click();
  await titled(staff, 'Předání klientům');
  await row.waitFor({ state: 'hidden' });
  await staff.getByLabel('Stav předání', { exact: true }).selectOption('closed');
  await btn(staff, 'Použít filtr').click();
  await row.getByText('Uznaná', { exact: true }).waitFor();

  await client.getByRole('link', { name: 'Hana Vítová', exact: true }).click();
  await titled(client, 'Hana Vítová');
  await client.getByText('Po lhůtě', { exact: true }).waitFor();
  await client.getByLabel('Doplnění podkladů', { exact: true }).fill('Dodatečně doplňuji referenci TEST-56.');
  await btn(client, 'Doplnit podklady').click();
  await client.getByText('Podklady byly doplněny.', { exact: true }).waitFor();
  await focus(staff);
  await staff.locator('#handoff-escalations-count').waitFor({ state: 'hidden' });
  await goto(staff, 'Eskalace reklamací');
  await titled(staff, 'Eskalace reklamací');
  await staff.getByText('Žádná otevřená reklamace není po lhůtě.', { exact: true }).waitFor();
}

async function claimCalendarSettings({ page }) {
  const admin = await page();
  await btn(admin, /^Správce ·/).click();
  await goto(admin, 'Lhůty reklamací');
  await titled(admin, 'Lhůty reklamací');
  assert.equal(await admin.getByLabel('Začátek pracovní doby').inputValue(), '08:00');
  assert.equal(await admin.getByLabel('Lhůta klienta v pracovních hodinách').inputValue(), '72');

  const client = await page(320);
  await btn(client, /^Klient ·/).click();
  await titled(client, 'Klientský přehled');
  assert.equal(await client.locator('#navigation a[href="#lhuty"]').count(), 0);
  await client.getByRole('link', { name: 'Hana Vítová', exact: true }).click();
  await titled(client, 'Hana Vítová');
  const deadline = client.locator('.claim-deadline time');
  const before = await deadline.getAttribute('datetime');
  assert.ok(before);

  await set(admin, {
    'Začátek pracovní doby': '09:00', 'Konec pracovní doby': '17:00',
    'Lhůta týmu v pracovních hodinách': '12', 'Lhůta klienta v pracovních hodinách': '48',
    'Dny volna navíc': '2035-02-14',
  });
  await btn(admin, 'Uložit pracovní kalendář').click();
  await admin.getByText('Pracovní kalendář byl uložen.', { exact: true }).waitFor();
  await admin.reload();
  await titled(admin, 'Lhůty reklamací');
  assert.equal(await admin.getByLabel('Začátek pracovní doby').inputValue(), '09:00');
  assert.equal(await admin.getByLabel('Konec pracovní doby').inputValue(), '17:00');
  assert.equal(await admin.getByLabel('Lhůta klienta v pracovních hodinách').inputValue(), '48');
  assert.equal(await admin.getByLabel('Dny volna navíc').inputValue(), '2035-02-14');

  await client.bringToFront();
  await client.evaluate(() => window.dispatchEvent(new Event('focus')));
  await client.locator('#claim-calendar-notice').waitFor({ state: 'visible' });
  await btn(client, 'Obnovit detail').click();
  await client.locator('#claim-calendar-notice').waitFor({ state: 'hidden' });
  assert.ok(Date.parse(await deadline.getAttribute('datetime')) < Date.parse(before));
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

async function claimWorkflows(context) {
  await handoffFeedback(context);
  await claimCalendarSettings(context);
}

const demoWorkflows = async (context) => {
  await demo(context);
  await clientPortal(context);
  await googleAdsPilot(context);
  await claimWorkflows(context);
};
const check = process.env.TEST_URL
  ? exerciseBrowser(process.env.TEST_URL, [], process.env.FEEDBACK_ONLY ? claimWorkflows : published, true)
  : openCase(true, demoWorkflows).then(() => openCase(true, accessWorkflow)).then(() => openCase(false, blank));
check.then(() => {
  console.log('PASS workspace roles, CRM, campaigns, monthly reports, investor communication and complaints');
}).catch((error) => { console.error(error); process.exitCode = 1; });
