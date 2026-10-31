import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const requestId = '10000000-0000-4000-8000-000000000001';
const business = {organisationId: '20000000-0000-4000-8000-000000000001', legalBusinessId: '30000000-0000-4000-8000-000000000001', organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES'};
const view = {requestId, localVenueId: '10000000-0000-4000-8000-000000000002', environment: 'test', state: 'awaiting_cloud', expiresAt: '2099-01-01T00:00:00Z'};
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: pairing retry display follows elapsed time through clock corrections`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}}); page.setDefaultTimeout(4000);
      await page.addInitScript(() => {
        const clock = {wall: Date.parse('2026-10-31T10:00:00Z'), elapsed: 0};
        (window as any).pairingClock = clock; Date.now = () => clock.wall; performance.now = () => clock.elapsed;
      });
      const writes: unknown[] = [], unexpected: string[] = [], pageErrors: string[] = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.route('https://portal.test/connect', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path.endsWith('/pairing/businesses')) return route.fulfill({json: {businesses: [business]}});
        if (path.endsWith('/pairing/inspect')) return route.fulfill({json: view});
        if (path.endsWith('/pairing/approve')) {
          writes.push(request.postDataJSON());
          return writes.length === 1 ? route.fulfill({status: 429, headers: {'Retry-After': '2'}, json: {error: 'rate_limited'}})
            : route.fulfill({json: {...view, ...business, state: 'awaiting_local'}});
        }
        unexpected.push(path); return route.fulfill({status: 500, json: {error: 'unexpected_fixture_request'}});
      });
      const c = translations[locale];
      await page.goto(`https://portal.test/connect#request=${requestId}`);
      await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const code = page.locator('wt-input[name=pairingCode] input'); await code.fill('01234567');
      await page.getByRole('button', {name: c.pairInspect, exact: true}).click();
      const approve = page.getByRole('button', {name: c.pairApprove, exact: true}); await approve.click();
      await page.waitForFunction(() => (window as any).app.pairing.error === 'limited');
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 2);
      for (const correction of [-3_600_000, 3_600_000]) {
        await page.evaluate(value => {(window as any).pairingClock.wall = Date.parse('2026-10-31T10:00:00Z') + value; (window as any).app.draw();}, correction);
        assert.equal(await page.evaluate(() => (window as any).app.waiting), 2); assert.equal(await approve.isDisabled(), true);
        assert.equal(await code.inputValue(), '01234567'); assert.equal(writes.length, 1);
      }
      if (process.env.PAIRING_CLOCK_RECEIPT_DIR) {
        await mkdir(process.env.PAIRING_CLOCK_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PAIRING_CLOCK_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      await page.evaluate(() => {(window as any).pairingClock.elapsed = 1_999; (window as any).app.draw();});
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 1); assert.equal(await approve.isDisabled(), true);
      await page.evaluate(() => {(window as any).pairingClock.elapsed = 2_000; (window as any).app.draw();});
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 0); assert.equal(await approve.isEnabled(), true);
      assert.equal(writes.length, 1, 'expiration cannot approve automatically'); await approve.click();
      await page.getByText(c.pairApproved, {exact: true}).waitFor();
      assert.deepEqual(writes, [1, 2].map(() => ({requestId, code: '01234567', organisationId: business.organisationId, legalBusinessId: business.legalBusinessId})));
      await page.evaluate(() => {(window as any).pairingClock.wall -= 7_200_000; (window as any).app.draw();});
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(unexpected, []); assert.deepEqual(pageErrors, []);
    } finally {await browser.close();}
  });
}
