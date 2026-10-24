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
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: cancelled passkey sign-in has one status and can be retried`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale], calls: string[] = [];
      let refused = false;
      const authenticator = await page.context().newCDPSession(page);
      await authenticator.send('WebAuthn.enable');
      await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      }});
      await page.addInitScript(() => {
        navigator.credentials.get = async () => {throw new DOMException('Prompt cancelled', 'NotAllowedError');};
      });
      await page.route('https://portal.test/login', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const endpoint = new URL(route.request().url()).pathname;
        calls.push(endpoint);
        if (endpoint.endsWith('/session') || endpoint.endsWith('/session/activity')) return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
        if (endpoint.endsWith('/login')) return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
        if (endpoint.endsWith('/passkeys/authentication/options')) return refused
          ? route.fulfill({status: 503, json: {error: 'unavailable'}})
          : route.fulfill({json: {ceremonyId: '12345678-1234-4234-8234-123456789abc', options: {challenge: 'YWJj', rpId: 'portal.test', userVerification: 'required'}}});
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/login');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const button = page.getByRole('button', {name: c.passkeySignIn, exact: true});
      for (let attempt = 1; attempt <= 2; attempt++) {
        await button.click();
        await page.getByRole('status').filter({hasText: c.passkeyCancelled}).waitFor();
        assert.equal(await page.getByText(c.passkeyCancelled, {exact: true}).count(), 1);
        assert.equal(await page.getByRole('alert').filter({hasText: c.passkeyCancelled}).count(), 0);
        assert.equal(calls.filter(path => path.endsWith('/passkeys/authentication/options')).length, attempt);
        assert.equal(calls.some(path => path.endsWith('/passkeys/authentication/verify')), false);
        assert.equal(new URL(page.url()).pathname, '/login');
        assert.equal(await button.isEnabled(), true);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_CANCEL_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_CANCEL_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PASSKEY_CANCEL_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      await page.locator('input[name=email]').fill('owner@example.test');
      await page.locator('input[name=password]').fill('An incorrect account password');
      await page.getByRole('button', {name: c.login, exact: true}).click();
      await page.getByRole('alert').filter({hasText: c.credentials}).waitFor();
      assert.equal(await page.getByText(c.passkeyCancelled, {exact: true}).count(), 0);
      assert.equal(calls.filter(path => path.endsWith('/login')).length, 1);
      await button.click();
      await page.getByRole('status').filter({hasText: c.passkeyCancelled}).waitFor();
      refused = true;
      await button.click();
      await page.getByRole('alert').filter({hasText: c.passkeyUnavailable}).waitFor();
      assert.equal(await page.getByText(c.passkeyCancelled, {exact: true}).count(), 0);
      assert.equal(await page.getByRole('alert').filter({hasText: c.passkeyUnavailable}).count(), 1);
      assert.equal(await page.locator('.passkey-signin').getByRole('alert').count(), 0);
      await page.close();
    } finally { await browser.close(); }
  });
  test(`${locale} ${theme} ${width}: unsupported passkeys keep one help status`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale];
      let ceremonies = 0;
      await page.addInitScript(() => {
        Object.defineProperty(window, 'PublicKeyCredential', {value: undefined});
      });
      await page.route('https://portal.test/login', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        if (route.request().url().includes('/passkeys/')) ceremonies++;
        return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
      });
      await page.goto('https://portal.test/login');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.locator('.passkey-signin').getByRole('status').filter({hasText: c.passkeyUnsupported}).waitFor();
      await page.getByRole('button', {name: c.passkeySignIn, exact: true}).click();
      assert.equal(await page.getByText(c.passkeyUnsupported, {exact: true}).count(), 1);
      assert.equal(await page.getByRole('status').filter({hasText: c.passkeyUnsupported}).count(), 1);
      assert.equal(await page.getByText(c.passkeyCancelled, {exact: true}).count(), 0);
      assert.equal(ceremonies, 0);
      assert.equal(await page.getByRole('button', {name: c.login, exact: true}).isEnabled(), true);
      await page.close();
    } finally { await browser.close(); }
  });
}
