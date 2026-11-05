import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import {translations, type Locale} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const password = 'A cafe owner password';
const token = 'a'.repeat(43);
const flows = [
  {path: '/forgot-password', endpoint: '/password-reset/request', button: 'sendReset'},
  {path: '/signup', endpoint: '/signup/request', button: 'continue'},
  {path: '/reset-password', endpoint: '/password-reset/complete', button: 'savePassword'},
  {path: '/signup', endpoint: '/signup/complete', button: 'create'},
] as const;

async function open(browser: Browser, locale: Locale, theme: 'light' | 'dark', width: number, limitedResetPath?: string, setupDelay = 0) {
  const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
  page.setDefaultTimeout(3000);
  // The clock runs after installation; freeze before registering application timers.
  await page.clock.install({time: new Date('2026-10-23T12:00:01Z')});
  if (setupDelay) await delay(setupDelay);
  await page.clock.pauseAt(new Date('2026-10-24T12:00:01Z'));
  const calls: {path: string; body: unknown}[] = [];
  await page.route('https://portal.test/login', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/account', '');
    if (path === '/session') return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
    calls.push({path, body: route.request().postDataJSON()});
    if (path === '/login') return route.fulfill({status: 429, headers: {'Retry-After': '900'}, json: {error: 'rate_limited'}});
    if (path === limitedResetPath && calls.filter(call => call.path === path).length === 1)
      return route.fulfill({status: 429, headers: {'Retry-After': '2'}, json: {error: 'rate_limited'}});
    if (path === '/password-reset/request' || path === '/signup/request') return route.fulfill({status: 202, json: {status: 'accepted'}});
    if (path === '/password-reset/complete') return route.fulfill({json: {status: 'completed'}});
    if (path === '/signup/complete') return route.fulfill({status: 201, json: {accountId: 'owner', organisationId: 'business', legalBusinessId: 'legal-business'}});
    return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/login');
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: bundle.outputFiles[0]!.text});
  const c = translations[locale];
  await page.locator('input[name=email]').fill('owner@example.test');
  await page.locator('input[name=password]').fill(password);
  await page.getByRole('button', {name: c.login, exact: true}).click();
  await page.getByRole('alert').filter({hasText: c.limited}).waitFor();
  assert.equal(await page.getByRole('status').filter({hasText: c.cooldown}).textContent(), `${c.cooldown} 900 ${c.seconds}`);
  assert.equal(await page.getByRole('button', {name: c.login, exact: true}).isDisabled(), true);
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  assert.deepEqual(calls, [{path: '/login', body: {email: 'owner@example.test', password}}]);
  return {page, calls};
}

