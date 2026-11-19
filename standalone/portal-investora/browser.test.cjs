'use strict';

const assert = require('node:assert/strict');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');

const engine = process.env.TEST_ENGINE || 'chromium';
const url = process.env.PORTAL_TEST_URL || pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href;
const screenshotFolder = path.join(__dirname, 'screenshots');

async function goTo(page, control, hash) {
  const targetHash = hash ?? await control.getAttribute('href');
  await Promise.all([
    page.waitForURL((target) => target.hash === targetHash),
    control.click({ noWaitAfter: true }),
  ]);
  await page.locator(targetHash).waitFor();
}

async function downloadFile(page, button) {
  const [artifact] = await Promise.all([
    page.waitForEvent('download'),
    button.click({ noWaitAfter: true }),
  ]);
  return artifact;
}

async function verify() {
  const browser = await playwright[engine].launch({ executablePath: process.env.CHROME_PATH, headless: true, timeout: 15000 });
  const errors = [];
  const requests = [];
  async function open(viewport, disableStorage = false) {
    const context = await browser.newContext({ viewport, offline: url.startsWith('file:') });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-20T10:00:00Z'));
    page.setDefaultTimeout(8500);
    page.setDefaultNavigationTimeout(20000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    if (disableStorage) await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready.then(() => null));
    assert.equal(await page.evaluate(() => [...document.fonts].some((face) => face.family === 'Inter' && face.status === 'loaded')), true);
    return page;
  }
  async function shot(page, filename) {
    if (!process.env.SCREENSHOTS) return;
    await mkdir(screenshotFolder, { recursive: true });
    await page.screenshot({ path: path.join(screenshotFolder, filename), fullPage: true });
  }

  try {
    const page = await open({ width: 1420, height: 900 });
    const dialog = page.getByRole('dialog');
    const go = (name) => goTo(page, page.getByRole('navigation').getByRole('link', { name, exact: typeof name === 'string' }));
    const close = async () => {
      await dialog.getByRole('button', { name: 'Zavřít' }).click();
      await dialog.waitFor({ state: 'hidden' });
    };
    assert.match(await page.locator('#portfolio-total').textContent(), /400\s000\sKč/);
    assert.match(await page.locator('#payment-amount').textContent(), /6\s250\sKč/);
    assert.equal(await page.locator('#active-count').textContent(), '2');
    assert.equal(await page.locator('#inbox-badge').textContent(), '2');
    await shot(page, 'prehled.png');
    // Some WebKit configurations omit links from default Tab navigation.
    if (engine === 'webkit') await page.locator('.skip').focus();
    else await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Přejít na obsah');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    const payment = page.getByRole('button', { name: 'Detail plánované platby' });
    await payment.focus();
    await page.keyboard.press('Enter');
    assert.match(await dialog.textContent(), /MD-101.*Plánované platby/s);
    assert.equal(await dialog.locator('.payment-list li').count(), 2);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement.id === 'payment-detail');
    await page.getByRole('button', { name: 'Skrýt navigaci' }).click();
    assert.equal(await page.locator('#workspace-nav').isVisible(), false);
    await page.getByRole('button', { name: 'Zobrazit navigaci' }).click();
    assert.equal(await page.locator('#workspace-nav').isVisible(), true);

    await goTo(page, page.getByRole('link', { name: 'Zobrazit portfolio' }));
    await page.getByRole('heading', { name: 'Moje portfolio' }).waitFor();
    assert.equal(await page.locator('#scheduled-payments li').count(), 4);
    assert.match(await page.locator('#schedule-summary').textContent(), /20\s000\sKč/);
    await page.getByRole('button', { name: /Detail platby · Projekt Modrý Dvůr/ }).first().click();
    assert.match(await dialog.textContent(), /MD-101/);
    await close();
    const calendarButton = page.getByRole('button', { name: 'Stáhnout kalendář (.ics)' });
    const calendarFile = await downloadFile(page, calendarButton);
    assert.equal(calendarFile.suggestedFilename(), 'harmonogram-plateb.ics');
    const calendar = await readFile(await calendarFile.path(), 'utf8');
    assert.match(calendar, /DTSTART;VALUE=DATE:20261218/);
    assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 4);
    const searchPosition = page.getByLabel('Hledat pozici');
    await searchPosition.fill('modry');
    assert.equal(await page.locator('.position-row').count(), 1);
    assert.equal(await page.locator('#scheduled-payments li').count(), 2);
    const filteredCalendar = await downloadFile(page, calendarButton);
    const selectedCalendar = await readFile(await filteredCalendar.path(), 'utf8');
    assert.equal((selectedCalendar.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.doesNotMatch(selectedCalendar, /BT-204/);
    await page.getByLabel('Stav pozice').selectOption('closed');
    assert.equal(await page.locator('#positions-empty').isVisible(), true);
    assert.equal(await page.locator('#export-portfolio').isDisabled(), true);
    await page.locator('#clear-position-filters').click();
    assert.equal(await searchPosition.inputValue(), '');
    assert.equal(await page.locator('.position-row').count(), 3);
    await shot(page, 'platby.png');
    assert.equal(await page.locator('.position-row').count(), 3);
    await page.getByLabel('Stav pozice').selectOption('active');
    assert.equal(await page.locator('.position-row').count(), 2);
    await page.getByRole('button', { name: 'Otevřít detail · Byty U Trati' }).click();
    assert.match(await dialog.textContent(), /BT-204/);
    await close();
    await page.getByLabel('Stav pozice').selectOption('closed');
    assert.equal(await calendarButton.isDisabled(), true);
    assert.match(await page.locator('#schedule-summary').textContent(), /nemají plánované platby/);
    assert.equal(await page.locator('.position-row').count(), 1);
    await page.getByRole('button', { name: 'Otevřít detail · Mlýn u Sadu' }).click();
    assert.match(await dialog.textContent(), /Splacená.*nejsou naplánované platby/s);
    await goTo(page, dialog.getByRole('button', { name: 'Zprávy k pozici' }), '#komunikace');
    await page.getByRole('heading', { name: 'Komunikace' }).waitFor();
    assert.equal(await page.getByLabel('Pozice zprávy').inputValue(), 'MS-087');
    assert.equal(await page.locator('#inbox-list li').count(), 1);
    assert.match(await page.locator('#inbox-list').textContent(), /Mlýn u Sadu byl splacen/);
    await page.getByLabel('Pozice zprávy').selectOption('');
    await go('Portfolio');
    const download = await downloadFile(page, page.getByRole('button', { name: 'Stáhnout zobrazené pozice CSV' }));
    assert.equal(download.suggestedFilename(), 'portfolio.csv');
    const exported = await readFile(await download.path(), 'utf8');
    assert.match(exported, /MS-087/);
    assert.doesNotMatch(exported, /BT-204|MD-101/);
    await page.getByLabel('Stav pozice').selectOption('all');
    assert.equal(await page.locator('.position-row').count(), 3);

    await go('Příležitosti');
    assert.equal(await page.locator('.opportunity').count(), 3);
    await page.getByLabel('Hledat projekt').fill('Javorova');
    assert.equal(await page.locator('.opportunity').count(), 1);
    await page.getByLabel('Kategorie').selectOption('Komerční prostory');
    await page.getByText('Tomuto filtru neodpovídá žádná příležitost.').waitFor();
    await page.getByRole('button', { name: 'Vymazat filtry' }).click();
    assert.equal(await page.locator('.opportunity').count(), 3);
    await page.getByLabel('Pouze uložené').check();
    await page.getByText('Zatím nemáte žádné uložené příležitosti.').waitFor();
    await page.getByRole('button', { name: 'Vymazat filtry' }).click();
    await page.getByRole('button', { name: 'Otevřít detail · Areál Javorová' }).click();
    assert.match(await dialog.textContent(), /18 měsíců/);
    await dialog.getByRole('button', { name: 'Uložit příležitost' }).click();
    await dialog.getByRole('button', { name: 'Zaznamenat zájem' }).click();
    await dialog.getByText('Zájem zaznamenán.').waitFor();
    await shot(page, 'detail.png');
    await close();
    await page.reload();
    await page.getByLabel('Pouze uložené').check();
    assert.equal(await page.locator('.opportunity').count(), 1);
    assert.match(await page.locator('.opportunity').textContent(), /Javorová.*Uloženo.*Zájem zaznamenán/s);
    await page.getByRole('button', { name: 'Otevřít detail · Areál Javorová' }).click();
    await dialog.getByRole('button', { name: 'Zrušit zájem' }).click();
    await dialog.getByRole('button', { name: 'Odebrat z uložených' }).click();
    await close();
    await page.waitForFunction(() => document.activeElement.id === 'clear-filters');
    await page.getByRole('button', { name: 'Vymazat filtry' }).click();
    assert.doesNotMatch(await page.locator('.opportunity-grid').textContent(), /Zájem zaznamenán|Uloženo/);

    await go('Přehled');
    await goTo(page, page.getByRole('link', { name: 'Prohlédnout příležitosti' }));
    await page.getByRole('heading', { name: 'Příležitosti', exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'Přehled investora' }).waitFor();
    await page.locator('#recent-portfolio-list').click();
    assert.match(await dialog.textContent(), /Listopadový přehled portfolia/);
    await dialog.getByRole('button', { name: 'Označit jako nepřečtenou' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#inbox-badge').textContent(), '2');
    await goTo(page, page.getByRole('link', { name: 'Všechny zprávy' }));
    const inboxQuery = page.getByLabel('Hledat ve zprávách');
    await shot(page, 'komunikace.png');
    await inboxQuery.fill('priprava hotova');
    assert.equal(await page.locator('#inbox-list li').count(), 1);
    assert.equal(await page.locator('#inbox-courtyard').isVisible(), true);
    await inboxQuery.fill('neexistujici');
    await page.getByText('V tomto filtru nejsou žádné zprávy.').waitFor();
    await page.getByRole('button', { name: 'Zobrazit všechny zprávy' }).click();
    assert.equal(await inboxQuery.inputValue(), '');
    await page.getByLabel('Zobrazit', { exact: true }).selectOption('unread');
    assert.equal(await page.locator('#inbox-list li').count(), 2);
    await page.locator('#inbox-portfolio-list').click();
    assert.equal(await page.locator('#inbox-badge').textContent(), '1');
    await close();
    await page.locator('#inbox-courtyard').click();
    await close();
    await page.getByText('V tomto filtru nejsou žádné zprávy.').waitFor();
    assert.equal(await page.locator('#inbox-badge').isVisible(), false);
    await page.getByRole('button', { name: 'Zobrazit všechny zprávy' }).click();
    assert.equal(await page.locator('#inbox-list li').count(), 3);
    await page.reload();
    assert.equal(await page.locator('#inbox-badge').isVisible(), false);

    await page.getByRole('button', { name: 'Vymazat uložený stav', exact: true }).click();
    await dialog.getByRole('button', { name: 'Zrušit', exact: true }).click();
    assert.equal(await page.locator('#inbox-badge').isVisible(), false);
    await page.getByRole('button', { name: 'Vymazat uložený stav', exact: true }).click();
    await dialog.getByRole('button', { name: 'Vymazat', exact: true }).click();
    assert.equal(await page.locator('#inbox-badge').textContent(), '2');
    assert.equal(await page.locator('#case-card').isVisible(), false);
    assert.equal(await page.locator('#case-back').isVisible(), false);
    assert.equal(await page.locator('#audit-link').getAttribute('href'), '../audit-kampani/index.html');
    assert.equal(await page.locator('#audit-link').getAttribute('target'), '_blank');
    assert.equal(await page.locator('#launch-link').getAttribute('href'), '../kontrola-pred-spustenim/index.html');

    if (url.startsWith('https:')) {
      await go('Příležitosti');
      await page.locator('#detail-stran').click();
      const otherTab = await page.context().newPage();
      try {
        await otherTab.goto(`${url}#prilezitosti`);
        await otherTab.locator('#detail-stran').click();
        await dialog.getByRole('button', { name: 'Uložit příležitost' }).click();
        await otherTab.getByRole('button', { name: 'Odebrat z uložených' }).click();
        await dialog.getByRole('button', { name: 'Uložit příležitost' }).waitFor();
        await close();
      } finally { await otherTab.close(); }
    }

    const mobile = await open({ width: 320, height: 800 }, true);
    await shot(mobile, 'mobil.png');
    for (const route of ['#portfolio', '#prilezitosti', '#komunikace']) {
      await goTo(mobile, mobile.locator(`nav a[href="${route}"]`), route);
      await mobile.waitForFunction((hash) => !document.querySelector(hash).hidden, route);
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await mobile.locator('nav a[href="#prilezitosti"]').click();
    await mobile.getByRole('button', { name: 'Otevřít detail · Park U Dubu' }).click();
    await mobile.getByRole('button', { name: 'Uložit příležitost' }).click();
    await mobile.getByRole('button', { name: 'Zavřít' }).click();
    await mobile.getByLabel('Pouze uložené').check();
    assert.equal(await mobile.locator('.opportunity').count(), 1);

    await page.clock.setFixedTime(new Date('2027-04-24T10:00:00Z'));
    await page.goto(`${url}#prehled`);
    await page.reload();
    assert.equal(await page.locator('#payment-project').textContent(), 'Žádná nadcházející platba.');
    assert.equal(await payment.isVisible(), false);
    assert.deepEqual(errors, []);
    assert.ok(requests.every((request) => request === url), requests.join('\n'));
    console.log(`PASS ${engine}: portfolio and CSV, opportunity search and state, inbox, reset, keyboard, mobile, blocked storage`);
  } finally { await browser.close(); }
}

verify().catch((error) => { console.error(error); process.exitCode = 1; });
