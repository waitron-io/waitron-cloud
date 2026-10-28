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
const retained = {id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null};
const removed = {id: '22345678-1234-4234-8234-123456789abc', createdAt: '2026-10-25T12:00:00Z', lastUsedAt: null};
const password = '  Current account password  ';
const dates = {en: ['Oct 24, 2026', 'Oct 25, 2026'], es: ['24 oct 2026', '25 oct 2026']};

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: a lost removal reply reconciles the selected passkey and keeps the other key`, async t => {
    const browser = await chromium.launch({headless: true});
    let release = () => {};
    const listReply = new Promise<void>(resolve => {release = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale], writes: {path: string; body: unknown}[] = [];
      let reads = 0;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        if (path.startsWith('/passkeys/') && request.method() === 'POST') {
          writes.push({path, body: request.postDataJSON()});
          if (path === '/passkeys/remove') return route.abort();
        }
        if (path === '/passkeys') {
          reads++;
          if (reads === 1) return route.fulfill({json: {passkeys: [retained, removed]}});
          await listReply;
          return route.fulfill({json: {passkeys: [retained]}});
        }
        return route.fulfill({status: 503, json: {error: 'unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.passkeys'), rows = section.locator('.passkey-list li');
      const field = section.locator('wt-input[name=passkeyPassword] input');
      await rows.nth(1).getByRole('button', {name: c.passkeyRemove, exact: true}).waitFor();
      assert.equal(await rows.count(), 2);
      assert.equal(await rows.nth(0).getByText(dates[locale][0]!, {exact: false}).count(), 1);
      assert.equal(await rows.nth(1).getByText(dates[locale][1]!, {exact: false}).count(), 1);
      await field.fill(password);
      await rows.nth(1).getByRole('button', {name: c.passkeyRemove, exact: true}).click();
      await t.waitFor(() => {assert.equal(reads, 2);}, {timeout: 4000});
      assert.deepEqual(writes, [{path: '/passkeys/remove', body: {id: removed.id, password}}], 'the second row must remove its own key');
      assert.equal(await rows.count(), 2, 'a lost reply cannot establish which key remains');
      assert.equal(await section.getByText(c.passkeyRemoved, {exact: true}).count(), 0, 'confirmation waits for the follow-up list');
      assert.equal(await field.isDisabled(), true);
      for (const button of await rows.getByRole('button', {name: c.passkeyRemove, exact: true}).all()) assert.equal(await button.isDisabled(), true);
      release();
      await section.getByRole('status').getByText(c.passkeyRemoved, {exact: true}).waitFor();
      assert.equal(await rows.count(), 1, 'successful reconciliation preserves the other key');
      assert.equal(await rows.getByText(dates[locale][0]!, {exact: false}).count(), 1);
      assert.equal(await section.getByText(dates[locale][1]!, {exact: false}).count(), 0);
      assert.equal(await section.getByText(c.passkeyNone, {exact: true}).count(), 0);
      assert.equal(await section.getByRole('alert').count(), 0);
      assert.equal(await section.getByRole('button', {name: c.retry, exact: true}).count(), 0);
      assert.equal(await field.inputValue(), '');
      assert.equal(await rows.getByRole('button', {name: c.passkeyRemove, exact: true}).isEnabled(), true);
      assert.equal(reads, 2);
      assert.deepEqual(writes, [{path: '/passkeys/remove', body: {id: removed.id, password}}], 'reconciliation reads without repeating the removal');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_RECONCILIATION_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_RECONCILIATION_RECEIPT_DIR, {recursive: true});
        await section.screenshot({path: `${process.env.PASSKEY_RECONCILIATION_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
    } finally {release(); await browser.close();}
  });
}
