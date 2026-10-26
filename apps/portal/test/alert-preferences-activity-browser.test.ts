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
 window.alertActivityApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const at = '2026-10-24T12:00:00.000Z', expiresAt = '2030-01-01T00:00:00.000Z';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: session activity preserves a failed alert-preferences read until explicit retry`, async () => {
    const browser = await chromium.launch({headless: true});
    let releaseActivity!: () => void, releaseRetry!: () => void;
    const activityReply = new Promise<void>(resolve => {releaseActivity = resolve;});
    const retryReply = new Promise<void>(resolve => {releaseRetry = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      await page.clock.install({time: new Date(at)}); await page.clock.pauseAt(new Date(at));
      const c = translations[locale]; let reads = 0, sessionReads = 0;
      const writes: string[] = [];
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
        if (request.method() === 'POST') writes.push(path);
        if (path === '/session/activity') { await activityReply; return route.fulfill({json: {accountId: 'owner', expiresAt: '2030-01-02T00:00:00.000Z'}}); }
        if (path === '/session') return route.fulfill({json: {accountId: 'owner', expiresAt: ++sessionReads === 1 ? expiresAt : '2030-01-03T00:00:00.000Z'}});
        if (path === '/alerts') {
          reads++;
          if (reads === 1) return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
          await retryReply;
          return route.fulfill({json: {enabled: true, locale: 'es'}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.getByRole('region', {name: c.serviceAlerts, exact: true}), alert = section.getByRole('alert');
      const retry = section.getByRole('button', {name: c.alertsLoad, exact: true});
      await alert.getByText(c.unavailable, {exact: true}).waitFor();
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await section.locator('#service-alerts-enabled').count(), 0, 'a failed read cannot offer alert choices');
      const activityRequest = page.waitForRequest('**/api/account/session/activity');
      await page.locator('h1').click(); await activityRequest;
      const activityResponse = page.waitForResponse('**/api/account/session/activity');
      releaseActivity(); await (await activityResponse).finished();
      await page.waitForFunction(() => (window as unknown as {alertActivityApp: {session: {state: {expiresAt?: string}}}}).alertActivityApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      assert.equal(await alert.getByText(c.unavailable, {exact: true}).count(), 1, 'the completed activity reply must preserve alert-preferences failure feedback');
      assert.equal(reads, 1, 'session activity cannot silently retry the failed preferences read');
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.ALERT_ACTIVITY_RECEIPT_DIR) {
        await mkdir(process.env.ALERT_ACTIVITY_RECEIPT_DIR, {recursive: true});
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({path: `${process.env.ALERT_ACTIVITY_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      const retryRequest = page.waitForRequest('**/api/account/alerts');
      await retry.click(); await retryRequest;
      assert.equal(await retry.isDisabled(), true, 'pending explicit retry disables its button');
      await retry.evaluate(button => (button as HTMLElement).click());
      releaseRetry();
      await section.getByRole('checkbox', {name: c.alertsReceive, exact: true}).waitFor();
      assert.equal(reads, 2);
      assert.equal(await retry.count(), 0); assert.equal(await alert.count(), 0);
      await section.getByRole('button', {name: c.alertsSave, exact: true}).waitFor();
      await page.getByRole('link', {name: c.forgot, exact: true}).click();
      await page.getByRole('link', {name: c.login, exact: true}).first().click();
      const navigationCheck = page.waitForResponse('**/api/account/session');
      await page.getByRole('link', {name: 'Waitron Cloud', exact: true}).click();
      await (await navigationCheck).finished();
      await page.waitForFunction(() => (window as unknown as {alertActivityApp: {session: {state: {expiresAt?: string}}}}).alertActivityApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
      await page.waitForFunction(() => !(window as unknown as {alertActivityApp: {alerts: {pending: boolean}}}).alertActivityApp.alerts.pending);
      await section.getByRole('checkbox', {name: c.alertsReceive, exact: true}).waitFor();
      assert.equal(reads, 2, 'returning to Account keeps already loaded alert preferences');
      assert.deepEqual(writes, ['/session/activity'], 'preferences retry never saves choices');
    } finally { releaseActivity(); releaseRetry(); await browser.close(); }
  });
}

