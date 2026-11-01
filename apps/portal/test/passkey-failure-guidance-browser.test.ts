import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `import {applyTokens} from '@waitron-io/ui-core/tokens'; import {PortalApp} from './src/app.ts'; applyTokens(document.body); window.guidanceApp = new PortalApp(document.querySelector('#portal'));`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const guidance = {
  en: 'Passkeys are unavailable. You can try again. Password sign-in remains available.',
  es: 'Las llaves de acceso no están disponibles. Puedes volver a intentarlo. Puedes seguir entrando con tu contraseña.',
};

// Generic failures need an available password alternative and a repeatable passkey attempt.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: generic passkey failures offer a working password path`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      for (const failure of ['browser', 'service'] as const) await t.test(failure, async () => {
        const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
        page.setDefaultTimeout(4000);
        const c = translations[locale], calls: string[] = [], passwords: unknown[] = [];
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        let signedIn = false, listAvailable = false, reads = 0;
        try {
          await page.addInitScript(() => {
            navigator.credentials.get = async () => {throw new DOMException('Browser security restriction', 'SecurityError');};
          });
          await page.route('https://portal.test/login', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
          await page.route('**/api/account/**', route => {
            const path = new URL(route.request().url()).pathname.replace('/api/account', '');
            calls.push(path);
            if (path === '/session' || path === '/session/activity') return signedIn
              ? route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}})
              : route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
            if (path === '/passkeys/authentication/options') return failure === 'service'
              ? route.fulfill({status: 503, json: {error: 'unavailable'}})
              : route.fulfill({json: {ceremonyId: '12345678-1234-4234-8234-123456789abc', options: {challenge: 'YWJj', rpId: 'portal.test', userVerification: 'required'}}});
            if (path === '/login') {
              const body = route.request().postDataJSON(); passwords.push(body);
              if (body.password !== 'Correct account password') return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
              signedIn = true; return route.fulfill({json: {accountId: 'owner'}});
            }
            if (path === '/passkeys') {
              reads++;
              return listAvailable ? route.fulfill({json: {passkeys: []}}) : route.fulfill({status: 503, json: {error: 'unavailable'}});
            }
            if (path === '/installations') return route.fulfill({json: {installations: []}});
            return route.fulfill({status: 503, json: {error: 'unavailable'}});
          });
          const nativeControl = locale === 'en' && theme === 'light' && width === 390 && failure === 'browser';
          if (nativeControl) {
            await page.goto('https://portal.test/login'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
            const native = await page.evaluate(async () => {
              const app = (window as unknown as {guidanceApp: {signInWithPasskey(): Promise<void>; passkeys: {supported?: boolean; error?: string; notice?: string}}}).guidanceApp;
              await app.signInWithPasskey();
              return {supported: app.passkeys.supported, error: app.passkeys.error, notice: app.passkeys.notice};
            });
            t.diagnostic(`Native passkey control: ${JSON.stringify({...native, optionsRequests: calls.filter(path => path.endsWith('/options')).length})}`);
            calls.length = 0;
          }
          // A virtual platform authenticator makes the failure journey independent of host hardware.
          const virtual = await page.context().newCDPSession(page);
          await virtual.send('WebAuthn.enable');
          await virtual.send('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
          await page.goto('https://portal.test/login');
          await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
          const supported = await page.evaluate(async () => {
            const passkeys = (window as unknown as {guidanceApp: {passkeys: {checkSupport(): Promise<void>; supported?: boolean}}}).guidanceApp.passkeys;
            await passkeys.checkSupport(); return passkeys.supported;
          });
          assert.equal(supported, true, 'the virtual platform authenticator admits the intended failure journey');
          if (nativeControl) t.diagnostic(`Virtual passkey control: ${JSON.stringify({supported})}`);
          await page.getByRole('button', {name: c.passkeySignIn, exact: true}).click();
          const alert = page.getByRole('alert').filter({hasText: c.passkeyUnavailable});
          await alert.waitFor();
          assert.equal(await alert.getByText(c.passkeyUnavailable, {exact: true}).innerText(), guidance[locale]);
          assert.equal(calls.filter(path => path === '/passkeys/authentication/options').length, 1);
          assert.equal(calls.some(path => path.endsWith('/verify')), false, 'no credential was submitted after a browser/options failure');
          assert.equal(new URL(page.url()).pathname, '/login');
          assert.equal(await page.getByRole('button', {name: c.login, exact: true}).isEnabled(), true);
          const retry = page.getByRole('button', {name: c.passkeySignIn, exact: true, disabled: false});
          await retry.waitFor();
          const retried = page.waitForResponse('**/api/account/passkeys/authentication/options');
          await retry.click(); await retried;
          await retry.waitFor();
          assert.equal(calls.filter(path => path === '/passkeys/authentication/options').length, 2);
          assert.equal(calls.some(path => path.endsWith('/verify')), false, 'a second refusal still submits no credential');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (process.env.PASSKEY_GUIDANCE_RECEIPT_DIR && failure === 'browser') {
            await mkdir(process.env.PASSKEY_GUIDANCE_RECEIPT_DIR, {recursive: true});
            await page.screenshot({path: `${process.env.PASSKEY_GUIDANCE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
          }
          await page.locator('input[name=email]').fill('owner@example.test');
          await page.locator('input[name=password]').fill('Incorrect password');
          await page.getByRole('button', {name: c.login, exact: true}).click();
          await page.getByRole('alert').filter({hasText: c.credentials}).waitFor();
          assert.equal(new URL(page.url()).pathname, '/login', 'the alternative still needs valid credentials');
          await page.locator('input[name=password]').fill('Correct account password');
          await page.getByRole('button', {name: c.login, exact: true}).click();
          await page.getByText(c.accountIntro, {exact: true}).waitFor();
          assert.equal(new URL(page.url()).pathname, '/account');
          assert.deepEqual(passwords, [{email: 'owner@example.test', password: 'Incorrect password'}, {email: 'owner@example.test', password: 'Correct account password'}]);
          const section = page.locator('.passkeys');
          await section.getByRole('alert').waitFor();
          assert.equal(await section.getByRole('alert').innerText(), guidance[locale]);
          if (process.env.PASSKEY_GUIDANCE_RECEIPT_DIR && failure === 'browser') {
            await section.screenshot({path: `${process.env.PASSKEY_GUIDANCE_RECEIPT_DIR}/account-${locale}-${theme}-${width}.png`});
          }
          assert.equal(await section.getByText(c.passkeyNone, {exact: true}).count(), 0, 'a refused read cannot claim an empty list');
          const beforeReads = reads; listAvailable = true;
          await section.getByRole('button', {name: c.retry, exact: true}).click();
          await section.getByText(c.passkeyNone, {exact: true}).waitFor();
          assert.equal(reads, beforeReads + 1);
          assert.equal(await section.getByRole('alert').count(), 0);
          assert.deepEqual(errors, []);
        } finally {await page.close();}
      });
    } finally {await browser.close();}
  });
}
