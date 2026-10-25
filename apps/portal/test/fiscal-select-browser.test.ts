import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { reserve } from '../../../packages/fiscal-allocation/test/fixtures.ts';
import { translations } from '../src/locale.ts';

const first = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const input = { ...reserve(), mode: 'initial-setup' as const };
const bundle = await build({ stdin: { contents: `
  import { render } from 'lit';
  import { applyTokens } from '@waitron-io/ui-core/tokens';
  import '@waitron-io/ui-core/components/wt-input';
  import '@waitron-io/ui-core/components/wt-button';
  import { fiscalAllocationScreen } from './src/fiscal-allocation-screen.ts';
  import { FiscalAllocationController } from './src/fiscal-allocation-controller.ts';
  import { InstallationController } from './src/installation-controller.ts';
  import { translations } from './src/locale.ts';
  applyTokens(document.body);
  window.mount = (locale, input, first, second) => {
    const app = { copy: translations[locale], session: { state: { kind: 'authenticated' } },
      draw() { render(fiscalAllocationScreen(app), document.querySelector('#portal')); } };
    app.installations = new InstallationController(() => app.draw());
    app.installations.installations = [first, second].map((id, index) => ({
      installationId: id, venueId: index ? input.venueId : id, organisationId: id, legalBusinessId: id,
      environment: 'test', revision: 0, revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
      overview: { organisationName: index ? 'Z supplied organisation' : 'A first organisation',
        businessName: index ? 'Supplied venue' : 'First venue', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null },
      services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null})),
    }));
    app.installations.selectedOrganisation = second;
    app.fiscal = new FiscalAllocationController(() => app.draw());
    app.fiscal.account('owner');
    app.fiscal.open(input.venueId);
    app.fiscal.choose(input);
    app.draw();
    window.app = app;
  };
`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'iife', target: 'es2023' });
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: supplied fiscal selectors match the untouched request and subsequent edits`, async t => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ locale, colorScheme: theme, viewport: { width, height: 900 } });
      await page.route('https://portal.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="portal" class="portal"></div>' }));
      const sent: unknown[] = [];
      await page.route('**/api/account/fiscal-allocations/*', route => {
        if (route.request().url().endsWith('/reserve')) sent.push(route.request().postDataJSON());
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'continuity_unavailable' }) });
      });
      await page.goto('https://portal.test/');
      await page.addStyleTag({ content: styles });
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.evaluate(({ locale, input, first, second }) => (window as any).mount(locale, input, first, second), { locale, input, first, second });
      const c = translations[locale], organisation = page.getByLabel(c.recoveryOrganisation, { exact: true }), venue = page.getByLabel(c.fiscalVenue, { exact: true }), mode = page.getByLabel(c.fiscalMode, { exact: true });
      await t.test('organisation shows the supplied second organisation', async () => {
        assert.equal(await organisation.inputValue(), second);
        assert.equal(await organisation.locator('option:checked').textContent(), 'Z supplied organisation');
      });
      await t.test('venue shows the supplied venue on first render', async () => {
        assert.equal(await venue.inputValue(), input.venueId);
        assert.equal(await venue.locator('option:checked').textContent(), locale === 'en' ? 'Supplied venue · Preproduction · 10000000' : 'Supplied venue · Preproducción · 10000000');
      });
      await t.test('mode shows initial setup on first render', async () => {
        assert.equal(await mode.inputValue(), 'initial-setup');
        assert.equal(await mode.locator('option:checked').textContent(), c.fiscalSetup);
      });
      await page.evaluate(() => { (window as any).app.waiting = true; (window as any).app.draw(); });
      for (const [selector, expected] of [[organisation, second], [venue, input.venueId], [mode, 'initial-setup']] as const) {
        assert.equal(await selector.isDisabled(), true);
        assert.equal(await selector.inputValue(), expected);
      }
      await page.evaluate(() => { (window as any).app.waiting = false; (window as any).app.draw(); });
      if (process.env.FISCAL_PORTAL_RECEIPT_DIR) {
        await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.FISCAL_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-selectors.png`, fullPage: true });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('button', { name: c.fiscalReserve, exact: true }).click();
      await page.waitForFunction(() => !(window as any).app.fiscal.pending);
      assert.deepEqual(sent, [input]);
      await mode.selectOption('recovery');
      await page.evaluate(() => (window as any).app.draw());
      assert.equal(await mode.inputValue(), 'recovery');
      assert.equal(await page.evaluate(() => (window as any).app.fiscal.selection.mode), 'recovery');
      await mode.selectOption('initial-setup');
      assert.equal(await mode.inputValue(), 'initial-setup');
      assert.equal(await page.evaluate(() => (window as any).app.fiscal.selection.mode), 'initial-setup');
      await organisation.selectOption(first);
      assert.equal(await organisation.inputValue(), first);
      assert.equal(await venue.inputValue(), '');
      assert.equal(await mode.count(), 0);
      assert.equal(await venue.locator(`option[value="${input.venueId}"]`).count(), 0);
      await venue.selectOption(first);
      await page.waitForFunction(() => !(window as any).app.fiscal.pending);
      await page.evaluate(() => (window as any).app.draw());
      assert.equal(await venue.inputValue(), first);
      assert.equal(await mode.inputValue(), 'recovery');
      assert.equal(await page.evaluate(() => (window as any).app.fiscal.selection.venueId), first);
      await venue.selectOption('');
      assert.equal(await venue.inputValue(), '');
      assert.equal(await page.evaluate(() => (window as any).app.fiscal.venueId), undefined);
      assert.equal(await page.evaluate(() => (window as any).app.fiscal.selection), undefined);
      assert.equal(await mode.count(), 0);
    } finally { await browser.close(); }
  });
}
