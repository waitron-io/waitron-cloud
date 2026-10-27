import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
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
// The clock runs after installation; freeze before registering application timers.
const clockStart = new Date(Date.parse(at) - 86_400_000);
const enrolment = {pendingToken: 'A'.repeat(43), secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP', expiresAt: '2026-10-25T12:00:00Z'};

for (const setupDelay of [0, 100])
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}${setupDelay ? ' with delayed clock setup' : ''}: password Enter starts first authenticator setup once and leaves activation explicit`, async () => {
    const browser = await chromium.launch({headless: true});
    let release!: () => void;
    const reply = new Promise<void>(resolve => {release = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
      page.setDefaultTimeout(4000);
      await page.clock.install({time: clockStart});
      if (setupDelay) await delay(setupDelay);
      await page.clock.pauseAt(new Date(at));
      const c = translations[locale], writes: {path: string; body: unknown}[] = [];
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2026-10-25T12:00:00Z'}});
        if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (request.method() === 'POST') writes.push({path, body: request.postDataJSON()});
        if (path === '/authenticator/begin') { await reply; return route.fulfill({json: enrolment}); }
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.authenticator'), field = section.locator('input[name=factorPassword]');
      await section.getByRole('button', {name: c.factorEnable, exact: true}).waitFor();
      await page.waitForLoadState('networkidle');
      await field.press('Enter');
      await section.getByRole('alert').getByText(c.requiredPassword, {exact: true}).waitFor();
      assert.equal(writes.length, 0, 'blank password validates locally');
      await field.fill(password);
      await field.press('Shift+Enter'); await field.press('Control+Enter'); await field.press('Alt+Enter'); await field.press('Meta+Enter');
      await field.dispatchEvent('keydown', {key: 'Enter', isComposing: true});
      await field.dispatchEvent('keydown', {key: 'Enter', repeat: true});
      assert.equal(writes.length, 0, 'modified, composing and repeated Enter do not submit');
      const requested = page.waitForRequest('**/authenticator/begin', {timeout: 1500});
      await field.evaluate(input => { for (let i = 0; i < 2; i++) input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, composed: true, cancelable: true})); });
      await requested;
      assert.equal(await field.isDisabled(), true, 'pending request disables the password');
      assert.equal(await section.getByRole('button', {name: c.factorEnable, exact: true}).isDisabled(), true);
      await field.dispatchEvent('keydown', {key: 'Enter'});
      assert.deepEqual(writes, [{path: '/authenticator/begin', body: {password}}]);
      release();
      const confirmation = section.locator('input[name=factorConfirmation]'); await confirmation.waitFor();
      assert.equal(await field.inputValue(), '', 'setup clears the password');
      await field.fill(password); await confirmation.fill('123456');
      await field.press('Enter'); await confirmation.press('Enter');
      await page.waitForLoadState('networkidle');
      assert.deepEqual(writes, [{path: '/authenticator/begin', body: {password}}], 'Enter cannot activate, cancel or begin again during setup');
      assert.equal(await section.getByRole('button', {name: c.factorActivate, exact: true}).isDisabled(), false);
      assert.equal(await section.getByRole('button', {name: c.factorCancel, exact: true}).isDisabled(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.AUTHENTICATOR_ENTER_RECEIPT_DIR) {
        await mkdir(process.env.AUTHENTICATOR_ENTER_RECEIPT_DIR, {recursive: true});
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({path: `${process.env.AUTHENTICATOR_ENTER_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
    } finally { release(); await browser.close(); }
  });
}

for (const setupDelay of [0, 100])
for (const state of ['active', 'unavailable', 'cooldown'] as const) {
  test(`password Enter leaves ${state} authenticator actions alone${setupDelay ? ' with delayed clock setup' : ''}`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage(); page.setDefaultTimeout(4000);
      await page.clock.install({time: clockStart});
      if (setupDelay) await delay(setupDelay);
      await page.clock.pauseAt(new Date(at));
      const c = translations.en, writes: string[] = [];
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2026-10-25T12:00:00Z'}});
        if (path === '/authenticator') return route.fulfill({json: {active: state === 'active', version: 1, recoveryCodesRemaining: state === 'active' ? 8 : 0, available: state !== 'unavailable'}});
        if (request.method() === 'POST') writes.push(path);
        if (path === '/authenticator/begin') return route.fulfill({status: 429, headers: {'retry-after': '60'}, json: {error: 'rate_limited'}});
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.authenticator'), field = section.locator('input[name=factorPassword]');
      if (state === 'unavailable') {
        await section.getByRole('status').getByText(c.factorUnavailable, {exact: true}).waitFor();
        assert.equal(await field.count(), 0, 'unavailable status offers no password action');
      } else {
        await field.fill(password);
        if (state === 'active') {
          await section.locator('input[name=factorProof]').fill('123456');
          for (const name of [c.factorReplace, c.factorRegenerate, c.factorRemove]) assert.equal(await section.getByRole('button', {name, exact: true}).isEnabled(), true);
        } else {
          const response = page.waitForResponse('**/authenticator/begin');
          await field.press('Enter'); await response;
          await section.getByRole('alert').getByText(c.limited, {exact: true}).waitFor();
          assert.equal(await section.getByRole('button', {name: c.factorEnable, exact: true}).isDisabled(), true);
          await field.fill(password);
        }
        await field.press('Enter'); await field.dispatchEvent('keydown', {key: 'Enter'});
      }
      await page.waitForLoadState('networkidle');
      assert.deepEqual(writes, state === 'cooldown' ? ['/authenticator/begin'] : []);
    } finally { await browser.close(); }
  });
}
