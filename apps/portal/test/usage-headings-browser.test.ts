import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
import type {AccountInstallation} from '../src/installation-types.ts';

const organisationId = '00000000-0000-4000-8000-000000000010';
const installations: AccountInstallation[] = [1, 2].map(n => ({
  installationId: `00000000-0000-4000-8000-00000000000${n}`,
  venueId: `${n}0000000-0000-4000-8000-000000000000`, organisationId,
  legalBusinessId: '00000000-0000-4000-8000-000000000020',
  environment: 'test', revision: 0, revokedAt: null, lastContactAt: null,
  leaseExpiresAt: null, canRevoke: false,
  services: (['continuous_backup', 'remote_access', 'retained_snapshots'] as const).map(service => ({
    service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null,
  })),
  overview: {organisationName: 'Café Sol', businessName: 'Sol SL', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null},
}));
const summary = {version: 1, organisationId, storage: {currentBytes: '0', addedBytes: '0', removedBytes: '0'},
  transfer: {uploadedBytes: '0', restoredBytes: '0'}, operations: {installationCompleted: '2', monitoringProbes: '0'},
  messages: {sent: '0', failed: '0', expired: '0', cancelled: '0'}, latestEventAt: null, measuredThrough: null};
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: venue headings follow Your venues, usage nests inside it`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="portal" class="portal"></div></body></html>'}));
      await page.route('**/api/account/**', route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path === '/installations') return route.fulfill({json: {installations}});
        if (path === '/usage/read') return route.fulfill({json: summary});
        if (path === '/alerts') return route.fulfill({json: {enabled: false, locale}});
        if (path === '/passkeys') return route.fulfill({json: {passkeys: []}});
        if (path === '/sessions') return route.fulfill({json: {sessions: []}});
        if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: false}});
        if (path === '/translation-consent') return route.fulfill({json: {consents: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.waitForFunction(() => (window as any).app.usage.loaded);
      const c = translations[locale], venues = page.getByRole('region', {name: c.installations, exact: true});
      const usage = venues.getByRole('region', {name: c.usageTitle, exact: true});
      const outline = await venues.getByRole('heading').evaluateAll(nodes => nodes.map(node => ({
        level: Number(node.tagName.slice(1)), name: node.textContent,
      })));
      if (process.env.USAGE_HEADINGS_RECEIPT_DIR) {
        const dir = process.env.USAGE_HEADINGS_RECEIPT_DIR;
        await mkdir(dir, {recursive: true});
        await venues.screenshot({path: `${dir}/${locale}-${theme}-${width}.png`});
        const metrics = await usage.getByRole('heading').evaluateAll(nodes => nodes.map(node => {
          const s = getComputedStyle(node), r = node.getBoundingClientRect();
          return {name: node.textContent, fontSize: s.fontSize, marginTop: s.marginTop, marginBottom: s.marginBottom,
            x: r.x, y: r.y, width: r.width, height: r.height};
        }));
        await writeFile(`${dir}/${locale}-${theme}-${width}.json`, JSON.stringify({outline, metrics}, null, 2));
      }
      assert.deepEqual(outline, [
        {level: 2, name: c.installations}, {level: 3, name: c.usageTitle},
        ...[c.usageStorage, c.usageTransfer, c.usageOperations, c.usageMessages].map(name => ({level: 4, name})),
        {level: 3, name: 'Sol SL · 10000000'}, {level: 3, name: 'Sol SL · 20000000'},
      ]);
      assert.deepEqual(await usage.getByRole('heading').evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        return {fontSize: style.fontSize, marginTop: style.marginTop, marginBottom: style.marginBottom};
      })), [
        {fontSize: '20px', marginTop: '16.6px', marginBottom: '16.6px'},
        ...[0, 1, 2, 3].map(() => ({fontSize: '16.8px', marginTop: '16.8px', marginBottom: '6.4px'})),
      ]);
      for (const name of [c.usageStorage, c.usageTransfer, c.usageOperations, c.usageMessages]) {
        assert.equal(await usage.getByRole('region', {name, exact: true}).getByRole('heading', {level: 4, name, exact: true}).isVisible(), true);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await browser.close(); }
  });
}
