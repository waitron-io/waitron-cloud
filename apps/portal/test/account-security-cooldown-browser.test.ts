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
const id = '12345678-1234-4234-8234-123456789abc';
const at = '2026-10-24T12:00:00.000Z';
// The clock runs after installation; freeze before registering application timers.
const clockStart = new Date(Date.parse(at) - 86_400_000);
for (const setupDelay of [0, 100])
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}${setupDelay ? ' with delayed clock setup' : ''}: account security controls show and respect Retry-After`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      for (const action of ['passkey-list', 'passkey-add', 'passkey-remove', 'session-list', 'session-revoke', 'passkey-signin']) await t.test(action, async () => {
        const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
        page.setDefaultTimeout(4000);
        try {
          await page.clock.install({time: clockStart});
          if (setupDelay) await delay(setupDelay);
          await page.clock.pauseAt(new Date(at));
          const authenticator = await page.context().newCDPSession(page);
          await authenticator.send('WebAuthn.enable');
          await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
          const login = action === 'passkey-signin', path = login ? '/login' : '/account', c = translations[locale];
          const limited = action === 'passkey-list' ? '/passkeys' : action === 'passkey-add' ? '/passkeys/registration/options'
            : action === 'passkey-remove' ? '/passkeys/remove' : action === 'session-list' ? '/sessions'
            : action === 'session-revoke' ? '/sessions/revoke' : '/passkeys/authentication/options';
          let attempts = 0;
          await page.route('https://portal.test' + path, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
          await page.route('**/api/account/**', route => {
            const endpoint = new URL(route.request().url()).pathname.replace('/api/account', '');
            if (endpoint === '/session' || endpoint === '/session/activity') return login ? route.fulfill({status: 401, json: {error: 'credentials_invalid'}})
              : route.fulfill({json: {accountId: 'owner', expiresAt: '2026-10-25T12:00:00Z'}});
            if (endpoint === limited || action === 'passkey-list' && endpoint === '/passkeys/registration/options') { attempts++; return route.fulfill({status: 429, headers: {'Retry-After': '2'}, json: {error: 'rate_limited'}}); }
            if (endpoint === '/passkeys') return route.fulfill({json: {passkeys: [{id, createdAt: at, lastUsedAt: null}]}});
            if (endpoint === '/sessions') return route.fulfill({json: {sessions: [{id, createdAt: at, lastUsedAt: at, expiresAt: '2026-10-25T12:00:00Z', current: false}, {id: '22345678-1234-4234-8234-123456789abc', createdAt: at, lastUsedAt: at, expiresAt: '2026-10-25T12:00:00Z', current: true}]}});
            if (endpoint === '/installations') return route.fulfill({json: {installations: []}});
            return route.fulfill({status: 503, json: {error: 'unavailable'}});
          });
          await page.goto('https://portal.test' + path); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
          if (action === 'passkey-add' || action === 'passkey-remove') { await page.locator('input[name=passkeyPassword]').fill('Current account password'); await page.locator('input[name=passkeyPassword]').press('Tab'); await page.clock.runFor(1000); }
          const target = action === 'session-list' ? page.locator('.sessions').getByRole('button', {name: c.retry, exact: true})
            : page.getByRole('button', {name: action === 'session-revoke' ? c.sessionRevoke : login ? c.passkeySignIn : action === 'passkey-remove' ? c.passkeyRemove : c.passkeyAdd, exact: true});
          if (!action.endsWith('-list')) await target.click();
          const section = page.locator(login ? 'wt-form-error-summary' : action.startsWith('session') ? '.sessions' : '.passkeys');
          await section.getByRole('alert').filter({hasText: c.limited}).waitFor();
          assert.equal(attempts, 1);
          const buttons = page.locator(login ? '.passkey-signin wt-button' : action.startsWith('session') ? '.sessions wt-button' : '.passkeys wt-button');
          assert.ok(await buttons.count() > 0);
          assert.equal(await buttons.evaluateAll(elements => elements.every(element => (element as HTMLElement & {disabled: boolean}).disabled)), true, 'affected controls are disabled during the wait');
          const countdown = page.getByRole('status').filter({hasText: c.cooldown});
          assert.equal(await countdown.textContent(), `${c.cooldown} 2 ${c.seconds}`);
          await page.clock.runFor(1000);
          assert.equal(await countdown.textContent(), `${c.cooldown} 1 ${c.second}`);
          assert.equal(attempts, 1);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (process.env.SECURITY_COOLDOWN_RECEIPT_DIR && ['passkey-remove', 'session-revoke', 'passkey-signin'].includes(action)) {
            await mkdir(process.env.SECURITY_COOLDOWN_RECEIPT_DIR, {recursive: true});
            await page.screenshot({path: `${process.env.SECURITY_COOLDOWN_RECEIPT_DIR}/${locale}-${theme}-${width}-${action}.png`, fullPage: true});
          }
          await page.clock.runFor(1000);
          assert.equal(await countdown.count(), 0);
          if (action.startsWith('passkey-') && !login) { await page.locator('input[name=passkeyPassword]').fill('Current account password'); await page.locator('input[name=passkeyPassword]').press('Tab'); await page.clock.runFor(1000); }
          assert.equal(await target.isEnabled(), true);
          await target.click();
          await section.getByRole('alert').filter({hasText: c.limited}).waitFor();
          assert.equal(attempts, 2, 'retry is possible when the wait ends');
        } finally { await page.close(); }
      });
    } finally { await browser.close(); }
  });
}
