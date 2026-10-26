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
 window.sessionListApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const at = '2026-10-24T12:00:00.000Z', expiresAt = '2030-01-01T00:00:00.000Z';
const current = {id: '12345678-1234-4234-8234-123456789abc', createdAt: at, lastUsedAt: at, expiresAt, current: true};

// Repeating startup after a failed list would clear its alert and start a hidden retry.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: session activity preserves a failed session list until explicit retry`, async () => {
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
        if (path === '/sessions') {
          if (++reads === 1) return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
          await retryReply;
          return route.fulfill({json: {sessions: [current]}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.sessions'), alert = section.getByRole('alert');
      const retry = section.getByRole('button', {name: c.retry, exact: true});
      await alert.getByText(c.unavailable, {exact: true}).waitFor();
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await section.getByRole('button', {name: c.sessionSignOut, exact: true}).count(), 0);
      const activityRequest = page.waitForRequest('**/api/account/session/activity');
      await page.locator('h1').click(); await activityRequest;
      const activityResponse = page.waitForResponse('**/api/account/session/activity');
      releaseActivity(); await (await activityResponse).finished();
      await page.waitForFunction(() => (window as unknown as {sessionListApp: {session: {state: {expiresAt?: string}}}}).sessionListApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      assert.equal(await alert.getByText(c.unavailable, {exact: true}).count(), 1, 'activity must preserve the failed session-list feedback');
      assert.equal(reads, 1, 'activity cannot silently retry the failed list');
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.SESSION_LIST_RECEIPT_DIR) {
        await mkdir(process.env.SESSION_LIST_RECEIPT_DIR, {recursive: true});
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({path: `${process.env.SESSION_LIST_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      const retryRequest = page.waitForRequest('**/api/account/sessions');
      await retry.click(); await retryRequest;
      assert.equal(await section.getByRole('button').count(), 0, 'a pending read cannot offer another action');
      await page.evaluate(async () => {const app = (window as unknown as {sessionListApp: {security: {load(): Promise<void>}}}).sessionListApp; await app.security.load();});
      assert.equal(reads, 2, 'pending retries cannot duplicate the read');
      releaseRetry();
      await section.getByText(c.currentSession, {exact: true}).waitFor();
      assert.equal(await retry.count(), 0); assert.equal(await alert.count(), 0);
      await section.getByRole('button', {name: c.sessionSignOut, exact: true}).waitFor();
      await page.getByRole('link', {name: c.forgot, exact: true}).click();
      await page.getByRole('link', {name: c.login, exact: true}).first().click();
      const navigationList = page.waitForResponse('**/api/account/sessions');
      await page.getByRole('link', {name: 'Waitron Cloud', exact: true}).click();
      await (await navigationList).finished();
      await page.waitForFunction(() => {const security = (window as unknown as {sessionListApp: {security: {loaded: boolean; pending: boolean}}}).sessionListApp.security; return security.loaded && !security.pending;});
      await section.getByText(c.currentSession, {exact: true}).waitFor();
      assert.equal(reads, 3, 'returning to Account still refreshes the list');
      assert.deepEqual(writes, ['/session/activity'], 'list retry never revokes a session');
    } finally { releaseActivity(); releaseRetry(); await browser.close(); }
  });
}

for (const scenario of ['cooldown', 'new account', 'blocked startup'] as const) {
  test(`session-list retry preserves ${scenario} behavior`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage(); page.setDefaultTimeout(4000);
      await page.clock.install({time: new Date(at)}); await page.clock.pauseAt(new Date(at));
      const c = translations.en; let reads = 0, sessionReads = 0;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (path === '/session') return route.fulfill({json: {accountId: 'owner', expiresAt: ++sessionReads === 1 ? expiresAt : '2030-01-03T00:00:00.000Z'}});
        if (path === '/session/activity') return route.fulfill({json: {accountId: scenario === 'new account' ? 'other' : 'owner', expiresAt: '2030-01-02T00:00:00.000Z'}});
        if (path === '/sessions') {
          if (++reads === 1) return route.fulfill({status: scenario === 'new account' ? 503 : 429, headers: {'retry-after': scenario === 'new account' ? '0' : '30'}, json: {error: scenario === 'new account' ? 'temporarily_unavailable' : 'rate_limited'}});
          return route.fulfill({json: {sessions: [{...current, id: '22345678-1234-4234-8234-123456789abc'}]}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.locator('.sessions'), retry = section.getByRole('button', {name: c.retry, exact: true});
      await section.getByRole('alert').getByText(scenario === 'new account' ? c.unavailable : c.limited, {exact: true}).waitFor();
      if (scenario !== 'new account') {
        assert.equal(await retry.isDisabled(), true);
        await retry.evaluate(button => (button as HTMLElement).click());
        assert.equal(reads, 1, 'a programmatic retry cannot bypass the server wait');
        if (scenario === 'blocked startup') {
          await page.evaluate(() => (window as unknown as {sessionListApp: {navigate(path: string): void}}).sessionListApp.navigate('/account'));
          await page.waitForFunction(() => (window as unknown as {sessionListApp: {session: {state: {expiresAt?: string}}}}).sessionListApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
          assert.equal(reads, 1, 'navigation cannot bypass the server wait');
        }
        await page.clock.runFor(31_000);
        if (scenario === 'cooldown') assert.equal(await retry.isEnabled(), true);
      }
      const activity = page.waitForResponse('**/api/account/session/activity');
      await page.locator('h1').click(); await (await activity).finished();
      await page.waitForFunction(() => (window as unknown as {sessionListApp: {session: {state: {expiresAt?: string}}}}).sessionListApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      if (scenario === 'cooldown') {
        assert.equal(reads, 1, 'activity after a completed server wait leaves retry explicit');
        assert.equal(await section.getByRole('alert').getByText(c.limited, {exact: true}).count(), 1);
        await retry.click();
      }
      await section.getByText(c.currentSession, {exact: true}).waitFor();
      assert.equal(reads, 2, scenario === 'blocked startup' ? 'a blocked startup can run when the server wait ends' : 'a new account or explicit retry starts a fresh list read');
      assert.equal(await section.getByRole('alert').count(), 0);
    } finally { await browser.close(); }
  });
}
