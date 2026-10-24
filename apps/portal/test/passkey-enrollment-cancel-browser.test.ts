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
  test(`${locale} ${theme} ${width}: cancelling passkey enrollment shows one status and permits retry`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale], calls: string[] = [];
      const authenticator = await page.context().newCDPSession(page);
      await authenticator.send('WebAuthn.enable');
      await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      }});
      await page.addInitScript(() => {
        navigator.credentials.create = async () => {throw new DOMException('Prompt cancelled', 'NotAllowedError');};
      });
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const endpoint = new URL(route.request().url()).pathname;
        calls.push(endpoint);
        if (endpoint.endsWith('/session') || endpoint.endsWith('/session/activity')) return route.fulfill({json: {
          accountId: 'owner', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }});
        if (endpoint.endsWith('/passkeys/registration/options')) return route.fulfill({json: {
          ceremonyId: '12345678-1234-4234-8234-123456789abc', options: {
            challenge: 'YWJj', rp: {name: 'Waitron Cloud', id: 'portal.test'},
            user: {id: 'b3duZXI', name: 'owner@example.test', displayName: 'Owner'},
            pubKeyCredParams: [{type: 'public-key', alg: -7}],
          },
        }});
        if (endpoint.endsWith('/passkeys')) return route.fulfill({json: {passkeys: []}});
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.passkeys');
      await section.getByText(c.passkeyNone, {exact: true}).waitFor();
      await section.locator('input[name=passkeyPassword]').fill('Current account password');
      const button = section.getByRole('button', {name: c.passkeyAdd, exact: true});
      for (let attempt = 1; attempt <= 2; attempt++) {
        await button.click();
        await section.getByRole('status').filter({hasText: c.passkeyCancelled}).waitFor();
        assert.equal(await section.getByText(c.passkeyCancelled, {exact: true}).count(), 1);
        assert.equal(await section.getByRole('alert').count(), 0);
        assert.equal(await button.isEnabled(), true);
        assert.equal(calls.filter(path => path.endsWith('/passkeys/registration/options')).length, attempt);
        assert.equal(calls.some(path => path.endsWith('/passkeys/registration/verify')), false);
      }
      assert.equal(new URL(page.url()).pathname, '/account');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_ENROLLMENT_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_ENROLLMENT_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PASSKEY_ENROLLMENT_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      await page.evaluate(() => {
        navigator.credentials.create = async () => {throw new DOMException('Browser refused', 'SecurityError');};
      });
      await button.click();
      await section.getByRole('alert').filter({hasText: c.passkeyUnavailable}).waitFor();
      assert.equal(await section.getByText(c.passkeyCancelled, {exact: true}).count(), 0);
      assert.equal(await section.getByRole('alert').count(), 1);
      assert.equal(calls.some(path => path.endsWith('/passkeys/registration/verify')), false);
      await page.close();
    } finally { await browser.close(); }
  });
}
