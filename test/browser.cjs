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
  const { exampleAdsSnapshot } = await import('../google-ads-example.mjs');
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
}

async function published(context) {
  await demo(context);
  await clientPortal(context);
  await googleAdsPilot(context);
  await handoffFeedback(context);
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
  const outcome = 'Reklamaci uznáváme. Teď ověříme správný kontakt.';
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
  assert.equal(await btn(client, 'Podat reklamaci').count(), 0);

  const staff = await page();
  await btn(staff, /^Péče ·/).click();
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
  await btn(staff, 'Převzít reklamaci').click();
  await staff.getByText('Reklamace je v řešení.', { exact: true }).waitFor();
  await btn(client, 'Obnovit detail').click();
  await client.getByText('V řešení', { exact: true }).waitFor();
  await staff.getByLabel('Výsledek reklamace', { exact: true }).selectOption('accepted');
  await staff.getByLabel('Vyjádření pro klienta', { exact: true }).fill(outcome);
  await btn(staff, 'Uložit rozhodnutí').click();
  await staff.getByText('Rozhodnutí bylo uloženo.', { exact: true }).waitFor();

  await btn(client, 'Obnovit detail').click();
  await client.getByText('Uznaná', { exact: true }).waitFor();
  await client.getByText(outcome, { exact: true }).waitFor();
  await client.getByRole('link', { name: 'Zpět do přehledu', exact: true }).click();
  await titled(client, 'Klientský přehled');
  await client.getByRole('row', { name: /Zuzana Šedá/ }).getByText('Uznaná', { exact: true }).waitFor();
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await staff.getByRole('link', { name: 'Zpět k předáním', exact: true }).click();
  await titled(staff, 'Předání klientům');
  assert.equal(await row.count(), 0);
  await staff.getByLabel('Stav předání', { exact: true }).selectOption('closed');
  await btn(staff, 'Použít filtr').click();
  await row.getByText('Uznaná', { exact: true }).waitFor();
}

const demoWorkflows = async (context) => {
  await demo(context);
  await clientPortal(context);
  await googleAdsPilot(context);
  await handoffFeedback(context);
};
const check = process.env.TEST_URL
  ? exerciseBrowser(process.env.TEST_URL, [], process.env.FEEDBACK_ONLY ? handoffFeedback : published, true)
  : openCase(true, demoWorkflows).then(() => openCase(false, blank));
check.then(() => {
  console.log('PASS browser delivery confirmation and claim through client and team roles');
}).catch((error) => { console.error(error); process.exitCode = 1; });