for (const setupDelay of [0, 1100])
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  if (setupDelay && (theme !== 'light' || width !== 390)) continue;
  test(`${locale} ${theme} ${width}${setupDelay ? ' with delayed clock setup' : ''}: a sign-in cooldown leaves other account forms usable`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      for (const flow of flows) await t.test(flow.endpoint, async () => {
        const {page, calls} = await open(browser, locale, theme, width, undefined, setupDelay), c = translations[locale];
        try {
          const completion = flow.endpoint.endsWith('/complete');
          if (completion) await page.evaluate(path => {
            history.pushState(null, '', path);
            dispatchEvent(new PopStateEvent('popstate'));
          }, `${flow.path}#token=${token}`);
          else await page.getByRole('link', {name: flow.path === '/signup' ? c.signup : c.forgot, exact: true}).click();
          const submit = page.getByRole('button', {name: c[flow.button], exact: true});
          assert.equal(await submit.isEnabled(), true, `${flow.endpoint} must not inherit the sign-in cooldown`);
          assert.equal(await page.getByRole('status').filter({hasText: c.cooldown}).count(), 0);
          assert.equal(await page.getByRole('alert').filter({hasText: c.limited}).count(), 0);
          if (completion) {
            await page.locator('input[name=password]').fill(password);
            if (flow.endpoint === '/signup/complete') await page.locator('input[name=legalBusinessName]').fill('Cafe owner');
          } else await page.locator('input[name=email]').fill('owner@example.test');
          if (process.env.LOGIN_COOLDOWN_RECEIPT_DIR) {
            await mkdir(process.env.LOGIN_COOLDOWN_RECEIPT_DIR, {recursive: true});
            await page.screenshot({path: `${process.env.LOGIN_COOLDOWN_RECEIPT_DIR}/${locale}-${theme}-${width}-${flow.endpoint.slice(1).replaceAll('/', '-')}.png`, fullPage: true});
          }
          await submit.click();
          await page.getByRole('status').filter({hasText: completion ? (flow.path === '/signup' ? c.signupReady : c.resetReady) : c.emailSent}).waitFor();
          const body = flow.endpoint === '/signup/complete'
            ? {token, password, legalBusinessName: 'Cafe owner', organisationName: 'Cafe owner', countryCode: 'ES'}
            : completion ? {token, password, locale} : {email: 'owner@example.test', locale};
          assert.deepEqual(calls, [{path: '/login', body: {email: 'owner@example.test', password}}, {path: flow.endpoint, body}]);
          if (!completion) {
            assert.equal(await page.getByRole('button', {name: c.resend, exact: true}).isDisabled(), true);
            assert.equal(await page.getByRole('status').filter({hasText: c.cooldown}).textContent(), `${c.cooldown} 60 ${c.seconds}`);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await page.evaluate(() => history.back());
          await page.waitForURL('https://portal.test/login');
          const login = page.getByRole('button', {name: c.login, exact: true});
          assert.equal(await login.isDisabled(), true, 'returning must retain the sign-in retry deadline');
          assert.equal(await page.getByRole('status').filter({hasText: c.cooldown}).textContent(), `${c.cooldown} 900 ${c.seconds}`);
          await page.clock.fastForward(900_000);
          assert.equal(await login.isEnabled(), true);
          assert.equal(await page.getByRole('status').filter({hasText: c.cooldown}).count(), 0);
          assert.equal(calls.length, 2);
        } finally { await page.close(); }
      });
    } finally { await browser.close(); }
  });
}

for (const setupDelay of [0, 1100])
for (const locale of ['en', 'es'] as const) for (const completion of [false, true]) test(`${locale}${setupDelay ? ' with delayed clock setup' : ''}: password recovery ${completion ? 'completion' : 'request'} keeps its own retry delay during a sign-in cooldown`, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const endpoint = completion ? '/password-reset/complete' : '/password-reset/request';
    const {page, calls} = await open(browser, locale, 'light', 390, endpoint, setupDelay), c = translations[locale];
    try {
      if (completion) {
        await page.evaluate(path => {history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate'));}, `/reset-password#token=${token}`);
        await page.locator('input[name=password]').fill(password);
      } else {
        await page.getByRole('link', {name: c.forgot, exact: true}).click();
        await page.locator('input[name=email]').fill('owner@example.test');
      }
      const submit = page.getByRole('button', {name: completion ? c.savePassword : c.sendReset, exact: true});
      assert.equal(await submit.isEnabled(), true);
      await submit.click();
      await page.getByRole('alert').filter({hasText: c.limited}).waitFor();
      assert.equal(await submit.isDisabled(), true);
      assert.equal(await page.getByRole('status').filter({hasText: c.cooldown}).textContent(), `${c.cooldown} 2 ${c.seconds}`);
      await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      assert.equal(calls.length, 2);
      await page.clock.runFor(1000);
      assert.equal(await submit.isDisabled(), true);
      assert.equal(await page.getByRole('status').filter({hasText: c.cooldown}).textContent(), `${c.cooldown} 1 ${c.second}`);
      await page.clock.runFor(1000);
      assert.equal(await submit.isEnabled(), true);
      await submit.click();
      await page.getByRole('status').filter({hasText: completion ? c.resetReady : c.emailSent}).waitFor();
      const body = completion ? {token, password, locale} : {email: 'owner@example.test', locale};
      assert.deepEqual(calls.slice(1), [{path: endpoint, body}, {path: endpoint, body}]);
    } finally { await page.close(); }
  } finally { await browser.close(); }
});
