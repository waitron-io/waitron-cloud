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
const id = '12345678-1234-4234-8234-123456789abc', password = ' Incorrect account password ';
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: blank password on Remove marks the password field`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(4000);
      const authenticator = await page.context().newCDPSession(page);
      await authenticator.send('WebAuthn.enable');
      await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      }});
      const c = translations[locale], writes: {path: string; body: unknown}[] = [];
      let limited = false;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
        if (endpoint === '/session' || endpoint === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (endpoint === '/passkeys') return route.fulfill({json: {passkeys: [{id, createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null}]}});
        if (endpoint === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (endpoint === '/installations') return route.fulfill({json: {installations: []}});
        if (request.method() === 'POST') writes.push({path: endpoint, body: request.postDataJSON()});
        if (endpoint === '/passkeys/remove') return limited
          ? route.fulfill({status: 429, headers: {'retry-after': '60'}, json: {error: 'rate_limited'}})
          : route.fulfill({status: 403, json: {error: 'credentials_invalid'}});
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.passkeys'), field = section.locator('wt-input[name=passkeyPassword]');
      const remove = section.getByRole('button', {name: c.passkeyRemove, exact: true});
      const add = section.getByRole('button', {name: c.passkeyAdd, exact: true});
      await remove.waitFor();
      assert.equal(await add.isDisabled(), true);
      assert.equal(await field.locator('input').getAttribute('aria-invalid'), 'false');
      await remove.click();
      await section.getByRole('alert').filter({hasText: c.requiredPassword}).waitFor();
      assert.deepEqual(writes, [], 'blank removal never sends a request');
      assert.equal(await page.getByRole('alert').filter({hasText: c.requiredPassword}).count(), 1, 'announce the required password once');
      assert.equal(await field.evaluate(element => (element as HTMLElement & {error: string}).error), c.requiredPassword);
      assert.equal(await field.locator('input').getAttribute('aria-invalid'), 'true');
      assert.equal(await field.getByText(c.requiredPassword, {exact: true}).count(), 1);
      assert.equal(await add.isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_REMOVE_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_REMOVE_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PASSKEY_REMOVE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      await field.locator('input').fill(password);
      assert.equal(await add.isEnabled(), true);
      await remove.click();
      await section.getByRole('alert').filter({hasText: c.passkeyPasswordInvalid}).waitFor();
      assert.deepEqual(writes, [{path: '/passkeys/remove', body: {id, password}}]);
      assert.equal(await field.evaluate(element => (element as HTMLElement & {error: string}).error), '', 'wrong-password feedback remains a section alert');
      assert.equal(await field.locator('input').getAttribute('aria-invalid'), 'false');
      assert.equal(await section.getByText(c.requiredPassword, {exact: true}).count(), 0);
      assert.equal(await page.getByRole('alert').filter({hasText: c.passkeyPasswordInvalid}).count(), 1);
      limited = true;
      await field.locator('input').fill(password); await remove.click();
      await section.getByRole('alert').filter({hasText: c.limited}).waitFor();
      assert.equal(writes.length, 2);
      assert.equal(await remove.isDisabled(), true);
      assert.equal(await add.isDisabled(), true);
      assert.equal(await field.locator('input').isDisabled(), true);
      assert.equal(await field.locator('input').getAttribute('aria-invalid'), 'false');
      await page.close();
    } finally { await browser.close(); }
  });
}
