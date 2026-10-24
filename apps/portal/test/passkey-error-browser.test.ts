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
 const app = new PortalApp(document.querySelector('#portal'));
 Object.assign(window, {diagnosticApp: app});
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: passkey failures have one alert in the relevant section`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      for (const path of ['/account', '/', '/login']) await t.test(path, async () => {
        const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
        page.setDefaultTimeout(4000);
        const events: unknown[] = [];
        const record = (event: unknown) => { if (events.length < 100) events.push(event); };
        page.on('request', request => { if (request.url().includes('/api/account/')) record({kind: 'request', path: new URL(request.url()).pathname}); });
        page.on('response', response => { if (response.url().includes('/api/account/')) record({kind: 'response', path: new URL(response.url()).pathname, status: response.status()}); });
        page.on('pageerror', () => record({kind: 'pageerror'}));
        try {
          await page.exposeFunction('recordPasskeyDiagnostic', record);
          await page.addInitScript(() => {
            const state = () => {
              const app = (window as any).diagnosticApp;
              return {path: location.pathname, passwordPresent: !!app?.passkeys.password,
                pending: app?.passkeys.pending, loaded: app?.passkeys.loaded, error: app?.passkeys.error,
                alertCount: document.querySelectorAll('.passkeys [role=alert]').length};
            };
            for (const type of ['pointerdown', 'pointerup', 'click', 'input', 'wt-change']) document.addEventListener(type, event => {
              const target = event.composedPath()[0] as HTMLElement;
              void (window as any).recordPasskeyDiagnostic({kind: 'event', type, tag: target.tagName, ...state()});
            }, true);
            new MutationObserver(() => { void (window as any).recordPasskeyDiagnostic({kind: 'dom', ...state()}); }).observe(document, {subtree: true, childList: true});
          });
          const authenticator = await page.context().newCDPSession(page);
          await authenticator.send('WebAuthn.enable');
          await authenticator.send('WebAuthn.addVirtualAuthenticator', {options: {
            protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
            isUserVerified: true, automaticPresenceSimulation: true,
          }});
          const c = translations[locale], account = path !== '/login';
          await page.route('https://portal.test' + path, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
          await page.route('**/api/account/**', route => {
            const endpoint = new URL(route.request().url()).pathname;
            if (endpoint.endsWith('/session') || endpoint.endsWith('/session/activity')) return account
              ? route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}})
              : route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
            if (endpoint.endsWith('/passkeys/registration/options')) return route.fulfill({status: 403, json: {error: 'credentials_invalid'}});
            if (endpoint.endsWith('/passkeys/authentication/options')) return route.fulfill({status: 503, json: {error: 'unavailable'}});
            if (endpoint.endsWith('/passkeys')) return route.fulfill({json: {passkeys: []}});
            if (endpoint.endsWith('/installations')) return route.fulfill({json: {installations: []}});
            return route.fulfill({status: 503, json: {error: 'unavailable'}});
          });
          await page.goto('https://portal.test' + path);
          await page.addStyleTag({content: styles});
          await page.addScriptTag({content: bundle.outputFiles[0]!.text});
          if (account) {
            await page.locator('input[name=passkeyPassword]').fill('An incorrect account password');
            await page.getByRole('button', {name: c.passkeyAdd, exact: true}).click();
          } else await page.getByRole('button', {name: c.passkeySignIn, exact: true}).click();
          const message = account ? c.passkeyPasswordInvalid : c.passkeyUnavailable;
          const localAlert = page.locator(account ? '.passkeys' : 'wt-form-error-summary').getByRole('alert').filter({hasText: message});
          await localAlert.waitFor();
          assert.equal(await page.getByRole('alert').filter({hasText: message}).count(), 1, `${path}: announce the passkey failure once`);
          assert.equal(await page.locator(account ? 'wt-form-error-summary' : '.passkey-signin').getByRole('alert').filter({hasText: message}).count(), 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (process.env.PASSKEY_ERROR_RECEIPT_DIR) {
            await mkdir(process.env.PASSKEY_ERROR_RECEIPT_DIR, {recursive: true});
            await page.screenshot({path: `${process.env.PASSKEY_ERROR_RECEIPT_DIR}/${locale}-${theme}-${width}-${account ? path === '/' ? 'root' : 'account' : 'login'}.png`, fullPage: true});
          }
        } finally {
          console.log('PASSKEY_DIAGNOSTIC ' + JSON.stringify({locale, theme, width, route: path, events,
            final: await page.evaluate(() => { const app = (window as any).diagnosticApp; return {path: location.pathname,
              pending: app?.passkeys.pending, loaded: app?.passkeys.loaded, error: app?.passkeys.error,
              passwordPresent: !!app?.passkeys.password, alerts: [...document.querySelectorAll('[role=alert]')].map(e => e.textContent?.slice(0, 160))}; }).catch(() => ({unavailable: true}))}));
          await page.close();
        }
      });
    } finally { await browser.close(); }
  });
}
