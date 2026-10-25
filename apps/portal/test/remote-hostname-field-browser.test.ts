import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const id = '12345678-1234-4234-8234-123456789abc';
const view = {installationId: id, revision: 1, revoked: false,
  names: {staff: {assigned: 'staff.venue.example', current: 'staff.venue.example'}, public: {assigned: 'venue.example', current: 'venue.example'}},
  service: {state: 'provisioning', health: 'unknown', observedAt: null, validUntil: null}};
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: a malformed hostname is marked beside the field`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(4000);
      const c = translations[locale], dnsRequests: unknown[] = [];
      let dnsStatus = 400;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
        if (endpoint === '/session' || endpoint === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (endpoint === '/installations') return route.fulfill({json: {installations: [{installationId: id, venueId: id, organisationId: id, legalBusinessId: id, environment: 'test', revision: 1, revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
          services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null}))}]}});
        if (endpoint === '/remote-access/status') return route.fulfill({json: view});
        if (endpoint === '/remote-access/dns') {
          dnsRequests.push(request.postDataJSON());
          return route.fulfill({status: dnsStatus, json: {error: dnsStatus === 400 ? 'invalid_hostname' : 'temporarily_unavailable'}});
        }
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.getByRole('button', {name: c.remoteSetup, exact: true}).click();
      const section = page.locator('.remote-setup'), field = section.locator('wt-input[name=remoteHostname]'), input = field.locator('input');
      const review = section.getByRole('button', {name: c.remoteReview, exact: true});
      await input.fill('https://staff.example.es/till'); await review.click();
      await section.getByRole('alert').filter({hasText: c.remoteInvalid}).waitFor();
      assert.deepEqual(dnsRequests, [], 'malformed hostnames never request DNS instructions');
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal(await field.getByText(c.remoteInvalid, {exact: true}).count(), 1);
      assert.equal(await input.evaluate(element => (element as HTMLInputElement).required), true);
      assert.equal(await field.locator('[data-required]').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.REMOTE_HOSTNAME_RECEIPT_DIR) {
        await mkdir(process.env.REMOTE_HOSTNAME_RECEIPT_DIR, {recursive: true});
        await field.scrollIntoViewIfNeeded();
        await page.screenshot({path: `${process.env.REMOTE_HOSTNAME_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      await input.fill('staff.cafe.example');
      assert.equal(await input.getAttribute('aria-invalid'), 'false');
      assert.equal(await field.getByText(c.remoteInvalid, {exact: true}).count(), 0);
      assert.equal(await section.getByRole('alert').count(), 0);
      await review.click();
      await section.getByRole('alert').filter({hasText: c.remoteInvalid}).waitFor();
      assert.equal(await input.getAttribute('aria-invalid'), 'true', 'server hostname refusals mark the same field');
      assert.equal(await field.getByText(c.remoteInvalid, {exact: true}).count(), 1);
      assert.deepEqual(dnsRequests, [{installationId: id, kind: 'staff', hostname: 'staff.cafe.example'}]);
      await input.fill('staff.other.example'); dnsStatus = 503; await review.click();
      await section.getByRole('alert').filter({hasText: c.unavailable}).waitFor();
      assert.equal(await input.getAttribute('aria-invalid'), 'false', 'an outage is not a hostname error');
      assert.equal(await field.getByText(c.remoteInvalid, {exact: true}).count(), 0);
    } finally { await browser.close(); }
  });
}
