'use strict';

const assert = require('node:assert/strict');
const playwright = require('playwright');

async function verify() {
  const base = new URL(process.env.TEST_URL);
  const engine = process.env.TEST_ENGINE || 'chromium';
  const browser = await playwright[engine].launch({ executablePath: process.env.CHROME_PATH });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    context.on('request', (request) => {
      if (!request.url().startsWith(base.href) && !request.url().startsWith('blob:')) errors.push('External request ' + request.url());
    });
    context.on('weberror', (error) => errors.push(error.error().message));
    const page = await context.newPage();
    await page.goto(base.href);
    await page.getByRole('link', { name: 'Kontrola odkazů' }).click();
    const result = page.locator('.result-card').filter({ hasText: 'utm_content=prohlidka-b' });
    await result.getByRole('button', { name: 'Upravit odkaz' }).click();
    await page.getByRole('button', { name: 'Vytvořit odkaz' }).click();
    await page.getByRole('button', { name: 'Nahradit v kontrole' }).click();
    await result.getByRole('button', { name: 'Ověřit předání' }).click();
    await page.getByRole('button', { name: 'Ověřit přenos' }).click();
    await page.getByRole('button', { name: 'Otevřít v Auditu' }).click();
    await page.waitForURL('**/audit-kampani/?predani=1#leads');
    const record = page.locator('#lead-rows tr').filter({ hasText: 'QA-SCENAR-01' });
    await record.getByRole('button', { name: 'Upravit stav' }).click();
    await page.getByRole('button', { name: 'Potvrdit zájem' }).click();
    await page.getByRole('button', { name: 'Zaznamenat předání' }).click();
    await page.getByRole('button', { name: 'Připravit kontrolní e-mail' }).click();
    await page.getByRole('link', { name: 'Otevřít portál investora' }).click();
    await page.waitForURL('**/portal-investora/index.html?predani=1#komunikace');
    assert.equal(await page.locator('#inbox-list li').count(), 1);
    await page.getByRole('link', { name: 'Zpět do Auditu' }).click();
    await page.waitForURL('**/audit-kampani/index.html?predani=1#leads');
    assert.match(await record.textContent(), /Předáno/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

verify().then(() => console.log('PASS standalone checklist, audit and investor portal share a journey under one project URL'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
