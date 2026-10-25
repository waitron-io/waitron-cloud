import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const ids = ['3f9c2a71-0000-4000-8000-000000000001', 'b84e0d39-0000-4000-8000-000000000002', 'ca31e2f4-0000-4000-8000-000000000003'];
const installations = ids.map((venueId, index) => ({
  installationId: venueId, venueId, organisationId: '20000000-0000-4000-8000-000000000001',
  legalBusinessId: '20000000-0000-4000-8000-000000000002', environment: index ? 'production' : 'test',
  revision: 0, revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
  overview: {organisationName: 'Restaurantes Pepe SL', businessName: 'Restaurantes Pepe SL', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null},
  services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null})),
}));
const labels = {
  en: ['Restaurantes Pepe SL · Preproduction · 3f9c2a71', 'Restaurantes Pepe SL · Production · b84e0d39', 'Restaurantes Pepe SL · Production · ca31e2f4'],
  es: ['Restaurantes Pepe SL · Preproducción · 3f9c2a71', 'Restaurantes Pepe SL · Producción · b84e0d39', 'Restaurantes Pepe SL · Producción · ca31e2f4'],
};
const bundle = await build({stdin: {contents: `
  import {applyTokens} from '@waitron-io/ui-core/tokens';
  import {PortalApp} from './src/app.ts';
  applyTokens(document.body);
  window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: venues of one business are told apart`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(2000);
      const writes: unknown[] = [];
      await page.route('https://portal.test/fiscal-allocations', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill({json: {accountId: 'owner', expiresAt: new Date(Date.now() + 3600000).toISOString()}});
        if (path.endsWith('/installations')) return route.fulfill({json: {installations}});
        if (path.endsWith('/fiscal-allocations/list')) return route.fulfill({json: {version: 1, items: [], nextCursor: null}});
        if (path.endsWith('/usage/read')) return route.fulfill({status: 503, json: {error: 'unavailable'}});
        if (route.request().method() === 'POST') writes.push(route.request().postDataJSON());
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/fiscal-allocations');
      await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.waitForFunction(() => (window as any).app.installations.loaded);
      const venue = page.getByLabel(translations[locale].fiscalVenue, {exact: true});
      await t.test('business, translated environment and short id distinguish every option', async () => {
        assert.deepEqual(await venue.locator('option').allTextContents(), [translations[locale].recoveryChooseVenue, ...labels[locale]]);
        assert.deepEqual(await venue.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ['', ...ids]);
        assert.equal(await venue.inputValue(), ''); assert.deepEqual(writes, []);
      });
      for (const [index, id] of ids.entries()) await t.test(`choosing ${id} keeps its full id and fiscal environment`, async () => {
        await venue.selectOption(id);
        await page.waitForFunction(() => !(window as any).app.fiscal.pending);
        assert.equal(await venue.inputValue(), id);
        assert.equal(await venue.locator('option:checked').textContent(), labels[locale][index]);
        assert.deepEqual(await page.evaluate(() => {
          const f = (window as any).app.fiscal;
          return {venueId: f.venueId, draftVenueId: f.selection.venueId, environment: f.selection.scope.environment};
        }), {venueId: id, draftVenueId: id, environment: index ? 'production' : 'preproduction'});
        assert.equal(await page.evaluate(() => (window as any).app.fiscal.error), undefined);
        assert.deepEqual(writes, []);
      });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.FISCAL_PORTAL_RECEIPT_DIR) {
        await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.FISCAL_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-labels.png`, fullPage: true});
      }
    } finally {await browser.close();}
  });
}
