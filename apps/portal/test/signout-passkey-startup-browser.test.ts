import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
import {addVirtualAuthenticator} from './fixtures.ts';

const bundle = await build({stdin: {contents: `
 import {PortalApp} from './src/app.ts';
 window.signoutStartupApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const id = '12345678-1234-4234-8234-123456789abc';

for (const delayed of ['/authenticator', '/installations']) test(`a passkey prompt preserves the ${delayed} startup guard and later sign-out`, async t => {
  const browser = await chromium.launch({headless: true});
  let release!: () => void; let logouts = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      Object.defineProperty(navigator.credentials, 'create', {configurable: true, value: () => {
        (window as unknown as {promptOpen: boolean}).promptOpen = true;
        return new Promise(() => {});
      }});
    });
    const authenticator = await addVirtualAuthenticator(page.context(), page);
    try {
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<div id="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (path === delayed) await held;
        if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path === '/sessions') return route.fulfill({json: {sessions: [{id, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', current: true}]}});
        if (path === '/passkeys') return route.fulfill({json: {passkeys: []}});
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        if (path === '/translation-consent') return route.fulfill({json: {consents: []}});
        if (path === '/alerts') return route.fulfill({json: {enabled: false, locale: 'en'}});
        if (path === '/passkeys/registration/options') return route.fulfill({json: {ceremonyId: id, options: {
          challenge: 'YWJj', rp: {name: 'Waitron Cloud', id: 'portal.test'},
          user: {id: 'b3duZXI', name: 'owner@example.test', displayName: 'Owner'},
          pubKeyCredParams: [{type: 'public-key', alg: -7}],
        }}});
        if (path === '/logout') { logouts++; return route.fulfill({status: 204}); }
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const c = translations.en;
      await page.getByText(c.currentSession, {exact: true}).waitFor();
      await page.waitForFunction(delayed => {
        const app = (window as unknown as {signoutStartupApp: import('../src/app.ts').PortalApp}).signoutStartupApp;
        return delayed === '/authenticator' ? !app.installations.pending : !app.authenticator.pending;
      }, delayed);
      await page.locator('input[name=passkeyPassword]').fill('A real account security password');
      const options = page.waitForResponse('**/passkeys/registration/options');
      await page.getByRole('button', {name: c.passkeyAdd, exact: true}).click();
      assert.equal((await options).status(), 200);
      await page.waitForFunction(() => (window as unknown as {promptOpen: boolean}).promptOpen);
      const state = await page.evaluate(() => {
        const app = (window as unknown as {signoutStartupApp: import('../src/app.ts').PortalApp}).signoutStartupApp;
        return {pending: app.pending, waiting: app.logoutWaiting, pairing: app.pairing.pending, installations: app.installations.pending,
          remote: app.remote.pending, recovery: app.recovery.pending, fiscal: app.fiscal.pending, security: app.security.pending,
          usage: app.usage.pending, authenticator: app.authenticator.pending, passkeys: app.passkeys.pending};
      });
      t.diagnostic(JSON.stringify(state));
      assert.equal(await page.getByRole('button', {name: c.sessionSignOut, exact: true}).isDisabled(), false);
      const signOut = page.getByRole('button', {name: c.signout, exact: true});
      assert.deepEqual(state, {pending: false, waiting: 0, pairing: false, installations: delayed === '/installations',
        remote: false, recovery: false, fiscal: false, security: false, usage: false,
        authenticator: delayed === '/authenticator', passkeys: true}, 'the held startup reply is the only sign-out blocker');
      assert.equal(await signOut.isDisabled(), true, 'startup still guards sign-out while the passkey prompt is open');
      await signOut.evaluate(button => (button as HTMLElement).click());
      await page.evaluate(() => (window as unknown as {signoutStartupApp: import('../src/app.ts').PortalApp}).signoutStartupApp.logout());
      assert.equal(logouts, 0, 'neither the button nor its handler can bypass pending startup');
      const settled = page.waitForResponse('**/api/account' + delayed);
      release(); await (await settled).finished();
      await signOut.and(page.locator(':enabled')).waitFor();
      assert.equal(await page.evaluate(() => (window as unknown as {signoutStartupApp: import('../src/app.ts').PortalApp}).signoutStartupApp.passkeys.pending), true);
      assert.equal(await page.getByRole('button', {name: c.sessionSignOut, exact: true}).isDisabled(), false);
      assert.equal(await signOut.isDisabled(), false, 'the passkey prompt alone does not disable sign-out');
      await signOut.click();
      await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
      assert.equal(logouts, 1);
      assert.equal(await page.evaluate(() => (window as unknown as {signoutStartupApp: import('../src/app.ts').PortalApp}).signoutStartupApp.passkeys.pending), false, 'sign-out fences the unfinished passkey operation');
    } finally { release(); await authenticator.close(); }
  } finally { release(); await browser.close(); }
});
