'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');
const audit = require('./audit-data.js');
const { sampleCsv } = require('./audit-fixtures.js');

const folder = __dirname;
const url = process.env.AUDIT_TEST_URL || pathToFileURL(path.join(folder, 'dist', 'index.html')).href;
const csv = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

async function verify() {
  const browser = await playwright[process.env.TEST_ENGINE || 'chromium'].launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    timeout: 10000,
  });
  const errors = [];
  const external = [];
  async function open(viewport) {
    const page = await browser.newPage({ viewport, offline: url.startsWith('file:') });
    page.setDefaultTimeout(6000);
    page.setDefaultNavigationTimeout(20000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/^https?:/.test(request.url()) && request.url() !== url) external.push(request.url()); });
    await page.goto(url);
    await page.locator('#campaign-rows tr').first().waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => null));
    assert.equal(await page.evaluate(() => [...document.fonts].some((font) => font.family === 'Inter' && font.status === 'loaded')), true);
    return page;
  }

  try {
    const page = await open({ width: 1420, height: 1040 });
    const totals = () => page.locator('#metrics dd').allTextContents();
    const google = () => page.locator('#campaign-rows tr').filter({ hasText: 'G-202' });
    const googlePrice = () => google().locator('td').last().textContent();
    assert.match(await googlePrice(), /800/);
    assert.equal((await totals())[1], '72');
    await page.getByRole('button', { name: 'Předané klientovi · 7' }).click();
    assert.equal(await page.locator('#filter-issue').inputValue(), 'handed-off');
    assert.equal(await page.locator('#lead-rows tr').count(), 7);
    await page.locator('#filter-issue').selectOption('all');
    await page.getByRole('link', { name: 'Přehled', exact: true }).click();
    if (process.env.SCREENSHOTS) await page.screenshot({ path: path.join(folder, 'desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Skrýt navigaci' }).click();
    assert.equal(await page.locator('#workspace-nav').isVisible(), false);
    await page.getByRole('button', { name: 'Zobrazit navigaci' }).click();
    assert.equal(await page.locator('#workspace-nav').isVisible(), true);
    assert.match(await page.locator('#channel-bars').textContent(), /Google Ads/);
    assert.match(await page.locator('#funnel').textContent(), /Zachycené poptávky74/);
    await google().locator('td').last().getByRole('button').click();
    assert.match(await page.getByRole('dialog').textContent(), /÷ 12/);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Shodné řádky v importu' }).click();
    assert.match(await page.getByRole('dialog').textContent(), /shodný se záznamem/);
    await page.getByRole('button', { name: 'Zavřít' }).click();
    await page.locator('#campaign-sort').selectOption('rate');
    assert.match(await page.locator('#campaign-rows tr').first().textContent(), /G-202/);

    await page.getByRole('link', { name: 'Poptávky', exact: true }).click();
    await page.getByRole('searchbox', { name: 'ID poptávky' }).fill('G-202-13');
    await page.getByRole('button', { name: 'Upravit stav' }).click();
    await page.getByRole('button', { name: 'Potvrdit zájem' }).click();
    assert.match(await page.locator('#lead-rows').textContent(), /Kvalifikovaná/);
    await page.locator('#leads a[href="#report"]').click();
    assert.match(await googlePrice(), /738/);
    assert.deepEqual((await totals()).slice(1, 3), ['72', '24']);

    await page.locator('#report-source').selectOption('Google Ads');
    await page.getByRole('button', { name: 'Zobrazit období' }).click();
    assert.deepEqual((await totals()).slice(1, 3), ['24', '13']);
    await page.locator('#report-source').selectOption('');
    await page.getByRole('button', { name: 'Zobrazit období' }).click();

    assert.match(await page.locator('#coverage').textContent(), /72 z 74 poptávek/);
    const [findings] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Stáhnout zjištění CSV' }).click()]);
    const findingsCsv = await readFile(await findings.path(), 'utf8');
    assert.match(findingsCsv, /QA-401[^\r\n]*Chybí kanál nebo ID/);
    assert.match(findingsCsv, /QA-402[^\r\n]*Kampaň ve výdajích chybí/);
    await page.getByRole('button', { name: 'Kampaň ve výdajích chybí' }).click();
    assert.equal(await page.locator('#lead-rows tr').count(), 1);
    assert.match(await page.locator('#lead-rows').textContent(), /QA-402/);
    await page.locator('#leads a[href="#report"]').click();
    await page.getByRole('button', { name: 'Zobrazit nepřiřazené' }).click();
    assert.equal(await page.locator('#lead-rows tr').count(), 2);
    assert.match(await page.locator('#lead-rows').textContent(), /QA-401.*Bez přiřazení.*QA-402.*Bez výdajů v období/s);
    await page.locator('#filter-issue').selectOption('missing-status');
    assert.match(await page.locator('#lead-rows').textContent(), /Chybí stav/);
    await page.locator('#filter-issue').selectOption('all');
    await page.getByRole('button', { name: 'Další' }).click();
    assert.match(await page.locator('#lead-count').textContent(), /16–30/);
    await page.getByRole('button', { name: 'Předchozí' }).click();
    await page.locator('#filter-search').fill('unmatched-no-result');
    assert.match(await page.locator('#lead-rows').textContent(), /žádná poptávka/);
    await page.locator('#filter-search').fill('');
    await page.locator('#leads a[href="#report"]').click();
    const [reportDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Stáhnout report' }).click()]);
    const data = await readFile(await reportDownload.path(), 'utf8');
    assert.match(data, /G-202[^\r\n]*738,46/);
    assert.doesNotMatch(data, /QA-401|G-202-13/);

    const sample = sampleCsv();
    await page.getByRole('link', { name: 'Import dat' }).click();
    for (const [kind, text] of [['spend','campaign_id'], ['leads','lead_id']]) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-export-input="${kind}"]`).click()]);
      assert.match(await readFile(await download.path(), 'utf8'), new RegExp(text));
    }
    async function attach(kind, data) {
      await page.locator(`#file-${kind}`).setInputFiles(csv(`${kind}.csv`, data));
      await page.locator(`#map-${kind} select`).first().waitFor();
    }
    await attach('spend', sample.spend);
    await attach('leads', sample.leads);
    const preview = page.getByRole('button', { name: 'Zkontrolovat import' });
    assert.equal(await page.locator('#use-files').isDisabled(), true);
    await preview.click();
    assert.match(await page.locator('#import-preview').textContent(), /74 použitelných · 1 duplicit · 0 chybných/);
    assert.equal(await page.locator('#use-files').isDisabled(), true);
    await page.getByText('Náhled je připravený. Před použitím potvrďte měnu výdajů.').waitFor();
    const confirm = page.getByRole('checkbox', { name: 'Potvrzuji, že výdaje jsou v Kč.' });
    await confirm.check();
    await confirm.uncheck();
    assert.equal(await page.locator('#use-files').isDisabled(), true);
    await confirm.check();
    await page.getByRole('button', { name: 'Použít data' }).click();
    await page.getByRole('heading', { name: 'Přehled kampaní' }).waitFor();
    const firstImport = await totals();
    assert.deepEqual(firstImport.slice(1,3), ['72', '23']);
    await page.getByRole('link', { name: 'Import dat' }).click();
    await page.getByRole('button', { name: 'Použít data' }).click();
    await page.getByRole('heading', { name: 'Přehled kampaní' }).waitFor();
    assert.deepEqual(await totals(), firstImport);
    await page.getByRole('link', { name: 'Import dat' }).click();
    await attach('spend', sample.spend.replace(';CZK', ';EUR'));
    await preview.click();
    await page.locator('#import-error').waitFor();
    assert.match(await page.locator('#import-preview').textContent(), /Měna musí být CZK/);
    assert.equal(await page.locator('#use-files').isDisabled(), true);
    await page.getByRole('link', { name: 'Přehled', exact: true }).click();
    assert.deepEqual(await totals(), firstImport);

    await page.getByRole('link', { name: 'Import dat' }).click();
    await attach('spend', 'A;B;C;D\n2026-11-02;Meta;42;100');
    await attach('leads', 'A;B;C;D;E\nnew-01;2026-11-02;facebook;42;Nová');
    for (const [kind, fields] of [['spend', ['date','source','campaign','spend']], ['leads', ['id','date','source','campaign','status']]]) {
      for (const [index, field] of fields.entries()) await page.locator(`#map-${kind}-${field}`).selectOption(String(index));
    }
    await page.locator('#qualified-states').fill('Schůzka');
    await preview.click();
    await page.getByRole('button', { name: 'Použít data' }).click();
    await page.getByRole('heading', { name: 'Přehled kampaní' }).waitFor();
    assert.deepEqual((await totals()).slice(1,3), ['1','0']);
    assert.equal(await page.locator('#handoff-summary').isVisible(), false);
    await page.getByRole('link', { name: 'Poptávky', exact: true }).click();
    await page.getByRole('button', { name: 'Upravit stav' }).click();
    await page.getByRole('button', { name: 'Potvrdit zájem' }).click();
    assert.match(await page.locator('#lead-rows').textContent(), /Schůzka/);
    await page.getByRole('button', { name: 'Upravit stav' }).click();
    await page.getByLabel('Stav CRM', { exact: true }).fill('Čeká');
    await page.getByRole('dialog').getByLabel('Datum předání').fill('2026-11-03');
    await page.getByRole('button', { name: 'Uložit stav' }).click();
    assert.match(await page.locator('#lead-rows').textContent(), /Čeká/);
    await page.getByRole('button', { name: 'Upravit stav' }).click();
    await page.getByRole('button', { name: 'Vrátit předchozí stav' }).click();
    await page.getByRole('link', { name: 'Import dat' }).click();
    const [edited] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-input="leads"]').click()]);
    assert.match(await readFile(await edited.path(), 'utf8'), /new-01[^\r\n]*Schůzka[^\r\n]*2026-11-03/);
    await page.getByRole('link', { name: 'Přehled', exact: true }).click();
    assert.deepEqual((await totals()).slice(1,3), ['1','1']);
    assert.match(await page.locator('#handoff-summary').textContent(), /Předané klientovi · 1.*100\s*Kč/);
    await page.locator('#date-from').fill('2026-11-03');
    await page.getByRole('button', { name: 'Zobrazit období' }).click();
    assert.match(await page.locator('#period-error').textContent(), /musí předcházet/);
    assert.equal(await page.locator('#date-from').getAttribute('aria-invalid'), 'true');
    const errorBox = await page.locator('#period-error').boundingBox();
    const fieldsBox = await page.locator('#date-to').boundingBox();
    assert.ok(errorBox.y > fieldsBox.y + fieldsBox.height);
    await page.locator('#date-from').fill('2026-11-03');
    await page.locator('#date-to').fill('2026-11-03');
    assert.equal(await page.locator('#period-error').isVisible(), false);
    await page.getByRole('button', { name: 'Zobrazit období' }).click();
    assert.deepEqual((await totals()).slice(1,3), ['0','0']);
    assert.equal(await page.getByRole('button', { name: 'Stáhnout report' }).isDisabled(), true);
    await page.reload();
    assert.deepEqual((await totals()).slice(1,3), ['72','23']);
    const investor = page.getByRole('link', { name: 'Portál investora', exact: true });
    const original = page.url();
    assert.equal(await investor.getAttribute('href'), '../portal-investora/index.html');
    assert.equal(await investor.getAttribute('target'), '_blank');
    if (url.startsWith('http')) {
      const [portal] = await Promise.all([page.context().waitForEvent('page'), investor.click()]);
      try {
        await portal.getByRole('heading', { name: 'Přehled investora' }).waitFor();
        assert.equal(await portal.evaluate(() => window.opener), null);
        assert.equal(page.url(), original);
        assert.deepEqual((await totals()).slice(1,3), ['72','23']);
      } finally { await portal.close(); }
      await page.goto(url + '#investor');
      await page.waitForURL((target) => target.hash === '#report');
      await page.getByRole('heading', { name: 'Přehled kampaní' }).waitFor();
    }

    const mobile = await open({ width: 390, height: 844 });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.SCREENSHOTS) await mobile.screenshot({ path: path.join(folder, 'mobile.png'), fullPage: true });
    await mobile.getByRole('link', { name: 'Import dat' }).click();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS Audit: calculations, qualification, chart values, drill-downs, filters, CSV preview/import/export, investor portal and mobile layout');
  } finally {
    await browser.close();
  }
}

verify().catch((error) => { console.error(error); process.exitCode = 1; });
