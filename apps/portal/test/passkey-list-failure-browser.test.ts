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
 window.listApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: a failed passkey read shows one alert and a retry, never none`, async () => {
    const browser = await chromium.launch({headless: true});
    let releaseList!: () => void;
    const listReply = new Promise<void>(resolve => {releaseList = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale];
      let lists = 0;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const endpoint = new URL(route.request().url()).pathname;
        if (endpoint.endsWith('/session') || endpoint.endsWith('/session/activity')) return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (endpoint.endsWith('/passkeys')) {
          lists++;
          if (lists === 1) return route.fulfill({status: 503, json: {error: 'unavailable'}});
          await listReply;
          return route.fulfill({json: {passkeys: []}});
        }
        if (endpoint.endsWith('/installations')) return route.fulfill({json: {installations: []}});
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.passkeys');
      await section.getByRole('alert').filter({hasText: c.passkeyUnavailable}).waitFor();
      assert.equal(await section.getByRole('alert').count(), 1);
      assert.equal(await section.getByText(c.passkeyNone, {exact: true}).count(), 0, 'a failed read is not evidence of an empty list');
      const retry = section.getByRole('button', {name: c.retry, exact: true});
      assert.equal(await retry.count(), 1);
      assert.equal(await retry.isEnabled(), true);
      assert.equal(lists, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_LIST_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_LIST_RECEIPT_DIR, {recursive: true});
        await section.screenshot({path: `${process.env.PASSKEY_LIST_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      // Navigation clears alerts, but must retain the completed-attempt gate and explicit retry.
      await page.evaluate(() => {
        const app = (window as unknown as {listApp: {navigate(path: string): void}}).listApp;
        app.navigate('/connect'); app.navigate('/account');
      });
      await retry.waitFor();
      await page.waitForFunction(() => {
        const app = (window as unknown as {listApp: {session: {state: {kind: string}}}}).listApp;
        return app.session.state.kind === 'authenticated';
      });
      assert.equal(lists, 1, 'returning to Account does not silently restart a failed read');
      assert.equal(await section.getByText(c.passkeyNone, {exact: true}).count(), 0);
      const requested = page.waitForRequest('**/api/account/passkeys');
      await retry.click();
      await requested;
      assert.equal(await retry.isDisabled(), true, 'retry cannot start a second read while pending');
      releaseList();
      await section.getByText(c.passkeyNone, {exact: true}).waitFor();
      assert.equal(lists, 2);
      assert.equal(await retry.count(), 0);
      assert.equal(await section.getByRole('alert').count(), 0);
      await page.close();
    } finally { releaseList(); await browser.close(); }
  });
}
