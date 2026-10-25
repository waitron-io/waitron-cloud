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
const dns = {installationId: id, kind: 'staff', hostname: 'staff.cafe.example', records: [
  {type: 'CNAME', name: 'staff.cafe.example', value: 'staff.venue.example'},
  {type: 'CNAME', name: '_acme-challenge.staff.cafe.example', value: '_acme-challenge.staff.venue.example'}]};

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: Enter in the hostname field reviews it without applying`, async () => {
    const browser = await chromium.launch({headless: true});
    let releaseDns = () => {};
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(3000);
      const c = translations[locale], dnsRequests: unknown[] = [], applyRequests: unknown[] = [];
      let limited = false;
      const dnsHeld = new Promise<void>(resolve => {releaseDns = resolve;});
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
        if (endpoint === '/session' || endpoint === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (endpoint === '/installations') return route.fulfill({json: {installations: [{installationId: id, venueId: id, organisationId: id, legalBusinessId: id, environment: 'test', revision: 1, revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
          services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null}))}]}});
        if (endpoint === '/remote-access/status') return route.fulfill({json: view});
        if (endpoint === '/remote-access/dns') {
          dnsRequests.push(request.postDataJSON());
          if (limited) return route.fulfill({status: 429, headers: {'Retry-After': '60'}, json: {error: 'rate_limited'}});
          await dnsHeld;
          return route.fulfill({json: dns});
        }
        if (endpoint === '/remote-access/apply') {
          applyRequests.push(request.postDataJSON());
          return route.fulfill({json: {...view, revision: 2, names: {...view.names, staff: {...view.names.staff, current: dns.hostname}}}});
        }
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.getByRole('button', {name: c.remoteSetup, exact: true}).click();
      const section = page.locator('.remote-setup'), field = section.locator('wt-input[name=remoteHostname]'), input = field.locator('input');
      const review = section.getByRole('button', {name: c.remoteReview, exact: true});
      const confirmation = section.getByRole('group', {name: c.remoteConfirmTitle, exact: true});
      await input.fill('staff.cafe.example');
      await Promise.all([page.waitForRequest(request => request.url().endsWith('/remote-access/dns')), input.press('Enter')]);
      assert.deepEqual(dnsRequests, [{installationId: id, kind: 'staff', hostname: 'staff.cafe.example'}]);
      assert.equal(await input.isDisabled(), true);
      await input.dispatchEvent('keydown', {key: 'Enter'});
      assert.equal(dnsRequests.length, 1, 'Enter cannot repeat a pending review');
      assert.deepEqual(applyRequests, []);
      releaseDns();
      await confirmation.waitFor();
      await confirmation.getByText('_acme-challenge.staff.cafe.example', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.REMOTE_ENTER_RECEIPT_DIR) {
        await mkdir(process.env.REMOTE_ENTER_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.REMOTE_ENTER_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      await Promise.all([page.waitForResponse(response => response.url().endsWith('/remote-access/dns')), input.press('Enter')]);
      await confirmation.waitFor();
      assert.equal(dnsRequests.length, 2, 'Enter still reviews when confirmation is visible');
      assert.deepEqual(applyRequests, [], 'Enter never applies a reviewed change');
      await confirmation.getByRole('button', {name: c.remoteConfirm, exact: true}).click();
      await section.getByText(c.remoteSaved, {exact: true}).waitFor();
      assert.deepEqual(applyRequests, [{installationId: id, kind: 'staff', hostname: 'staff.cafe.example', expectedRevision: '1'}]);
      await input.fill('https://staff.example.es/path'); await input.press('Enter');
      await field.getByText(c.remoteInvalid, {exact: true}).waitFor();
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal(dnsRequests.length, 2, 'malformed input is refused before DNS');
      assert.equal(await confirmation.count(), 0);
      limited = true;
      await input.fill('staff.cafe.example'); await input.press('Enter');
      await section.getByRole('alert').filter({hasText: c.limited}).waitFor();
      assert.equal(await input.isDisabled(), true);
      assert.equal(await review.isDisabled(), true);
      await input.dispatchEvent('keydown', {key: 'Enter'});
      assert.equal(dnsRequests.length, 3, 'Enter cannot bypass a server wait');
      assert.equal(applyRequests.length, 1);
    } finally { releaseDns(); await browser.close(); }
  });
}
