import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {addVirtualAuthenticator} from './fixtures.ts';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.preferenceApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const id = '12345678-1234-4234-8234-123456789abc';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: remember verified passkeys on return and keep password fallback`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(4000);
      await page.addInitScript(() => {
        const state = window as unknown as {autofillSignal?: AbortSignal; autofillSettled: boolean};
        const get = navigator.credentials.get.bind(navigator.credentials);
        Object.defineProperty(navigator.credentials, 'get', {value: (options: CredentialRequestOptions) => {
          if (String(options.mediation) !== 'conditional') return get(options);
          state.autofillSignal = options.signal; state.autofillSettled = false;
          return get(options).finally(() => {state.autofillSettled = true;});
        }});
      });
      const authenticator = await addVirtualAuthenticator(page.context(), page);
      let signedIn = false, optionRequests = 0, verifications = 0;
      let releaseVerify!: () => void;
      const verifiedReply = new Promise<void>(resolve => {releaseVerify = resolve;});
      let holdVerify = true;
      await page.route('https://portal.test/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (!route.request().url().includes('/api/account/')) return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
        if (path === '/session') return route.fulfill(signedIn ? {json: {accountId: 'owner', expiresAt: new Date(Date.now() + 3600000).toISOString()}} : {status: 401, json: {error: 'session_invalid'}});
        if (path === '/passkeys/authentication/options') {optionRequests++; return route.fulfill({json: {ceremonyId: id, options: {challenge: 'YWJj', rpId: 'portal.test', userVerification: 'required'}}});}
        if (path === '/passkeys/authentication/verify') {verifications++; signedIn = true; if (holdVerify) await verifiedReply; return route.fulfill({json: {accountId: 'owner'}});}
        if (path === '/login') {signedIn = true; return route.fulfill({json: {accountId: 'owner'}});}
        if (path === '/logout') {signedIn = false; return route.fulfill({status: 204});}
        if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (path === '/passkeys') return route.fulfill({json: {passkeys: []}});
        if (path === '/sessions') return route.fulfill({json: {sessions: []}});
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      const open = async () => {
        await page.goto('about:blank');
        await page.goto(`https://portal.test/login#lang=${locale}`);
        await page.addStyleTag({content: styles});
        await page.addScriptTag({content: bundle.outputFiles[0]!.text});
        await page.getByRole('button', {name: translations[locale].passkeySignIn, exact: true}).waitFor();
      };
      const c = translations[locale];
      await open();
      await page.evaluate(async () => {
        await navigator.credentials.create({publicKey: {challenge: new Uint8Array([1, 2, 3]), rp: {name: 'Waitron Cloud', id: 'portal.test'},
          user: {id: new Uint8Array([1]), name: 'owner@example.test', displayName: 'Owner'}, pubKeyCredParams: [{type: 'public-key', alg: -7}],
          authenticatorSelection: {residentKey: 'required', userVerification: 'required'}}});
      });
      const remember = page.getByRole('checkbox', {name: c.passkeyRemember, exact: true});
      assert.equal(await remember.count(), 1, 'sign-in offers a preference checkbox');
      assert.ok((await remember.boundingBox())!.y > (await page.locator('.passkey-signin .separator').boundingBox())!.y, 'the preference belongs inside the passkey section');
      if (process.env.PASSKEY_PREFERENCE_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_PREFERENCE_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PASSKEY_PREFERENCE_RECEIPT_DIR}/first-${locale}-${theme}-${width}.png`});
      }
      await remember.check();
      assert.equal(await page.evaluate(() => localStorage.getItem('cloud.passkeyFirst')), null, 'checking alone is not proof');
      const verifying = page.waitForRequest('**/passkeys/authentication/verify');
      await page.getByRole('button', {name: c.passkeySignIn, exact: true}).click();
      await verifying;
      assert.equal(await page.getByRole('button', {name: c.login, exact: true}).isDisabled(), true, 'password submit waits for an accepted passkey reply');
      await page.evaluate(() => (window as unknown as {preferenceApp: import('../src/app.ts').PortalApp}).preferenceApp.submit());
      assert.equal(await page.evaluate(() => (window as unknown as {preferenceApp: import('../src/app.ts').PortalApp}).preferenceApp.passkeys.pending), true);
      holdVerify = false; releaseVerify();
      await page.getByText(c.accountIntro, {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('cloud.passkeyFirst')), 'true');
      signedIn = false;
      const completed = verifications;
      await open();
      await page.getByText(c.accountIntro, {exact: true}).waitFor();
      assert.equal(verifications, completed + 1, 'returning autofill completes verification without an explicit button click');
      signedIn = false;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {authenticatorId: authenticator.authenticatorId, enabled: false});
      const before = optionRequests;
      await open();
      await page.waitForFunction(() => (window as unknown as {preferenceApp: import('../src/app.ts').PortalApp}).preferenceApp.session.state.kind === 'anonymous');
      await t.waitFor(() => assert.ok(optionRequests > before, 'returning visits offer browser passkey autofill'), {timeout: 4000});
      assert.equal(await remember.isChecked(), true);
      const email = page.locator('input[name=email]');
      assert.equal(await email.getAttribute('autocomplete'), 'username webauthn');
      const passkeyButton = page.getByRole('button', {name: c.passkeySignIn, exact: true});
      assert.equal(await passkeyButton.isDisabled(), false, 'autofill keeps explicit activation available');
      assert.equal(await page.getByRole('button', {name: c.login, exact: true}).isDisabled(), false);
      assert.ok((await passkeyButton.boundingBox())!.y < (await email.boundingBox())!.y, 'remembered passkeys come first');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_PREFERENCE_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_PREFERENCE_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PASSKEY_PREFERENCE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      await page.evaluate(() => (window as unknown as {preferenceApp: import('../src/app.ts').PortalApp}).preferenceApp.submit());
      await page.waitForFunction(() => (window as unknown as {autofillSettled: boolean}).autofillSettled);
      assert.equal(await page.evaluate(() => (window as unknown as {autofillSignal: AbortSignal}).autofillSignal.aborted), true, 'password fallback cancels the real browser request');
      const beforeNavigationVisit = optionRequests;
      await open();
      await t.waitFor(() => assert.ok(optionRequests > beforeNavigationVisit), {timeout: 4000});
      const requestsBeforeNavigation = optionRequests;
      await page.getByRole('link', {name: c.forgot, exact: true}).click();
      await page.waitForFunction(() => (window as unknown as {autofillSettled: boolean}).autofillSettled);
      assert.equal(await page.evaluate(() => (window as unknown as {autofillSignal: AbortSignal}).autofillSignal.aborted), true, 'navigation cancels the real browser request');
      await page.getByRole('link', {name: c.login, exact: true}).click();
      await page.waitForLoadState('networkidle');
      assert.equal(optionRequests, requestsBeforeNavigation, 'returning within this document does not spend another automatic sign-in attempt');
      await remember.focus(); await remember.press('Space');
      assert.equal(await remember.evaluate(input => document.activeElement === input), true, 'clearing the preference preserves keyboard focus');
      assert.equal(await page.evaluate(() => localStorage.getItem('cloud.passkeyFirst')), null);
      await email.fill('owner@example.test');
      await page.locator('input[name=password]').fill('Current account password');
      await page.getByRole('button', {name: c.login, exact: true}).click();
      await page.getByText(c.accountIntro, {exact: true}).waitFor();
      await authenticator.close();
    } finally { await browser.close(); }
  });
}
