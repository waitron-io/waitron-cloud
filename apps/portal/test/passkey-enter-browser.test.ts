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
const at = '2026-10-24T12:00:00.000Z', password = ' Current account password ';
const id = '12345678-1234-4234-8234-123456789abc';
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: Enter in the passkey password starts Add once and keeps browser confirmation`, async () => {
    const browser = await chromium.launch({headless: true});
    let releaseOptions!: () => void;
    const optionsReply = new Promise<void>(resolve => {releaseOptions = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(4000);
      await page.clock.install({time: new Date(at)}); await page.clock.pauseAt(new Date(at));
      const authenticator = await page.context().newCDPSession(page);
      await authenticator.send('WebAuthn.enable');
      await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      }});
      const c = translations[locale], writes: {path: string; body: unknown}[] = [];
      let enrolled = false;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
        if (endpoint === '/session' || endpoint === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2026-10-25T12:00:00Z'}});
        if (endpoint === '/passkeys') return route.fulfill({json: {passkeys: enrolled ? [{id, createdAt: at, lastUsedAt: null}] : []}});
        if (endpoint === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (endpoint === '/installations') return route.fulfill({json: {installations: []}});
        if (request.method() === 'POST') writes.push({path: endpoint, body: request.postDataJSON()});
        if (endpoint === '/passkeys/registration/options') {
          await optionsReply;
          return route.fulfill({json: {ceremonyId: id, options: {
            challenge: 'YWJj', rp: {name: 'Waitron Cloud', id: 'portal.test'},
            user: {id: 'b3duZXI', name: 'owner@example.test', displayName: 'Owner'},
            pubKeyCredParams: [{type: 'public-key', alg: -7}],
          }}});
        }
        if (endpoint === '/passkeys/registration/verify') { enrolled = true; return route.fulfill({json: {id, createdAt: at, lastUsedAt: null}}); }
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.passkeys'), field = section.locator('input[name=passkeyPassword]');
      await section.getByText(c.passkeyNone, {exact: true}).waitFor();
      await page.waitForLoadState('networkidle');
      const button = section.getByRole('button', {name: c.passkeyAdd, exact: true});
      assert.equal(await button.isDisabled(), true, 'blank password keeps Add disabled');
      await field.press('Enter');
      assert.equal(writes.length, 0, 'blank password does not submit');
      await field.fill(password);
      await field.press('a'); await field.press('Backspace');
      await field.press('Shift+Enter');
      await field.press('Control+Enter');
      await field.press('Alt+Enter');
      await field.press('Meta+Enter');
      await field.dispatchEvent('keydown', {key: 'Enter', isComposing: true});
      await field.dispatchEvent('keydown', {key: 'Enter', repeat: true});
      assert.equal(writes.length, 0, 'modified and composing Enter do not submit');
      assert.equal(await field.inputValue(), password, 'password bytes remain exact');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_ENTER_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_ENTER_RECEIPT_DIR, {recursive: true});
        await section.screenshot({path: `${process.env.PASSKEY_ENTER_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      const requested = page.waitForRequest('**/passkeys/registration/options', {timeout: 1500});
      await field.press('Enter'); await requested;
      const pending = section.getByRole('button', {name: c.wait, exact: true});
      assert.equal(await pending.isDisabled(), true, 'enrollment stays disabled while the request is pending');
      assert.equal(await field.isDisabled(), true);
      await field.dispatchEvent('keydown', {key: 'Enter'});
      assert.deepEqual(writes, [{path: '/passkeys/registration/options', body: {password}}]);
      releaseOptions();
      await section.getByRole('status').filter({hasText: c.passkeyAdded}).waitFor();
      assert.equal(await field.inputValue(), '', 'successful enrollment clears the password');
      assert.equal(await button.isDisabled(), true);
      assert.deepEqual(writes.map(write => write.path), ['/passkeys/registration/options', '/passkeys/registration/verify']);
      await page.close();
    } finally { releaseOptions(); await browser.close(); }
  });
}

for (const blocked of ['unsupported', 'cooldown'] as const) {
  test(`Enter in the passkey password respects ${blocked}`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(3000);
      await page.clock.install({time: new Date(at)}); await page.clock.pauseAt(new Date(at));
      if (blocked === 'unsupported') await page.addInitScript(() => {
        Object.defineProperty(window, 'PublicKeyCredential', {value: undefined});
      });
      const writes: string[] = [];
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
        if (endpoint === '/session' || endpoint === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2026-10-25T12:00:00Z'}});
        if (endpoint === '/passkeys') return route.fulfill({json: {passkeys: []}});
        if (endpoint === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (endpoint === '/installations') return route.fulfill({json: {installations: []}});
        if (request.method() === 'POST') writes.push(endpoint);
        if (endpoint === '/passkeys/registration/options') return route.fulfill({status: 429, headers: {'retry-after': '60'}, json: {error: 'rate_limited'}});
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.passkeys'), field = section.locator('input[name=passkeyPassword]');
      await section.getByText(translations.en.passkeyNone, {exact: true}).waitFor();
      if (blocked === 'unsupported') await section.getByRole('status').filter({hasText: translations.en.passkeyUnsupported}).waitFor();
      await page.waitForLoadState('networkidle');
      await field.fill(password);
      if (blocked === 'cooldown') {
        const reply = page.waitForResponse('**/passkeys/registration/options');
        await field.press('Enter'); await reply;
        await section.getByRole('alert').filter({hasText: translations.en.limited}).waitFor();
        assert.equal(await field.isDisabled(), true);
        assert.equal(await section.getByRole('button', {name: translations.en.passkeyAdd, exact: true}).isDisabled(), true);
      } else {
        assert.equal(await section.getByRole('button', {name: translations.en.passkeyAdd, exact: true}).count(), 0);
        await field.press('Enter');
      }
      await field.dispatchEvent('keydown', {key: 'Enter'});
      await page.waitForLoadState('networkidle');
      assert.deepEqual(writes, blocked === 'cooldown' ? ['/passkeys/registration/options'] : []);
      await page.close();
    } finally { await browser.close(); }
  });
}
