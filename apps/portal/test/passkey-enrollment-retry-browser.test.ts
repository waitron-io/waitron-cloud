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
const existing = {id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null};
const added = {id: '22345678-1234-4234-8234-123456789abc', createdAt: '2026-10-25T12:00:00Z', lastUsedAt: null};
const password = '  Current account password  ';
const dates = {en: ['Oct 24, 2026', 'Oct 25, 2026'], es: ['24 oct 2026', '25 oct 2026']};

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: failed enrollment follow-up retains keys and Retry only reads`, async t => {
    const browser = await chromium.launch({headless: true});
    let release = () => {};
    const retryReply = new Promise<void>(resolve => {release = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(4000);
      const authenticator = await page.context().newCDPSession(page);
      await authenticator.send('WebAuthn.enable');
      await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      }});
      const c = translations[locale], writes: {path: string; body: Record<string, unknown>}[] = [];
      let reads = 0;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        if (path.startsWith('/passkeys/') && request.method() === 'POST') writes.push({path, body: request.postDataJSON()});
        if (path === '/passkeys/registration/options') return route.fulfill({json: {ceremonyId: added.id, options: {
          challenge: 'YWJj', rp: {name: 'Waitron Cloud', id: 'portal.test'},
          user: {id: 'b3duZXI', name: 'owner@example.test', displayName: 'Owner'},
          pubKeyCredParams: [{type: 'public-key', alg: -7}],
        }}});
        if (path === '/passkeys/registration/verify') return route.abort();
        if (path === '/passkeys') {
          reads++;
          if (reads === 1) return route.fulfill({json: {passkeys: [existing]}});
          if (reads === 2) return route.fulfill({status: 503, json: {error: 'unavailable'}});
          await retryReply;
          return route.fulfill({json: {passkeys: [existing, added]}});
        }
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.passkeys'), rows = section.locator('.passkey-list li');
      const field = section.locator('wt-input[name=passkeyPassword] input');
      await rows.getByRole('button', {name: c.passkeyRemove, exact: true}).waitFor();
      await field.fill(password);
      await section.getByRole('button', {name: c.passkeyAdd, exact: true}).click();
      await section.getByRole('alert').getByText(c.passkeyChangeUncertain, {exact: true}).waitFor();
      assert.equal(reads, 2);
      assert.equal(await rows.count(), 1, 'the failed follow-up read retains the old key');
      assert.equal(await rows.getByText(dates[locale][0]!, {exact: false}).count(), 1);
      assert.equal(await section.getByText(c.passkeyAdded, {exact: true}).count(), 0, 'a lost reply and failed list cannot confirm enrollment');
      assert.equal(await section.getByText(c.passkeyNone, {exact: true}).count(), 0);
      assert.equal(await field.inputValue(), '', 'the failed follow-up clears the submitted password');
      assert.equal(await section.getByRole('button', {name: c.passkeyAdd, exact: true}).isDisabled(), true);
      assert.deepEqual(writes.map(write => write.path), ['/passkeys/registration/options', '/passkeys/registration/verify']);
      assert.deepEqual(writes[0]!.body, {password}, 'the original enrollment keeps the exact password');
      assert.equal(writes[1]!.body.ceremonyId, added.id);
      assert.equal((writes[1]!.body.response as {type: string}).type, 'public-key');
      const originalWrites = structuredClone(writes);
      const retry = section.getByRole('button', {name: c.retry, exact: true});
      assert.equal(await retry.isEnabled(), true);
      await retry.click();
      await t.waitFor(() => {assert.equal(reads, 3);}, {timeout: 4000});
      assert.equal(await retry.isDisabled(), true);
      assert.equal(await field.isDisabled(), true);
      assert.equal(await rows.count(), 1, 'the pending retry retains the old key');
      assert.equal(await rows.getByRole('button', {name: c.passkeyRemove, exact: true}).isDisabled(), true);
      assert.equal(await section.getByRole('button', {name: c.wait, exact: true}).isDisabled(), true);
      await retry.evaluate(button => (button as HTMLElement).click());
      assert.deepEqual(writes, originalWrites, 'Retry sends no ceremony, verification or password');
      release();
      await rows.nth(1).getByRole('button', {name: c.passkeyRemove, exact: true}).waitFor();
      assert.equal(await rows.count(), 2, 'the successful retry lists both the old and new keys');
      assert.equal(await rows.nth(0).getByText(dates[locale][0]!, {exact: false}).count(), 1);
      assert.equal(await rows.nth(1).getByText(dates[locale][1]!, {exact: false}).count(), 1);
      assert.equal(await retry.count(), 0);
      assert.equal(await section.getByRole('alert').count(), 0);
      assert.equal(await field.inputValue(), '');
      assert.equal(await field.isEnabled(), true);
      assert.equal(await section.getByRole('button', {name: c.passkeyAdd, exact: true}).isDisabled(), true);
      assert.equal(reads, 3, 'pending Retry cannot duplicate the list read');
      assert.deepEqual(writes, originalWrites, 'a successful read never repeats enrollment');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_ENROLLMENT_RETRY_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_ENROLLMENT_RETRY_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PASSKEY_ENROLLMENT_RETRY_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
    } finally {release(); await browser.close();}
  });
}
