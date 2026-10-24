import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.startupApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const renewedExpiry = '2099-02-01T00:00:00Z';
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: late session activity preserves a refused passkey addition`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      for (const path of ['/', '/account']) await t.test(path, async () => {
        const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
        page.setDefaultTimeout(4000);
        let releaseActivity!: () => void;
        const activityReply = new Promise<void>(resolve => { releaseActivity = resolve; });
        let lists = 0, additions = 0;
        try {
          const authenticator = await page.context().newCDPSession(page);
          await authenticator.send('WebAuthn.enable');
          await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {
            protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
            isUserVerified: true, automaticPresenceSimulation: true,
          }});
          await page.route('https://portal.test' + path, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><div id="portal"></div>'}));
          await page.route('**/api/account/**', async route => {
            const endpoint = new URL(route.request().url()).pathname;
            if (endpoint.endsWith('/session/activity')) {
              await activityReply;
              return route.fulfill({json: {accountId: 'owner', expiresAt: renewedExpiry}});
            }
            if (endpoint.endsWith('/session')) return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
            if (endpoint.endsWith('/passkeys')) { lists++; return route.fulfill({json: {passkeys: []}}); }
            if (endpoint.endsWith('/passkeys/registration/options')) {
              additions++;
              assert.deepEqual(route.request().postDataJSON(), {password: 'An incorrect account password'});
              return route.fulfill({status: 403, json: {error: 'credentials_invalid'}});
            }
            if (endpoint.endsWith('/installations')) return route.fulfill({json: {installations: []}});
            return route.fulfill({status: 503, json: {error: 'unavailable'}});
          });
          await page.goto('https://portal.test' + path);
          await page.addScriptTag({content: bundle.outputFiles[0]!.text});
          const c = translations[locale];
          await page.locator('input[name=passkeyPassword]').fill('An incorrect account password');
          const activity = page.waitForRequest('**/api/account/session/activity');
          await page.getByRole('button', {name: c.passkeyAdd, exact: true}).click();
          await activity;
          const alert = page.locator('.passkeys').getByRole('alert').filter({hasText: c.passkeyPasswordInvalid});
          await alert.waitFor();
          releaseActivity();
          await page.waitForFunction(expiry => {
            const app = (window as unknown as {startupApp: {session: {state: {expiresAt?: string}}; passkeys: {pending: boolean}}}).startupApp;
            return app.session.state.expiresAt === expiry && !app.passkeys.pending;
          }, renewedExpiry);
          await alert.waitFor();
          assert.equal(await page.getByRole('alert').filter({hasText: c.passkeyPasswordInvalid}).count(), 1);
          assert.equal(lists, 1, 'a completed startup list is not restarted by session activity');
          assert.equal(additions, 1, 'the wrong-password attempt is not repeated');
          assert.equal(new URL(page.url()).pathname, '/account');
        } finally { releaseActivity(); await page.close(); }
      });
    } finally { await browser.close(); }
  });
}
