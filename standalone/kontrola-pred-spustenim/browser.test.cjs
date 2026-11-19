'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');
const { sample } = require('./links.js');

const url = process.env.LAUNCH_TEST_URL || pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href;

async function verify() {
  const browser = await playwright[process.env.TEST_ENGINE || 'chromium'].launch({ executablePath: process.env.CHROME_PATH, headless: true, timeout: 12000 });
  const errors = [];
  const outgoing = [];
  async function open(viewport) {
    const page = await browser.newPage({ viewport, offline: url.startsWith('file:') });
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(20000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/^https?:/.test(request.url()) && request.url() !== url) outgoing.push(request.url()); });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready.then(() => null));
    assert.equal(await page.evaluate(() => [...document.fonts].some((font) => font.family === 'Inter' && font.status === 'loaded')), true);
    return page;
  }

  async function download(page, button) {
    const [artifact] = await Promise.all([
      page.waitForEvent('download'),
      button.click({ noWaitAfter: true }),
    ]);
    return readFile(await artifact.path(), 'utf8');
  }

  async function goTo(page, control, view) {
    await Promise.all([
      page.waitForURL((target) => target.hash === '#' + view),
      control.click({ noWaitAfter: true }),
    ]);
    await page.locator('#' + view).waitFor();
  }

  try {
    const page = await open({ width: 1420, height: 1000 });
    const counts = page.locator('#counts');
    assert.match(await counts.textContent(), /1 připravený · 4 k úpravě/);
    if (process.env.SCREENSHOTS) await page.screenshot({ path: path.join(__dirname, 'desktop.png') });
    await page.getByRole('button', { name: 'Skrýt navigaci' }).click();
    assert.equal(await page.locator('#workspace-nav').isVisible(), false);
    await page.getByRole('button', { name: 'Zobrazit navigaci' }).click();
    assert.equal(await page.locator('#workspace-nav').isVisible(), true);
    const state = page.getByLabel('Filtrovat odkazy');
    await state.selectOption('issues');
    await page.getByLabel('Kanál odkazu').selectOption('meta');
    const missing = page.locator('.result-card').filter({ hasText: 'Chybí hodnota utm_id.' });
    await goTo(page, missing.getByRole('button', { name: 'Upravit odkaz' }), 'builder');
    await page.getByLabel('ID kampaně', { exact: true }).fill('M-101');
    await page.getByRole('button', { name: 'Vytvořit odkaz' }).click();
    assert.match(await page.getByRole('textbox', { name: 'Připravený odkaz' }).inputValue(), /utm_id=M-101/);
    await goTo(page, page.getByRole('button', { name: 'Nahradit v kontrole' }), 'check');
    assert.match(await counts.textContent(), /2 připravené · 3 k úpravě/);
    assert.match(await download(page, page.getByRole('button', { name: 'Stáhnout CSV', exact: true })), /utm_id je v odkazu vícekrát/);
    await state.selectOption('ready');
    await page.getByLabel('Kanál odkazu').selectOption('google');
    const query = page.getByRole('searchbox', { name: 'Vyhledat odkaz' });
    await query.fill('G-202');
    assert.equal(await page.locator('.result-card').count(), 1);
    assert.equal(await page.locator('#visible-count').textContent(), '1 z 5 odkazů');
    await query.fill('absent');
    await page.getByText('Filtru neodpovídá žádný odkaz.').waitFor();
    await page.getByRole('button', { name: 'Vymazat filtry' }).click();
    assert.equal(await query.inputValue(), '');
    assert.equal(await page.locator('.result-card').count(), 5);
    assert.equal(await page.locator('#visible-count').isVisible(), false);
    await state.selectOption('ready');
    await page.getByLabel('Kanál odkazu').selectOption('google');
    await goTo(page, page.locator('.result-card').getByRole('button', { name: 'Ověřit předání' }), 'crm');
    await page.getByRole('button', { name: 'Otevřít detail projektu' }).click();
    assert.match(await page.locator('#visit-events').textContent(), /Detail projektu · 1 událost/);
    await page.getByLabel('Návštěvník', { exact: true }).selectOption('existing');
    await page.getByLabel('Téma', { exact: true }).selectOption('Informace o projektu');
    await page.getByRole('button', { name: 'Ověřit přenos' }).click();
    assert.match(await page.locator('#identity').textContent(), /Stávající kontakt.*Informace o projektu/);
    assert.match(await page.locator('#crm-verified').textContent(), /CRM-1/);
    assert.equal(await page.locator('#handoff').isVisible(), false);
    assert.match(await download(page, page.getByRole('button', { name: 'Stáhnout CRM CSV' })), /CRM-1[^\r\n]*G-202/);
    await goTo(page, page.getByRole('link', { name: 'Vybrat odkaz' }), 'check');
    await goTo(page, page.locator('.result-card').getByRole('button', { name: 'Ověřit předání' }), 'crm');
    assert.equal(await page.getByRole('button', { name: 'Ověřit přenos' }).isVisible(), false);
    assert.equal(await page.locator('#crm-rows tr').count(), 1);

    await goTo(page, page.getByRole('link', { name: 'Tvůrce odkazu' }), 'builder');
    await page.getByRole('button', { name: 'Nový odkaz' }).click();
    for (const [preset, source] of [['meta','meta'], ['linkedin','linkedin'], ['vlastni','vlastni'], ['google','google'], ['sklik','sklik']]) {
      await page.getByLabel('Předvolba kanálu').selectOption(preset);
      assert.equal(await page.locator('#utm_source').inputValue(), source);
    }
    await page.getByLabel('Cílová HTTPS adresa').fill('https://' + sample.host + '/byt?ref=agency#detail');
    await page.getByLabel('Název kampaně').fill('Jarní prohlídky');
    await page.getByLabel('ID kampaně', { exact: true }).fill('S-505');
    await page.getByRole('button', { name: 'Vytvořit odkaz' }).click();
    const composed = new URL(await page.locator('#generated').inputValue());
    assert.equal(composed.searchParams.get('ref'), 'agency');
    assert.equal(composed.searchParams.get('utm_campaign'), 'jarni-prohlidky');
    assert.equal(composed.hash, '#detail');
    await page.getByRole('button', { name: 'Zkopírovat' }).click();
    await page.getByText(/Odkaz byl zkopírován|Odkaz je vybraný/).waitFor();
    await goTo(page, page.getByRole('button', { name: 'Přidat do kontroly' }), 'check');
    assert.match(await counts.textContent(), /6 celkem/);

    await page.getByLabel('Schválené domény').fill('http://other.example');
    await page.getByRole('button', { name: 'Zkontrolovat odkazy' }).click();
    assert.match(await page.locator('#scan-error').textContent(), /doménu bez protokolu/);
    await page.getByLabel('Schválené domény').fill(sample.host);
    assert.equal(await page.locator('#scan-error').isVisible(), false);
    await page.getByLabel('Adresy kampaní').fill('bad\n' + sample.links[0] + '\n' + sample.links[0].replace('cpc', 'email') + '\n' + sample.links[0]);
    await page.getByRole('button', { name: 'Zkontrolovat odkazy' }).click();
    assert.match(await page.locator('#result-list').textContent(), /platnými parametry.*Médium není.*Stejný odkaz/s);
    await page.getByRole('button', { name: 'Nová kontrola' }).click();
    assert.equal(await page.locator('#links').inputValue(), '');
    assert.equal(await page.locator('#save-check').isDisabled(), true);
    assert.equal(await page.locator('#results-filters').isVisible(), false);
    const first = sample.links[0];
    await page.locator('#links').fill(`${first}\n${first.replace('rezidence-na-strani', 'rezidence-jaro')}&utm_content=varianta-b`);
    await page.getByRole('button', { name: 'Zkontrolovat odkazy' }).click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'results-title');
    await state.selectOption('conflict');
    assert.equal(await page.locator('.result-card').count(), 2);
    assert.equal(await page.getByRole('button', { name: 'Ověřit předání' }).count(), 0);
    assert.match(await download(page, page.getByRole('button', { name: 'Stáhnout CSV', exact: true })), /Název kampaně se liší od řádku 2/);
    const conflict = page.locator('.result-card').filter({ has: page.getByRole('heading', { name: 'rezidence-jaro · google' }) });
    await goTo(page, conflict.getByRole('button', { name: 'Upravit odkaz' }), 'builder');
    await page.getByLabel('Název kampaně').fill('rezidence-na-strani');
    await page.getByRole('button', { name: 'Vytvořit odkaz' }).click();
    await goTo(page, page.getByRole('button', { name: 'Nahradit v kontrole' }), 'check');
    assert.match(await counts.textContent(), /2 připravené · 0 k úpravě/);
    await goTo(page, page.getByRole('link', { name: 'Ověření CRM' }), 'crm');
    assert.match(await page.locator('#crm-rows').textContent(), /CRM-1/);
    const mobile = await open({ width: 390, height: 850 });
    await mobile.getByRole('button', { name: 'Výsledky · 5' }).click();
    assert.equal(await mobile.evaluate(() => document.activeElement.id), 'results-title');
    await mobile.waitForFunction(() => {
      const top = document.getElementById('results-title').getBoundingClientRect().top;
      return top >= 0 && top < 32;
    });
    await mobile.locator('.result-card').filter({ hasText: 'utm_content=prohlidka-b' }).getByRole('button', { name: 'Upravit odkaz' }).focus();
    await mobile.keyboard.press('Enter');
    await mobile.getByRole('heading', { name: 'Tvůrce odkazu' }).waitFor();
    assert.equal(await mobile.locator('#utm_id').evaluate((element) => element === document.activeElement), true);
    assert.equal(await mobile.locator('#utm_id').inputValue(), 'G-202');
    await mobile.getByLabel('Název kampaně').fill('nova-kampan');
    assert.equal(await mobile.locator('#utm_id').inputValue(), '');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.SCREENSHOTS) await mobile.screenshot({ path: path.join(__dirname, 'mobile.png') });
    assert.deepEqual(errors, []);
    assert.deepEqual(outgoing, []);
    console.log('PASS Launch Check: validation, repair, presets, clipboard, CRM and database simulation, visits, exports and mobile layout');
  } finally { await browser.close(); }
}

verify().catch((error) => { console.error(error); process.exitCode = 1; });
