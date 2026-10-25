import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
import type {AccountInstallation} from '../src/installation-types.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const checkedAt = '2026-10-24T12:00:00Z', openedAt = '2026-10-24T11:00:00Z', expiresAt = '2026-10-29T12:00:00Z';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: two monitored venues create no repeated regions`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      await page.clock.install({time: new Date('2026-10-24T12:01:00Z')});
      await page.clock.pauseAt(new Date('2026-10-24T12:01:01Z'));
      const c = translations[locale], writes: string[] = [];
      let enabled = true;
      const installations = (): AccountInstallation[] => [1, 2].map(n => ({
        installationId: `00000000-0000-4000-8000-00000000000${n}`,
        venueId: `${n}0000000-0000-4000-8000-000000000000`,
        organisationId: '00000000-0000-4000-8000-000000000010',
        legalBusinessId: '00000000-0000-4000-8000-000000000020',
        environment: 'test', revision: 0, revokedAt: null, lastContactAt: checkedAt,
        leaseExpiresAt: '2026-10-24T12:05:00Z', canRevoke: false,
        overview: {organisationName: 'Café Sol', businessName: 'Sol SL', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null},
        services: (['continuous_backup', 'remote_access', 'retained_snapshots'] as const).map(service => ({
          service, state: 'ready', health: 'healthy', failure: null, observedAt: checkedAt,
        })),
        monitoring: {enabled, fresh: n === 1, checkedAt, incidents: [
          {kind: 'disconnected', openedAt, changedAt: checkedAt},
          {kind: 'public_route_failed', openedAt, changedAt: checkedAt},
          {kind: 'public_certificate_expiring', openedAt, changedAt: checkedAt},
        ], remoteChecks: {
          public: {status: 'failed', checkedAt, certificateNotAfter: expiresAt},
          staff: {status: 'healthy', checkedAt, certificateNotAfter: null},
        }},
      }));
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="portal" class="portal"></div></body></html>'}));
      await page.route('**/api/account/**', route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (route.request().method() !== 'GET' && path !== '/session/activity' && path !== '/usage/read') writes.push(path);
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path === '/installations') return route.fulfill({json: {installations: installations()}});
        if (path === '/usage/read') return route.fulfill({json: {version: 1, organisationId: '00000000-0000-4000-8000-000000000010', storage: {currentBytes: '0', addedBytes: '0', removedBytes: '0'}, transfer: {uploadedBytes: '0', restoredBytes: '0'}, operations: {installationCompleted: '0', monitoringProbes: '0'}, messages: {sent: '0', failed: '0', expired: '0', cancelled: '0'}, latestEventAt: null, measuredThrough: null}});
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
      const venues = page.locator('article.installation');
      await venues.nth(1).getByRole('heading', {name: c.monitoring, exact: true}).waitFor();
      await t.test('monitoring and route groups stay inside each named venue', async () => {
        const counts = [];
        for (const name of [c.monitoring, c.monitorPublic, c.monitorStaff]) {
          counts.push({name, regions: await page.getByRole('region', {name, exact: true}).count(),
            groups: await page.getByRole('group', {name, exact: true}).count()});
        }
        assert.deepEqual(counts, [c.monitoring, c.monitorPublic, c.monitorStaff].map(name => ({name, regions: 0, groups: 2})));
        for (let n = 0; n < 2; n++) {
          const venue = venues.nth(n), monitoring = venue.getByRole('group', {name: c.monitoring, exact: true});
          assert.equal(await venue.getByRole('heading', {name: `Sol SL · ${n + 1}0000000`, exact: true}).count(), 1);
          for (const name of [c.monitorPublic, c.monitorStaff]) assert.equal(await monitoring.getByRole('group', {name, exact: true}).count(), 1);
        }
      });
      await t.test('headings, evidence dates and fresh or unknown warnings remain visible', async () => {
        assert.equal(await venues.count(), 2);
        for (let n = 0; n < 2; n++) {
          const venue = venues.nth(n);
          for (const name of [c.monitoring, c.monitorPublic, c.monitorStaff]) assert.equal(await venue.getByRole('heading', {name, exact: true}).count(), 1);
          for (const text of [c.monitorDisconnected, c.monitorPublicCertificate, n === 0 ? c.monitorPublicFailed : c.monitorPublicUnknown,
            n === 0 ? c.monitorStaffHealthy : c.monitorStaffUnknown]) assert.equal(await venue.getByText(text, {exact: true}).isVisible(), true);
          assert.equal(await venue.getByText(c.monitorUnknown, {exact: true}).count(), n === 0 ? 0 : 1);
          const times = venue.locator('time');
          assert.ok((await times.evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).includes(expiresAt));
          assert.ok((await times.evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).includes(openedAt));
          assert.equal(await times.filter({hasText: locale === 'en' ? 'October 24, 2026' : '24 de octubre de 2026'}).count() > 0, true);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.MONITORING_REGIONS_RECEIPT_DIR) {
          await mkdir(process.env.MONITORING_REGIONS_RECEIPT_DIR, {recursive: true});
          await venues.first().scrollIntoViewIfNeeded();
          await page.screenshot({path: `${process.env.MONITORING_REGIONS_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
        }
        enabled = false;
        await page.getByRole('button', {name: c.refreshStatus, exact: true}).click();
        await venues.nth(1).getByText(c.monitorOff, {exact: true}).waitFor();
        assert.equal(await page.getByRole('heading', {name: c.monitoring, exact: true}).count(), 0);
        assert.equal(await page.getByText(c.monitorOff, {exact: true}).count(), 2);
        assert.deepEqual(writes, []);
      });
    } finally { await browser.close(); }
  });
}
