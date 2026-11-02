import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const id = '10000000-0000-4000-8000-000000000001';
const stamp = '2026-11-02T10:00:00.000Z', expiry = '2099-01-01T00:00:00.000Z';
const installation = {installationId: id, venueId: id, organisationId: id, legalBusinessId: id, environment: 'test',
  revision: 0, revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
  overview: {organisationName: 'Café Sol', businessName: 'Sol SL', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null},
  services: ['remote_access', 'continuous_backup', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', observedAt: null}))};
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
for (const panel of ['installations', 'diagnostics', 'remote', 'recovery', 'translationConsent'] as const)
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${panel} ${locale} ${theme} ${width}: expired retry does not return after wall-clock rollback`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}}); page.setDefaultTimeout(4000);
      await page.addInitScript(() => {
        const clock = {wall: Date.parse('2026-11-02T10:00:00Z'), elapsed: 0};
        (window as any).panelClock = clock; Date.now = () => clock.wall; performance.now = () => clock.elapsed;
      });
      let armed = false, attempts = 0;
      const unexpected: string[] = [], pageErrors: string[] = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.route('https://portal.test/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith('/api/')) return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
        const target = panel === 'installations' ? '/installations' : panel === 'diagnostics' ? '/diagnostics/read'
          : panel === 'remote' ? '/remote-access/status' : panel === 'recovery' ? '/recovery/inspect' : '/translation-consent';
        if (armed && path === '/api/account' + target) {
          attempts++;
          return route.fulfill({status: 429, headers: attempts === 1 ? {'Retry-After': '2'} : {}, json: {error: 'rate_limited'}});
        }
        if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill({json: {accountId: 'owner', expiresAt: expiry}});
        if (path.endsWith('/installations')) return route.fulfill({json: {installations: [installation]}});
        if (path.endsWith('/authenticator')) return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (path.endsWith('/passkeys')) return route.fulfill({json: {passkeys: []}});
        if (path.endsWith('/sessions')) return route.fulfill({json: {sessions: [{id, current: true, createdAt: stamp, lastUsedAt: stamp, expiresAt: expiry}]}});
        if (path.endsWith('/alerts')) return route.fulfill({json: {enabled: false, locale}});
        if (path.endsWith('/translation-consent')) return route.fulfill({json: {consents: []}});
        if (path.endsWith('/usage/read')) return route.fulfill({json: {version: 1, organisationId: id,
          storage: {currentBytes: '0', addedBytes: '0', removedBytes: '0'}, transfer: {uploadedBytes: '0', restoredBytes: '0'},
          operations: {installationCompleted: '0', monitoringProbes: '0'}, messages: {sent: '0', failed: '0', expired: '0', cancelled: '0'}, latestEventAt: null, measuredThrough: null}});
        unexpected.push(path); return route.fulfill({status: 500, json: {error: 'unplanned_request'}});
      });
      await page.goto(`https://portal.test/${panel === 'recovery' ? 'recover#request=' + id : 'account'}`);
      await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.waitForFunction(() => (window as any).app.installations.loaded);
      if (panel === 'translationConsent') await page.waitForFunction(() => (window as any).app.translationConsent.loaded);
      const c = translations[locale]; armed = true;
      let retry = page.getByRole('button', {name: c.refreshStatus, exact: true});
      if (panel === 'diagnostics') retry = page.getByRole('button', {name: c.diagnosticDownload, exact: true});
      if (panel === 'translationConsent') retry = page.getByRole('button', {name: c.translationConsentAgree, exact: true});
      if (panel === 'recovery') {
        await page.locator('wt-input[name=recoveryCode] input').fill('01234567');
        retry = page.getByRole('button', {name: c.pairInspect, exact: true});
      }
      if (panel === 'remote') {
        await page.getByRole('button', {name: c.remoteSetup, exact: true}).click();
        retry = page.getByRole('region', {name: c.remoteSetupTitle, exact: true}).getByRole('button', {name: c.refreshStatus, exact: true});
      } else await retry.click();
      await page.waitForFunction(name => (window as any).app[name].error === 'limited', panel);
      assert.equal(attempts, 1); assert.equal(await retry.isDisabled(), true);
      assert.equal(await page.evaluate(name => (window as any).app[name].waiting, panel), 2);
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 2);
      assert.equal(await retry.isDisabled(), true);
      await page.evaluate(() => {(window as any).panelClock.elapsed = 1_999; (window as any).panelClock.wall += 1_999; (window as any).app.draw();});
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 1); assert.equal(await retry.isDisabled(), true);
      await page.evaluate(() => {(window as any).panelClock.elapsed = 2_000; (window as any).panelClock.wall += 1; (window as any).app.draw();});
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 0); assert.equal(await retry.isEnabled(), true);
      await page.evaluate(() => {(window as any).panelClock.wall -= 7_200_000; (window as any).app.draw();});
      assert.equal(await page.evaluate(name => (window as any).app[name].waiting, panel), 0);
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 0); assert.equal(await retry.isEnabled(), true);
      assert.equal(attempts, 1, 'clock changes and expiry cannot retry automatically');
      if (process.env.PANEL_CLOCK_RECEIPT_DIR) {
        await mkdir(process.env.PANEL_CLOCK_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PANEL_CLOCK_RECEIPT_DIR}/${panel}-${locale}-${theme}-${width}.png`, fullPage: true});
      }
      await retry.click(); await page.waitForFunction(name => !(window as any).app[name].pending, panel);
      assert.equal(attempts, 2); assert.equal(await page.evaluate(() => (window as any).app.waiting), 0);
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(unexpected, []); assert.deepEqual(pageErrors, []);
    } finally {await browser.close();}
  });
}
