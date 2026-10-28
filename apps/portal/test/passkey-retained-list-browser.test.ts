import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
const id = '12345678-1234-4234-8234-123456789abc';
const key = {id, createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null};
const password = '  Current account password  ';

// Clearing cached rows on a failed refresh or hiding them without a successful list must fail.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  for (const failure of ['server refusal', 'lost reply'] as const) {
    test(`${locale} ${theme} ${width}: ${failure} keeps last-read passkeys until a read-only retry confirms removal`, async t => {
      const browser = await chromium.launch({headless: true});
      let release = () => {};
      const retryReply = new Promise<void>(resolve => {release = resolve;});
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
            if (path === '/passkeys/remove') return failure === 'lost reply' ? route.abort() : route.fulfill({status: 503, json: {error: 'unavailable'}});
          }
          if (path === '/passkeys') {
            reads++;
            if (reads === 1) return route.fulfill({json: {passkeys: [key]}});
            if (reads === 2) return route.fulfill({status: 503, json: {error: 'unavailable'}});
            await retryReply;
            return route.fulfill({json: {passkeys: []}});
          }
          return route.fulfill({status: 503, json: {error: 'unavailable'}});
        });
        await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
        const section = page.locator('.passkeys'), rows = section.locator('.passkey-list li');
        const field = section.locator('wt-input[name=passkeyPassword] input');
        await rows.getByRole('button', {name: c.passkeyRemove, exact: true}).waitFor();
        assert.equal(reads, 1); assert.equal(await rows.count(), 1);
        await field.fill(password);
        await rows.getByRole('button', {name: c.passkeyRemove, exact: true}).click();
        await section.getByRole('alert').getByText(c.passkeyChangeUncertain, {exact: true}).waitFor();
        assert.equal(reads, 2);
        assert.equal(await rows.count(), 1, 'a failed follow-up read must retain the last-read key');
        assert.equal(await rows.getByText(c.passkeyNeverUsed, {exact: false}).count(), 1);
        assert.equal(await section.getByText(c.passkeyNone, {exact: true}).count(), 0, 'a failed refresh cannot establish an empty list');
        assert.equal(await section.getByRole('alert').count(), 1);
        assert.equal(await field.inputValue(), '', 'an uncertain change clears the submitted password');
        const retry = section.getByRole('button', {name: c.retry, exact: true});
        assert.equal(await retry.isEnabled(), true);
        assert.deepEqual(writes, [{path: '/passkeys/remove', body: {id, password}}]);
        await retry.click();
        await t.waitFor(() => {assert.equal(reads, 3);}, {timeout: 4000});
        assert.equal(await retry.isDisabled(), true);
        assert.equal(await rows.count(), 1, 'the last-read key remains visible while retry is pending');
        await retry.evaluate(button => (button as HTMLElement).click());
        release();
        await section.getByText(c.passkeyNone, {exact: true}).waitFor();
        assert.equal(reads, 3, 'pending retry cannot duplicate the list read');
        assert.equal(await rows.count(), 0, 'only the successful empty list removes the retained key');
        assert.equal(await retry.count(), 0); assert.equal(await section.getByRole('alert').count(), 0);
        assert.deepEqual(writes, [{path: '/passkeys/remove', body: {id, password}}], 'retry reads current keys without repeating removal');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } finally {release(); await browser.close();}
    });
  }
}
