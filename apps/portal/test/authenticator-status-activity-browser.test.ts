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
 window.statusApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const at = '2026-10-24T12:00:00.000Z', expiresAt = '2030-01-01T00:00:00.000Z';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: session activity preserves a failed authenticator read until explicit retry`, async () => {
    const browser = await chromium.launch({headless: true});
    let releaseActivity!: () => void, releaseRetry!: () => void;
    const activityReply = new Promise<void>(resolve => {releaseActivity = resolve;});
    const retryReply = new Promise<void>(resolve => {releaseRetry = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      await page.clock.install({time: new Date(at)}); await page.clock.pauseAt(new Date(at));
      const c = translations[locale]; let reads = 0;
      const writes: string[] = [];
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
        if (request.method() === 'POST') writes.push(path);
        if (path === '/session/activity') { await activityReply; return route.fulfill({json: {accountId: 'owner', expiresAt: '2030-01-02T00:00:00.000Z'}}); }
        if (path === '/session') return route.fulfill({json: {accountId: 'owner', expiresAt}});
        if (path === '/authenticator') {
          reads++;
          if (reads === 1) return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
          await retryReply;
          return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.authenticator'), alert = section.getByRole('alert');
      const retry = section.getByRole('button', {name: c.retry, exact: true});
      await alert.getByText(c.factorUnavailable, {exact: true}).waitFor();
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await section.locator('input[name=factorPassword]').count(), 0, 'a failed read cannot offer setup controls');
      const activityRequest = page.waitForRequest('**/api/account/session/activity');
      await page.locator('h1').click(); await activityRequest;
      const activityResponse = page.waitForResponse('**/api/account/session/activity');
      releaseActivity(); await (await activityResponse).finished();
      await page.waitForFunction(() => (window as unknown as {statusApp: {session: {state: {expiresAt?: string}}}}).statusApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      assert.equal(await alert.getByText(c.factorUnavailable, {exact: true}).count(), 1, 'the completed activity reply must preserve status failure feedback');
      assert.equal(reads, 1, 'session activity cannot silently retry the failed status read');
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.AUTHENTICATOR_STATUS_RECEIPT_DIR) {
        await mkdir(process.env.AUTHENTICATOR_STATUS_RECEIPT_DIR, {recursive: true});
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({path: `${process.env.AUTHENTICATOR_STATUS_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      const retryRequest = page.waitForRequest('**/api/account/authenticator');
      await retry.click(); await retryRequest;
      assert.equal(await retry.isDisabled(), true, 'pending explicit retry disables its button');
      await retry.evaluate(button => (button as HTMLElement).click());
      releaseRetry();
      await section.getByText(c.factorOff, {exact: true}).waitFor();
      assert.equal(reads, 2);
      assert.equal(await retry.count(), 0); assert.equal(await alert.count(), 0);
      await section.getByRole('button', {name: c.factorEnable, exact: true}).waitFor();
      await page.getByRole('link', {name: c.forgot, exact: true}).click();
      await page.getByRole('link', {name: c.login, exact: true}).first().click();
      await page.getByRole('link', {name: 'Waitron Cloud', exact: true}).click();
      await section.getByText(c.factorOff, {exact: true}).waitFor();
      assert.equal(reads, 3, 'returning to Account still refreshes authenticator status');
      assert.deepEqual(writes, ['/session/activity'], 'status retry never changes the authenticator');
    } finally { releaseActivity(); releaseRetry(); await browser.close(); }
  });
}
