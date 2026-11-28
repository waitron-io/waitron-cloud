import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {bugStatusCommand} from '../../../packages/operations/test/staff-bug-status-fixture.ts';
import {connectedVenue} from '../../../packages/translation/test/fixtures.ts';
import {completeBrowserEmail, startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';

test('an owner sees refreshed bug status and opens exact signed reports from the venue card', async t => {
 const f = await startPortalFixture();
 try {
  const box = await connectedVenue(f.db, f.issuer, f.origin);
  const email = (await f.db.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1', [box.accountId])).rows[0].email;
  const reportId = randomUUID();
  const original = JSON.stringify({version: '1.2.3', time: Date.now(), logs: [],
   details: {device: 'till', equipment: ['printer'], upgradedAt: null, hosting: 'on_prem'}}, null, 2) + '\n';
  const later = JSON.stringify({reportId, description: 'Paper jam\n<em>plain text</em>\n' + 'Á'.repeat(210), time: Date.now()}) + '\n';
  for (const [action, body, operationId] of [['staff-report', original, reportId], ['staff-description', later, randomUUID()]] as const) {
   const signed = box.proof(action, {version: 1, bodySha256: createHash('sha256').update(body).digest('hex'), bodyBytes: Buffer.byteLength(body)}, operationId, box.lease);
   const reply = await fetch(f.origin + '/api/installations/' + action, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...signed, body})});
   assert.equal(reply.status, 200, await reply.clone().text());
  }
  const context = await f.browser.newContext({locale: 'en', colorScheme: 'light', viewport: {width: 390, height: 844}});
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  await page.goto(f.origin + '/login#lang=en');
  await page.getByLabel(translations.en.email).fill(email);
  await page.locator('input[name=password]').fill('A long enough test password');
  await page.getByRole('button', {name: translations.en.login, exact: true}).click();
  await completeBrowserEmail(f, page, email, 'en');
  await page.waitForURL(f.origin + '/account');

  const command = await bugStatusCommand(t, f.db.schema);
  let linked = false;
  const screenshots = process.env.SENT_REPORTS_SCREENSHOTS;
  const layouts = screenshots
   ? (['en', 'es'] as const).flatMap(locale => (['light', 'dark'] as const).flatMap(colorScheme => [390, 1280].map(width => ({locale, colorScheme, width}))))
   : [{locale: 'en', colorScheme: 'light', width: 390} as const];
  for (const {locale, colorScheme, width} of layouts) {
   const label = locale === 'en' ? 'Sent reports' : 'Informes enviados';
   await page.setViewportSize({width, height: 900});
   await page.emulateMedia({colorScheme});
   await page.goto(f.origin + '/account');
   await page.goto(f.origin + '/account/venues#lang=' + locale);
   const open = page.getByRole('button', {name: label, exact: true});
   await open.focus();
   await page.keyboard.press('Enter');
   const region = page.getByRole('region', {name: label, exact: true});
   assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H4');
   if (!linked) {
    await region.getByRole('button', {name: /1\.2\.3.*Open/}).waitFor();
    await command.reply({labels: [{name: 'fixed in 1.2.4'}]});
    await command.run(box.installationId, reportId);
    await region.getByRole('button', {name: 'Refresh', exact: true}).click();
    linked = true;
   }
   const item = region.getByRole('button', {name: locale === 'en' ? /1\.2\.3.*Fixed in version 1\.2\.4/ : /1\.2\.3.*Corregido en la versión 1\.2\.4/});
   await item.focus();
   await page.keyboard.press('Enter');
   await region.locator('pre').nth(1).waitFor();
   assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H5');
   assert.deepEqual(await region.locator('pre').allTextContents(), [original, later]);
   assert.equal(await region.locator('pre em').count(), 0);
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
   if (screenshots) await region.screenshot({path: `${screenshots}/${locale}-${colorScheme}-${width}.png`});
   await region.getByRole('button', {name: locale === 'en' ? 'Close' : 'Cerrar', exact: true}).press('Enter');
   await page.waitForFunction(name => document.activeElement?.tagName === 'WT-BUTTON' && document.activeElement.textContent?.trim() === name, label);
  }
 } finally {
  await f.close();
 }
});
