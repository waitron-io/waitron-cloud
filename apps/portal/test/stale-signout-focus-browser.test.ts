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
 const logout = app.logout.bind(app);
 window.logoutCompletions = 0;
 app.logout = async () => { try { await logout(); } finally { window.logoutCompletions++; } };
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const gate = () => {
 let release!: () => void;
 const held = new Promise<void>(resolve => { release = resolve; });
 return {held, release};
};

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
 for (const newer of ['failed', 'pending'] as const) {
  test(`${locale} ${theme} ${width}: an old sign-out failure preserves the newer ${newer} view`, async t => {
   const browser = await chromium.launch({headless: true});
   const first = gate(), second = gate();
   let attempts = 0, signedIn = true;
   try {
    const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
    page.setDefaultTimeout(4000);
    const copy = translations[locale];
    await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**', async route => {
     const endpoint = new URL(route.request().url()).pathname.replace('/api/account', '');
     if (endpoint === '/session' || endpoint === '/session/activity') return signedIn
      ? route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00.000Z'}})
      : route.fulfill({status: 401, json: {error: 'unauthenticated'}});
     if (endpoint === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
     if (endpoint === '/passkeys') return route.fulfill({json: {passkeys: []}});
     if (endpoint === '/installations') return route.fulfill({json: {installations: []}});
     if (endpoint === '/alerts') return route.fulfill({json: {enabled: false, locale}});
     if (endpoint === '/logout') {
      const attempt = ++attempts;
      if (attempt === 1) await first.held;
      if (attempt === 2 && newer === 'pending') await second.held;
      if (attempt <= 2) return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      signedIn = false;
      return route.fulfill({status: 204});
     }
     return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test/account');
    await page.addStyleTag({content: styles});
    await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    const signOut = page.getByRole('button', {name: copy.signout, exact: true});
    await signOut.click();
    await t.waitFor(() => assert.equal(attempts, 1), {timeout: 4000});
    await page.locator('a.brand').click();
    await page.waitForFunction(() => location.pathname === '/account');
    await signOut.click();
    await t.waitFor(() => assert.equal(attempts, 2), {timeout: 4000});
    const summary = page.locator('wt-form-error-summary');
    if (newer === 'failed') {
     await page.waitForFunction(() => (window as any).logoutCompletions === 1);
     await summary.getByText(copy.logoutFailed, {exact: true}).waitFor();
     assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('wt-form-error-summary')), true);
    } else assert.equal(await signOut.isDisabled(), true);
    const language = page.locator('header select');
    await language.focus();
    first.release();
    await page.waitForFunction(count => (window as any).logoutCompletions === count, newer === 'failed' ? 2 : 1);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('header select')), true, 'an old reply must not move focus');
    assert.equal(await signOut.isDisabled(), newer === 'pending', 'an old reply must not clear a newer pending operation');
    assert.equal(await page.getByText(copy.signedOut, {exact: true}).count(), 0);
    if (newer === 'pending') {
     assert.equal(await summary.getByText(copy.logoutFailed, {exact: true}).count(), 0);
     second.release();
     await page.waitForFunction(() => (window as any).logoutCompletions === 2);
     await summary.getByText(copy.logoutFailed, {exact: true}).waitFor();
     assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('wt-form-error-summary')), true);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.STALE_SIGNOUT_RECEIPT_DIR && newer === 'failed') {
     await mkdir(process.env.STALE_SIGNOUT_RECEIPT_DIR, {recursive: true});
     await page.screenshot({path: `${process.env.STALE_SIGNOUT_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
    }
    await signOut.click();
    await page.getByText(copy.signedOut, {exact: true}).waitFor();
    assert.equal(attempts, 3);
    assert.equal(await summary.getByText(copy.logoutFailed, {exact: true}).count(), 0);
   } finally {
    first.release(); second.release(); await browser.close();
   }
  });
 }
}
