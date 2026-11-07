import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {PortalApp} from './src/app.ts';
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const id = '12345678-1234-4234-8234-123456789abc';
const session = {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'};
const names = {staff: {assigned: 'staff.venue.example', current: 'staff.venue.example'},
  public: {assigned: 'venue.example', current: 'venue.example'}};
const view = {installationId: id, revision: 1, revoked: false, names,
  service: {state: 'provisioning', health: 'unknown', observedAt: null, validUntil: null}};

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: hostname Enter counts as session activity without applying`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(3000);
      let activity = 0;
      const dns: unknown[] = [], apply: unknown[] = [];
      await page.clock.install();
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const endpoint = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (endpoint === '/session/activity') {activity++; return route.fulfill({json: session});}
        if (endpoint === '/session') return route.fulfill({json: session});
        if (endpoint === '/installations') return route.fulfill({json: {installations: [{installationId: id,
          venueId: id, organisationId: id, legalBusinessId: id, environment: 'test', revision: 1, revokedAt: null,
          lastContactAt: null, leaseExpiresAt: null, canRevoke: true, services: ['continuous_backup', 'remote_access', 'retained_snapshots']
            .map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null}))}]}});
        if (endpoint === '/remote-access/status') return route.fulfill({json: view});
        if (endpoint === '/remote-access/dns') {
          dns.push(route.request().postDataJSON());
          return route.fulfill({json: {installationId: id, kind: 'staff', hostname: 'cafe.example', records: [
            {type: 'CNAME', name: 'cafe.example', value: 'staff.venue.example'},
            {type: 'CNAME', name: '_acme-challenge.cafe.example', value: '_acme-challenge.staff.venue.example'}]}});
        }
        if (endpoint === '/remote-access/apply') apply.push(route.request().postDataJSON());
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account');
      await page.evaluate(() => {
        const observed = window as typeof window & {sessionActivityCalls: number};
        observed.sessionActivityCalls = 0;
        const fetch = window.fetch.bind(window);
        window.fetch = (...args: Parameters<typeof window.fetch>) => {
          const input = args[0], url = input instanceof Request ? input.url : String(input);
          if (new URL(url, location.href).pathname === '/api/account/session/activity') observed.sessionActivityCalls++;
          return fetch(...args);
        };
      });
      const activityCalls = () => page.evaluate(() => (window as typeof window & {sessionActivityCalls: number}).sessionActivityCalls);
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const clicked = page.waitForResponse('**/api/account/session/activity');
      await page.getByRole('button', {name: translations[locale].remoteSetup, exact: true}).click();
      await (await clicked).finished();
      const input = page.locator('.remote-setup wt-input[name=remoteHostname] input');
      await input.fill('cafe.example');
      await page.clock.fastForward(60_001);
      const before = activity;
      const callsBefore = await activityCalls();
      await input.dispatchEvent('keydown', {key: 'ArrowLeft'});
      assert.equal(await activityCalls(), callsBefore, 'synthetic keys cannot start session activity');
      assert.equal(activity, before, 'synthetic keys cannot renew the session');
      await input.press('Enter');
      await page.getByRole('group', {name: translations[locale].remoteConfirmTitle, exact: true}).waitFor();
      await t.waitFor(() => assert.equal(activity, before + 1, 'a trusted Enter must reach session activity'), {timeout: 3000})
        .finally(() => t.diagnostic(JSON.stringify({activityBefore: before, activityAfterEnter: activity, dnsReviews: dns.length})));
      assert.deepEqual(dns, [{installationId: id, kind: 'staff', hostname: 'cafe.example'}]);
      assert.deepEqual(apply, [], 'session activity never confirms a hostname change');
      await input.press('ArrowLeft');
      assert.equal(activity, before + 1, 'trusted keys retain the one-minute activity limit');
      await page.clock.fastForward(60_001);
      await input.press('ArrowRight');
      await t.waitFor(() => assert.equal(activity, before + 2, 'ordinary trusted keys still reach session activity'), {timeout: 3000});
      assert.equal(dns.length, 1);
      assert.deepEqual(apply, []);
    } finally {await browser.close();}
  });
}
