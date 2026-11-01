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
 window.removalApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

// Restoring registry navigation must fail while ordinary account, recovery and sign-out still work.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`account_without_registry ${locale} ${theme} ${width}`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const errors: string[] = [], registryRequests: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {if (request.url().includes('/api/') && request.url().includes('fiscal-allocations')) registryRequests.push(request.url());});
      const c = translations[locale];
      let ended = false;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return ended
          ? route.fulfill({status: 401, json: {error: 'unauthenticated'}})
          : route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path === '/logout') {ended = true; return route.fulfill({status: 204});}
        if (path === '/sessions') return route.fulfill({json: {sessions: []}});
        if (path === '/passkeys') return route.fulfill({json: {passkeys: []}});
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: false}});
        if (path === '/alerts') return route.fulfill({json: {enabled: false, locale}});
        if (path === '/translation-consent') return route.fulfill({json: {consents: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.getByRole('button', {name: c.signout, exact: true}).waitFor();
      if (process.env.REGISTRY_REMOVAL_RECEIPT_DIR) {
        await mkdir(process.env.REGISTRY_REMOVAL_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.REGISTRY_REMOVAL_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      assert.equal(await page.locator('a[href="/fiscal-allocations"]').count(), 0);
      await page.getByRole('link', {name: c.forgot, exact: true}).click();
      await page.getByRole('heading', {name: c.forgot, exact: true}).waitFor();
      assert.equal(await page.locator('h1').evaluate(node => node === document.activeElement), true);
      await page.locator('a.brand').click();
      await page.getByRole('heading', {name: c.account, exact: true}).waitFor();
      await page.evaluate(() => (window as unknown as {removalApp: {navigate(path: string): void}}).removalApp.navigate('/recover'));
      await page.getByRole('heading', {name: c.recoveryTitle, exact: true}).waitFor();
      assert.equal(await page.locator('h1').evaluate(node => node === document.activeElement), true);
      await page.locator('a.brand').click();
      await page.getByRole('button', {name: c.signout, exact: true}).click();
      await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
      assert.equal(new URL(page.url()).pathname, '/login');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(registryRequests, []);
      assert.deepEqual(errors, []);
    } finally {await browser.close();}
  });
}
