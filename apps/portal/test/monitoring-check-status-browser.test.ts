import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
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

for (const setupDelay of [0, 1100])
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}${setupDelay ? ' with delayed clock setup' : ''}: pass or fail follows the latest check status`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      // The clock runs after installation; freeze before registering application timers.
      await page.clock.install({time: new Date('2026-10-23T12:01:01Z')});
      if (setupDelay) await delay(setupDelay);
      await page.clock.pauseAt(new Date('2026-10-24T12:01:01Z'));
      const c = translations[locale], writes: string[] = [];
      let fresh = true, monitorCheckedAt: string | null = checkedAt;
      let staffStatus: 'healthy' | 'failed' = 'failed';
      let status: 'healthy' | 'failed' = 'failed', incident = false, stale = false, missing = false;
      const installations = (): AccountInstallation[] => [1].map(n => ({
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
        monitoring: {enabled: true, fresh, checkedAt: monitorCheckedAt, incidents: (['public', 'staff'] as const).flatMap(kind => [
          ...(incident ? [{kind: `${kind}_route_failed` as const, openedAt, changedAt: checkedAt}] : []),
          ...(stale ? [{kind: `${kind}_probe_stale` as const, openedAt, changedAt: checkedAt}] : []),
          {kind: `${kind}_certificate_expiring` as const, openedAt, changedAt: checkedAt},
        ]), remoteChecks: {
          public: missing ? null : {status, checkedAt, certificateNotAfter: expiresAt},
          staff: missing ? null : {status: staffStatus, checkedAt, certificateNotAfter: expiresAt},
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
      const monitoring = page.getByRole('group', {name: c.monitoring, exact: true});
      await monitoring.waitFor();
      const cases = [
        {name: 'failed before an incident opens', status: 'failed', incident: false, want: 'Failed'},
        {name: 'healthy before an incident closes', status: 'healthy', incident: true, want: 'Healthy'},
        {name: 'failed with an incident', status: 'failed', incident: true, want: 'Failed'},
        {name: 'healthy without an incident', status: 'healthy', incident: false, want: 'Healthy'},
        {name: 'failed public with recovered staff', status: 'failed', incident: true, staffStatus: 'healthy', want: 'Failed', staffWant: 'Healthy'},
        {name: 'healthy public with failed staff', status: 'healthy', incident: false, staffStatus: 'failed', want: 'Healthy', staffWant: 'Failed'},
        {name: 'probe stale', status: 'failed', incident: false, stale: true, want: 'Unknown'},
        {name: 'missing check', status: 'failed', incident: true, missing: true, want: 'Unknown'},
        {name: 'monitor not fresh', status: 'healthy', incident: false, fresh: false, want: 'Unknown'},
        {name: 'monitor date expired', status: 'healthy', incident: true, date: '2026-10-24T11:00:00Z', want: 'Unknown'},
        {name: 'monitor date missing', status: 'failed', incident: false, date: null, want: 'Unknown'},
      ] as const;
      for (const scenario of cases) await t.test(scenario.name, async () => {
        status = scenario.status; incident = scenario.incident;
        staffStatus = 'staffStatus' in scenario ? scenario.staffStatus : status;
        stale = 'stale' in scenario; missing = 'missing' in scenario;
        fresh = !('fresh' in scenario); monitorCheckedAt = 'date' in scenario ? scenario.date : checkedAt;
        const response = page.waitForResponse('**/api/account/installations');
        await page.getByRole('button', {name: c.refreshStatus, exact: true}).click();
        await response;
        for (const kind of ['Public', 'Staff'] as const) {
          const want = kind === 'Staff' && 'staffWant' in scenario ? scenario.staffWant : scenario.want;
          const group = monitoring.getByRole('group', {name: c[`monitor${kind}`], exact: true});
          await group.getByText(c[`monitor${kind}${want}`], {exact: true}).waitFor();
          for (const other of ['Healthy', 'Failed', 'Unknown'] as const) {
            assert.equal(await group.getByText(c[`monitor${kind}${other}`], {exact: true}).count(), other === want ? 1 : 0);
          }
          assert.equal(await group.getByText(c[`monitor${kind}Certificate`], {exact: true}).isVisible(), true);
          assert.deepEqual(await group.locator('time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime'))), missing ? [] : [checkedAt, expiresAt]);
        }
        assert.deepEqual(writes, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.MONITORING_CHECK_RECEIPT_DIR && scenario.name === 'failed before an incident opens') {
          await mkdir(process.env.MONITORING_CHECK_RECEIPT_DIR, {recursive: true});
          await monitoring.scrollIntoViewIfNeeded();
          await page.screenshot({path: `${process.env.MONITORING_CHECK_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
        }
      });
    } finally { await browser.close(); }
  });
}
