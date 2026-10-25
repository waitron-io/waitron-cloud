import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium, type Page} from 'playwright';
import {translations} from '../src/locale.ts';

const requestId = '10000000-0000-4000-8000-000000000001';
const localVenueId = '10000000-0000-4000-8000-000000000002';
const business = {organisationId: '20000000-0000-4000-8000-000000000001',
  legalBusinessId: '30000000-0000-4000-8000-000000000001', organisationName: 'Café Sol',
  legalBusinessName: 'Sol SL', countryCode: 'ES'};
const guidance = {
  en: 'Sign out, then sign in with the account that owns the business.',
  es: 'Cierra sesión e inicia sesión con la cuenta propietaria del negocio.',
};
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

async function start(page: Page, eligible = false) {
  let account: string | undefined = eligible ? 'business-owner' : 'other-account';
  let logoutFails = false;
  const writes: {path: string; body: unknown}[] = [];
  const unexpected: string[] = [];
  await page.route('https://portal.test/connect', route => route.fulfill({contentType: 'text/html',
    body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
    if (path === '/session' || path === '/session/activity') return account
      ? route.fulfill({json: {accountId: account, expiresAt: '2099-01-01T00:00:00Z'}})
      : route.fulfill({status: 401, json: {error: 'unauthenticated'}});
    if (path === '/pairing/businesses') return route.fulfill({json: {businesses: account === 'business-owner' ? [business] : []}});
    if (request.method() === 'POST') writes.push({path, body: request.postDataJSON()});
    if (path === '/logout') {
      if (logoutFails) return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      account = undefined; return route.fulfill({status: 204});
    }
    if (path === '/login') { account = 'business-owner'; return route.fulfill({json: {accountId: account}}); }
    if (path === '/pairing/inspect') return route.fulfill({json: {requestId, localVenueId,
      environment: 'test', state: 'awaiting_cloud', expiresAt: '2099-01-01T00:00:00Z'}});
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
  });
  await page.goto(`https://portal.test/connect#request=${requestId}`);
  await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
  await page.getByRole('button', {name: translations[await page.evaluate(() => document.documentElement.lang) as 'en' | 'es'].signout, exact: true}).waitFor();
  return {writes, unexpected, failLogout: (fails: boolean) => {logoutFails = fails;}};
}

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: no eligible business explains a working account-switch path`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}}); page.setDefaultTimeout(4000);
      const c = translations[locale], api = await start(page);
      await page.getByText(c.pairNoBusinesses, {exact: true}).waitFor();
      assert.ok((await page.locator('main').innerText()).includes(guidance[locale]), 'the empty-business message explains how to use the owning account');
      assert.equal(await page.locator('input[name=pairingCode]').count(), 0);
      assert.equal(await page.getByRole('button', {name: c.pairInspect, exact: true}).count(), 0);
      assert.equal(await page.getByRole('button', {name: c.pairApprove, exact: true}).count(), 0);
      assert.deepEqual(api.writes, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PAIRING_EMPTY_RECEIPT_DIR) {
        await mkdir(process.env.PAIRING_EMPTY_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PAIRING_EMPTY_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      await page.getByRole('button', {name: c.signout, exact: true}).click();
      await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
      await page.getByText(c.signedOut, {exact: true}).waitFor();
      assert.equal(new URL(page.url()).pathname, '/login');
      await page.locator('input[name=email]').fill('owner@example.test');
      await page.locator('input[name=password]').fill('A real café owner password');
      await page.getByRole('button', {name: c.login, exact: true}).click();
      const code = page.locator('input[name=pairingCode]'); await code.waitFor();
      assert.equal(new URL(page.url()).pathname, '/connect');
      assert.equal(await page.getByText(c.pairNoBusinesses, {exact: true}).count(), 0);
      await code.fill('12345678'); await page.getByRole('button', {name: c.pairInspect, exact: true}).click();
      await page.getByRole('button', {name: c.pairApprove, exact: true}).waitFor();
      assert.deepEqual(api.writes, [{path: '/logout', body: {}},
        {path: '/login', body: {email: 'owner@example.test', password: 'A real café owner password'}},
        {path: '/pairing/inspect', body: {requestId, code: '12345678'}}]);
      assert.deepEqual(api.unexpected, []);
    } finally { await browser.close(); }
  });
}

for (const locale of ['en', 'es'] as const) {
  test(`${locale}: a refused sign-out keeps the no-business page and permits another attempt`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale}); page.setDefaultTimeout(4000);
      const c = translations[locale], api = await start(page);
      await page.getByText(c.pairNoBusinesses, {exact: true}).waitFor();
      api.failLogout(true); await page.getByRole('button', {name: c.signout, exact: true}).click();
      await page.getByRole('alert').filter({hasText: c.logoutFailed}).waitFor();
      assert.equal(new URL(page.url()).pathname, '/connect');
      assert.equal(await page.getByText(c.pairNoBusinesses, {exact: true}).isVisible(), true);
      assert.equal(await page.locator('input[name=email]').count(), 0);
      api.failLogout(false); await page.getByRole('button', {name: c.signout, exact: true}).click();
      await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
      assert.deepEqual(api.writes, [{path: '/logout', body: {}}, {path: '/logout', body: {}}]);
      assert.deepEqual(api.unexpected, []);
    } finally { await browser.close(); }
  });
  test(`${locale}: an eligible account still reaches inspection without account-switch guidance`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale}); page.setDefaultTimeout(4000);
      const c = translations[locale], api = await start(page, true);
      const code = page.locator('input[name=pairingCode]'); await code.waitFor();
      assert.equal(await page.getByText(c.pairNoBusinesses, {exact: true}).count(), 0);
      await code.fill('12345678'); await page.getByRole('button', {name: c.pairInspect, exact: true}).click();
      await page.getByRole('button', {name: c.pairApprove, exact: true}).waitFor();
      assert.equal(await page.getByText('Sol SL', {exact: true}).isVisible(), true);
      assert.deepEqual(api.writes, [{path: '/pairing/inspect', body: {requestId, code: '12345678'}}]);
      assert.deepEqual(api.unexpected, []);
    } finally { await browser.close(); }
  });
}
