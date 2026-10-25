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

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: home keeps the account heading while checking and unavailable`, async () => {
    const browser = await chromium.launch({headless: true});
    let release!: () => void;
    const reply = new Promise<void>(resolve => {release = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale];
      let sessionReads = 0;
      await page.route('https://portal.test/', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        assert.equal(path, '/session', 'checking and unavailable do not load account sections');
        if (++sessionReads === 1) await reply;
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.getByRole('status').filter({hasText: c.checking}).waitFor();
      assert.equal(await page.locator('h1').textContent(), c.account);
      assert.equal(await page.title(), `${c.account} · Waitron Cloud`);
      assert.equal(await page.locator('wt-input').count(), 0);
      assert.equal(new URL(page.url()).pathname, '/');
      if (process.env.HOME_HEADING_RECEIPT_DIR) {
        await mkdir(process.env.HOME_HEADING_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.HOME_HEADING_RECEIPT_DIR}/${locale}-${theme}-${width}-checking.png`});
      }
      release();
      await page.getByRole('status').filter({hasText: c.sessionUnavailable}).waitFor();
      assert.equal(await page.locator('h1').textContent(), c.account);
      assert.equal(await page.title(), `${c.account} · Waitron Cloud`);
      assert.equal(await page.locator('wt-input').count(), 0);
      assert.equal(new URL(page.url()).pathname, '/');
      if (process.env.HOME_HEADING_RECEIPT_DIR) {
        await page.screenshot({path: `${process.env.HOME_HEADING_RECEIPT_DIR}/${locale}-${theme}-${width}-unavailable.png`});
      }
      const retry = page.getByRole('button', {name: c.retry, exact: true});
      const retried = page.waitForResponse('**/api/account/session');
      await retry.click();
      await retried;
      await page.getByRole('status').filter({hasText: c.sessionUnavailable}).waitFor();
      assert.equal(sessionReads, 2);
      assert.equal(await page.locator('h1').textContent(), c.account);
      assert.equal(await page.title(), `${c.account} · Waitron Cloud`);
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { release(); await browser.close(); }
  });
}

for (const locale of ['en', 'es'] as const) for (const outcome of ['anonymous', 'expired', 'authenticated'] as const) {
  test(`${locale}: home redirects a confirmed ${outcome} session with its original title and notice`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale});
      page.setDefaultTimeout(4000);
      const c = translations[locale];
      await page.route('https://portal.test/', route => route.fulfill({contentType: 'text/html', body: '<div id="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return outcome === 'authenticated'
          ? route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}})
          : route.fulfill({status: 401, json: {error: outcome === 'expired' ? 'session_expired' : 'unauthenticated'}});
        if (path === '/passkeys') return route.fulfill({json: {passkeys: []}});
        if (path === '/sessions') return route.fulfill({json: {sessions: []}});
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: false}});
        if (path === '/alerts') return route.fulfill({json: {enabled: false, locale}});
        if (path === '/translation-consent') return route.fulfill({json: {consents: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/');
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const title = outcome === 'authenticated' ? c.account : c.login;
      await page.getByRole('heading', {name: title, exact: true}).waitFor();
      assert.equal(new URL(page.url()).pathname, outcome === 'authenticated' ? '/account' : '/login');
      assert.equal(await page.title(), `${title} · Waitron Cloud`);
      if (outcome === 'authenticated') {
        await page.getByText(c.accountIntro, {exact: true}).waitFor();
        assert.equal(await page.locator('wt-input[name="email"]').count(), 0);
      } else {
        assert.equal(await page.locator('wt-input[name="email"]').count(), 1);
        assert.equal(await page.locator('wt-input[name="password"]').count(), 1);
        assert.equal(await page.getByRole('status').filter({hasText: c.sessionExpired}).count(), outcome === 'expired' ? 1 : 0);
        assert.equal(await page.getByText(c.signedOut, {exact: true}).count(), 0);
      }
    } finally { await browser.close(); }
  });
}
