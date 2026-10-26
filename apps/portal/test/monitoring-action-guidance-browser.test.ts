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
const id = '12345678-1234-4234-8234-123456789abc';
const checkedAt = '2026-10-24T12:00:00Z', expiresAt = '2026-10-29T12:00:00Z';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: monitoring guidance leads to read-only owner checks`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(4000);
      await page.clock.install({time: new Date('2026-10-24T12:01:00Z')});
      await page.clock.pauseAt(new Date('2026-10-24T12:01:01Z'));
      const c = translations[locale], writes: string[] = [], reads: unknown[] = [];
      let condition: 'failed' | 'stale' | 'certificate' | 'healthy' = 'failed';
      const installation = (): AccountInstallation => ({
        installationId: id, venueId: id, organisationId: id, legalBusinessId: id, environment: 'test',
        revision: 1, revokedAt: null, lastContactAt: checkedAt, leaseExpiresAt: null, canRevoke: true,
        services: (['continuous_backup', 'remote_access', 'retained_snapshots'] as const).map(service => ({
          service, state: 'ready', health: 'healthy', failure: null, observedAt: checkedAt,
        })),
        monitoring: {enabled: true, fresh: true, checkedAt, incidents: (['public', 'staff'] as const).flatMap(kind =>
          condition === 'healthy' ? [] : [{kind: `${kind}_${condition === 'failed' ? 'route_failed' : condition === 'stale' ? 'probe_stale' : 'certificate_expiring'}` as const,
            openedAt: checkedAt, changedAt: checkedAt}]),
          remoteChecks: {
            public: {status: condition === 'failed' || condition === 'stale' ? 'failed' : 'healthy', checkedAt,
              certificateNotAfter: condition === 'certificate' ? expiresAt : null},
            staff: condition === 'stale' ? null : {status: condition === 'failed' ? 'failed' : 'healthy', checkedAt,
              certificateNotAfter: condition === 'certificate' ? expiresAt : null},
          }},
      });
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="portal" class="portal"></div></body></html>'}));
      await page.route('**/api/account/**', route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
        if (request.method() !== 'GET' && !['/session/activity', '/usage/read', '/remote-access/status'].includes(endpoint)) writes.push(endpoint);
        if (endpoint === '/session' || endpoint === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (endpoint === '/installations') return route.fulfill({json: {installations: [installation()]}});
        if (endpoint === '/remote-access/status') {
          reads.push(request.postDataJSON());
          return route.fulfill({json: {installationId: id, revision: 1, revoked: false,
            names: {staff: {assigned: 'staff.venue.example', current: 'staff.cafe.example'}, public: {assigned: 'public.venue.example', current: 'cafe.example'}},
            service: {state: 'provisioning', health: 'unknown', observedAt: null, validUntil: null}}});
        }
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const venue = page.locator('article.installation'), monitoring = venue.getByRole('group', {name: c.monitoring, exact: true});
      await monitoring.waitFor();
      for (const scenario of ['failed', 'stale', 'certificate'] as const) await t.test(scenario, async () => {
        condition = scenario;
        const response = page.waitForResponse('**/api/account/installations');
        await page.getByRole('button', {name: c.refreshStatus, exact: true}).last().click();
        await response;
        for (const kind of ['Public', 'Staff'] as const) {
          const group = monitoring.getByRole('group', {name: c[`monitor${kind}`], exact: true});
          const message = group.getByText(c[`monitor${kind}${scenario === 'failed' ? 'Failed' : scenario === 'stale' ? 'Unknown' : 'Certificate'}`], {exact: true});
          await message.waitFor();
          const text = await message.innerText();
          if (scenario === 'stale') {
            assert.ok(text.includes(c.refreshStatus));
            assert.match(text, locale === 'en' ? /does not confirm an outage/ : /no confirma una caída/);
            assert.equal(await group.getByText(c[`monitor${kind}Failed`], {exact: true}).count(), 0);
          } else {
            assert.ok(text.includes(c.remoteSetup));
            assert.match(text, locale === 'en' ? /selected hostname and status/ : /nombre seleccionado y el estado/);
            assert.match(text, locale === 'en' ? /require operator tools/ : /requieren herramientas de operador/);
            if (scenario === 'certificate') {
              assert.ok(text.includes(c.refreshStatus));
              assert.equal(await group.getByText(c[`monitor${kind}Healthy`], {exact: true}).isVisible(), true);
              assert.deepEqual(await group.locator('time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime'))), [checkedAt, expiresAt]);
            }
          }
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.MONITORING_ACTION_RECEIPT_DIR) {
          await mkdir(process.env.MONITORING_ACTION_RECEIPT_DIR, {recursive: true});
          await monitoring.screenshot({path: `${process.env.MONITORING_ACTION_RECEIPT_DIR}/${locale}-${theme}-${width}-${scenario}.png`});
        }
      });
      await t.test('the named setup and refresh controls expose current evidence without changing setup', async () => {
        await venue.getByRole('button', {name: c.remoteSetup, exact: true}).click();
        const remote = venue.locator('.remote-setup');
        await remote.getByText(c.remotePending, {exact: true}).waitFor();
        assert.equal(await remote.getByText('staff.cafe.example', {exact: true}).isVisible(), true);
        assert.equal(await remote.getByText('cafe.example', {exact: true}).isVisible(), true);
        assert.equal(await remote.getByText(c.remoteLocalTrial, {exact: true}).isVisible(), true);
        assert.deepEqual(reads, [{installationId: id}]);
        const response = page.waitForResponse('**/api/account/remote-access/status');
        await remote.getByRole('button', {name: c.refreshStatus, exact: true}).click();
        await response;
        await remote.getByText(c.remotePending, {exact: true}).waitFor();
        assert.deepEqual(reads, [{installationId: id}, {installationId: id}]);
        assert.deepEqual(writes, []);
        if (process.env.MONITORING_ACTION_RECEIPT_DIR) await remote.screenshot({path: `${process.env.MONITORING_ACTION_RECEIPT_DIR}/${locale}-${theme}-${width}-setup.png`});
        condition = 'healthy';
        await remote.getByRole('button', {name: c.remoteClose, exact: true}).click();
        await page.getByRole('button', {name: c.refreshStatus, exact: true}).last().click();
        await monitoring.getByText(c.monitorNoAlerts, {exact: true}).waitFor();
        for (const kind of ['Public', 'Staff'] as const) {
          const group = monitoring.getByRole('group', {name: c[`monitor${kind}`], exact: true});
          assert.equal(await group.getByText(c[`monitor${kind}Healthy`], {exact: true}).isVisible(), true);
          assert.equal(await group.getByText(c[`monitor${kind}Certificate`], {exact: true}).count(), 0);
        }
        assert.deepEqual(writes, []);
      });
    } finally { await browser.close(); }
  });
}