for (const scenario of ['cooldown', 'new account', 'blocked startup', 'failed navigation'] as const) {
  test(`alert-preferences retry preserves ${scenario} behavior`, async () => {
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
        if (path === '/alerts') {
          if (++reads === 1) return route.fulfill({status: ['new account', 'failed navigation'].includes(scenario) ? 503 : 429, headers: {'retry-after': ['new account', 'failed navigation'].includes(scenario) ? '0' : '30'}, json: {error: ['new account', 'failed navigation'].includes(scenario) ? 'temporarily_unavailable' : 'rate_limited'}});
          return route.fulfill({json: {enabled: true, locale: 'es'}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.getByRole('region', {name: c.serviceAlerts, exact: true}), retry = section.getByRole('button', {name: c.alertsLoad, exact: true});
      await section.getByRole('alert').getByText(['new account', 'failed navigation'].includes(scenario) ? c.unavailable : c.limited, {exact: true}).waitFor();
      if (scenario === 'cooldown' || scenario === 'blocked startup') {
        assert.equal(await retry.isDisabled(), true);
        await retry.evaluate(button => (button as HTMLElement).click());
        assert.equal(reads, 1, 'a programmatic retry cannot bypass the server wait');
        if (scenario === 'blocked startup') {
          await page.evaluate(() => (window as unknown as {alertActivityApp: {navigate(path: string): void}}).alertActivityApp.navigate('/account'));
          await page.waitForFunction(() => (window as unknown as {alertActivityApp: {session: {state: {expiresAt?: string}}}}).alertActivityApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
          assert.equal(reads, 1, 'navigation cannot bypass the server wait');
        }
        await page.clock.runFor(31_000);
        assert.equal(await retry.isEnabled(), true);
      }
      if (scenario === 'failed navigation') {
        const refreshed = page.waitForResponse('**/api/account/alerts');
        await page.evaluate(() => (window as unknown as {alertActivityApp: {navigate(path: string): void}}).alertActivityApp.navigate('/account'));
        await (await refreshed).finished();
      }
      const activity = page.waitForResponse('**/api/account/session/activity');
      await page.locator('h1').click(); await (await activity).finished();
      await page.waitForFunction(() => (window as unknown as {alertActivityApp: {session: {state: {expiresAt?: string}}}}).alertActivityApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      if (scenario === 'cooldown') {
        assert.equal(reads, 1, 'activity after a completed server wait leaves retry explicit');
        assert.equal(await section.getByRole('alert').getByText(c.limited, {exact: true}).count(), 1);
        await retry.click();
      }
      await section.getByRole('checkbox', {name: c.alertsReceive, exact: true}).waitFor();
      assert.equal(reads, 2, scenario === 'blocked startup' ? 'a blocked startup can run when the server wait ends' : 'account changes, failed-read navigation and explicit retry start a fresh preferences read');
      assert.equal(await section.getByRole('alert').count(), 0);
    } finally { await browser.close(); }
  });
}

// Resetting a pending read on navigation would allow activity to erase its later failure.
test('navigation during an alert read preserves its attempt and later failure', async () => {
  const browser = await chromium.launch({headless: true});
  let releaseRead!: () => void;
  const readReply = new Promise<void>(resolve => {releaseRead = resolve;});
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(4000);
    await page.clock.install({time: new Date(at)}); await page.clock.pauseAt(new Date(at));
    let reads = 0, sessionReads = 0;
    await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/api/account', '');
      if (path === '/session') return route.fulfill({json: {accountId: 'owner', expiresAt: ++sessionReads === 1 ? expiresAt : '2030-01-03T00:00:00.000Z'}});
      if (path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2030-01-02T00:00:00.000Z'}});
      if (path === '/alerts') {reads++; await readReply; return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});}
      if (path === '/installations') return route.fulfill({json: {installations: []}});
      return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    const section = page.getByRole('region', {name: translations.en.serviceAlerts, exact: true});
    await page.waitForFunction(() => (window as unknown as {alertActivityApp: {alerts: {pending: boolean}}}).alertActivityApp.alerts.pending);
    await page.evaluate(() => (window as unknown as {alertActivityApp: {navigate(path: string): void}}).alertActivityApp.navigate('/account'));
    await page.waitForFunction(() => (window as unknown as {alertActivityApp: {session: {state: {expiresAt?: string}}}}).alertActivityApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
    assert.equal(reads, 1, 'navigation cannot duplicate a pending alert read');
    releaseRead();
    await section.getByRole('alert').getByText(translations.en.unavailable, {exact: true}).waitFor();
    const activity = page.waitForResponse('**/api/account/session/activity');
    await page.locator('h1').click(); await (await activity).finished();
    await page.waitForFunction(() => (window as unknown as {alertActivityApp: {session: {state: {expiresAt?: string}}}}).alertActivityApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
    assert.equal(reads, 1, 'the completed read retains its attempt across navigation');
    assert.equal(await section.getByRole('alert').getByText(translations.en.unavailable, {exact: true}).count(), 1);
    assert.equal(await section.getByRole('button', {name: translations.en.alertsLoad, exact: true}).isEnabled(), true);
  } finally {releaseRead(); await browser.close();}
});
