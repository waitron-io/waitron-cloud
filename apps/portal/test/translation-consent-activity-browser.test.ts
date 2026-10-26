import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const venue='20000000-0000-4000-8000-000000000001';
const installation={installationId:venue,venueId:venue,organisationId:venue,legalBusinessId:venue,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:'Test organisation',businessName:'Test venue',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.translationActivityApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const at = '2026-10-24T12:00:00.000Z', expiresAt = '2030-01-01T00:00:00.000Z';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: session activity preserves a failed translation-consent read until explicit retry`, async () => {
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
        if (path === '/translation-consent') {
          reads++;
          if (reads === 1) return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
          await retryReply;
          return route.fulfill({json: {consents: []}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: [installation]}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.getByRole('group', {name: c.translationConsent, exact: true}), alert = section.getByRole('alert');
      const retry = section.getByRole('button', {name: c.translationConsentRefresh, exact: true});
      await alert.getByText(c.unavailable, {exact: true}).waitFor();
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await section.getByRole('button', {name: c.translationConsentAgree, exact: true}).isDisabled(), true, 'a failed read cannot permit consent changes');
      const activityRequest = page.waitForRequest('**/api/account/session/activity');
      await page.locator('h1').click(); await activityRequest;
      const activityResponse = page.waitForResponse('**/api/account/session/activity');
      releaseActivity(); await (await activityResponse).finished();
      await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      assert.equal(await alert.getByText(c.unavailable, {exact: true}).count(), 1, 'the completed activity reply must preserve translation-consent failure feedback');
      assert.equal(reads, 1, 'session activity cannot silently retry the failed consent read');
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.TRANSLATION_ACTIVITY_RECEIPT_DIR) {
        await mkdir(process.env.TRANSLATION_ACTIVITY_RECEIPT_DIR, {recursive: true});
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({path: `${process.env.TRANSLATION_ACTIVITY_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      const retryRequest = page.waitForRequest('**/api/account/translation-consent');
      await retry.click(); await retryRequest;
      assert.equal(await retry.isDisabled(), true, 'pending explicit retry disables its button');
      await retry.evaluate(button => (button as HTMLElement).click());
      releaseRetry();
      await page.waitForFunction(() => (window as any).translationActivityApp.translationConsent.loaded);
      assert.equal(await section.getByRole('button', {name: c.translationConsentAgree, exact: true}).isEnabled(), true);
      assert.equal(reads, 2);
      assert.equal(await retry.count(), 0); assert.equal(await alert.count(), 0);

      await page.getByRole('link', {name: c.forgot, exact: true}).click();
      await page.getByRole('link', {name: c.login, exact: true}).first().click();
      const navigationCheck = page.waitForResponse('**/api/account/session');
      await page.getByRole('link', {name: 'Waitron Cloud', exact: true}).click();
      await (await navigationCheck).finished();
      await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
      await page.waitForFunction(() => !(window as unknown as {translationActivityApp: {translationConsent: {pending: boolean}}}).translationActivityApp.translationConsent.pending);
      await page.waitForFunction(() => (window as any).translationActivityApp.translationConsent.loaded);
      assert.equal(await section.getByRole('button', {name: c.translationConsentAgree, exact: true}).isEnabled(), true);
      assert.equal(reads, 2, 'returning to Account keeps already loaded translation consent');
      assert.deepEqual(writes, ['/usage/read', '/session/activity'], 'consent retry never saves choices');
    } finally { releaseActivity(); releaseRetry(); await browser.close(); }
  });
}

for (const scenario of ['cooldown', 'new account', 'blocked startup', 'failed navigation'] as const) {
  test(`translation-consent retry preserves ${scenario} behavior`, async () => {
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
        if (path === '/translation-consent') {
          if (++reads === 1) return route.fulfill({status: ['new account', 'failed navigation'].includes(scenario) ? 503 : 429, headers: {'retry-after': ['new account', 'failed navigation'].includes(scenario) ? '0' : '30'}, json: {error: ['new account', 'failed navigation'].includes(scenario) ? 'temporarily_unavailable' : 'rate_limited'}});
          return route.fulfill({json: {consents: []}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: [installation]}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.getByRole('group', {name: c.translationConsent, exact: true}), retry = section.getByRole('button', {name: c.translationConsentRefresh, exact: true});
      await section.getByRole('alert').getByText(['new account', 'failed navigation'].includes(scenario) ? c.unavailable : c.limited, {exact: true}).waitFor();
      if (scenario === 'cooldown' || scenario === 'blocked startup') {
        assert.equal(await retry.isDisabled(), true);
        await retry.evaluate(button => (button as HTMLElement).click());
        assert.equal(reads, 1, 'a programmatic retry cannot bypass the server wait');
        if (scenario === 'blocked startup') {
          await page.evaluate(() => (window as unknown as {translationActivityApp: {navigate(path: string): void}}).translationActivityApp.navigate('/account'));
          await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
          assert.equal(reads, 1, 'navigation cannot bypass the server wait');
        }
        await page.clock.runFor(31_000);
        assert.equal(await retry.isEnabled(), true);
      }
      if (scenario === 'failed navigation') {
        const refreshed = page.waitForResponse('**/api/account/translation-consent');
        await page.evaluate(() => (window as unknown as {translationActivityApp: {navigate(path: string): void}}).translationActivityApp.navigate('/account'));
        await (await refreshed).finished();
      }
      const activity = page.waitForResponse('**/api/account/session/activity');
      await page.locator('h1').click(); await (await activity).finished();
      await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      if (scenario === 'cooldown') {
        assert.equal(reads, 1, 'activity after a completed server wait leaves retry explicit');
        assert.equal(await section.getByRole('alert').getByText(c.limited, {exact: true}).count(), 1);
        await retry.click();
      }
      await page.waitForFunction(() => (window as any).translationActivityApp.translationConsent.loaded);
      assert.equal(await section.getByRole('button', {name: c.translationConsentAgree, exact: true}).isEnabled(), true);
      assert.equal(reads, 2, scenario === 'blocked startup' ? 'a blocked startup can run when the server wait ends' : 'account changes, failed-read navigation and explicit retry start a fresh consent read');
      assert.equal(await section.getByRole('alert').count(), 0);
    } finally { await browser.close(); }
  });
}

// Resetting a pending read on navigation would allow activity to erase its later failure.
test('navigation during a translation-consent read preserves its attempt and later failure', async () => {
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
      if (path === '/translation-consent') {reads++; await readReply; return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});}
      if (path === '/installations') return route.fulfill({json: {installations: [installation]}});
      return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    const section = page.getByRole('group', {name: translations.en.translationConsent, exact: true});
    await page.waitForFunction(() => (window as unknown as {translationActivityApp: {translationConsent: {pending: boolean}}}).translationActivityApp.translationConsent.pending);
    await page.evaluate(() => (window as unknown as {translationActivityApp: {navigate(path: string): void}}).translationActivityApp.navigate('/account'));
    await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
    assert.equal(reads, 1, 'navigation cannot duplicate a pending translation-consent read');
    releaseRead();
    await section.getByRole('alert').getByText(translations.en.unavailable, {exact: true}).waitFor();
    const activity = page.waitForResponse('**/api/account/session/activity');
    await page.locator('h1').click(); await (await activity).finished();
    await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
    assert.equal(reads, 1, 'the completed read retains its attempt across navigation');
    assert.equal(await section.getByRole('alert').getByText(translations.en.unavailable, {exact: true}).count(), 1);
    assert.equal(await section.getByRole('button', {name: translations.en.translationConsentRefresh, exact: true}).isEnabled(), true);
  } finally {releaseRead(); await browser.close();}
});


for (const status of [401, 403]) {
  test(`a refused consent change (${status}) after navigation stays visible until explicit Refresh`, async () => {
    const browser = await chromium.launch({headless: true});
    let releaseActivity!: () => void;
    const activityReply = new Promise<void>(resolve => {releaseActivity = resolve;});
    try {
      const page = await browser.newPage(); page.setDefaultTimeout(4000);
      await page.clock.install({time: new Date(at)}); await page.clock.pauseAt(new Date(at));
      const c = translations.en; let reads = 0, writes = 0, sessionReads = 0;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
        if (path === '/session') return route.fulfill({json: {accountId: 'owner', expiresAt: ++sessionReads === 1 ? expiresAt : '2030-01-03T00:00:00.000Z'}});
        if (path === '/session/activity') {await activityReply; return route.fulfill({json: {accountId: 'owner', expiresAt: '2030-01-02T00:00:00.000Z'}});}
        if (path === '/translation-consent') {
          if (request.method() === 'POST') {writes++; return route.fulfill({status, json: {error: status === 401 ? 'unauthenticated' : 'forbidden'}});}
          reads++; return route.fulfill({json: {consents: []}});
        }
        if (path === '/installations') return route.fulfill({json: {installations: [installation]}});
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account'); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const section = page.getByRole('group', {name: c.translationConsent, exact: true});
      const choice = section.getByRole('button', {name: c.translationConsentAgree, exact: true});
      await page.waitForFunction(() => (window as any).translationActivityApp.translationConsent.loaded);
      await page.evaluate(() => (window as unknown as {translationActivityApp: {navigate(path: string): void}}).translationActivityApp.navigate('/account'));
      await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-03T00:00:00.000Z');
      const activityRequest = page.waitForRequest('**/api/account/session/activity');
      await page.locator('h1').click(); await activityRequest;
      await section.getByRole('button', {name: c.translationConsentAgree, exact: true}).click();
      const refusal = section.getByRole('alert').getByText(status === 401 ? c.pairSession : c.forbidden, {exact: true});
      await refusal.waitFor(); assert.equal(await choice.isDisabled(), true, 'a refused change clears loaded consent authority');
      const activityResponse = page.waitForResponse('**/api/account/session/activity');
      releaseActivity(); await (await activityResponse).finished();
      await page.waitForFunction(() => (window as unknown as {translationActivityApp: {session: {state: {expiresAt?: string}}}}).translationActivityApp.session.state.expiresAt === '2030-01-02T00:00:00.000Z');
      await page.waitForFunction(() => !(window as unknown as {translationActivityApp: {translationConsent: {pending: boolean}}}).translationActivityApp.translationConsent.pending);
      assert.equal(reads, 1, 'activity cannot replace a refused consent change with an automatic read after navigation');
      assert.equal(await refusal.count(), 1);
      await section.getByRole('button', {name: c.translationConsentRefresh, exact: true}).click();
      await page.waitForFunction(() => (window as any).translationActivityApp.translationConsent.loaded); assert.equal(reads, 2); assert.equal(writes, 1, 'Refresh never repeats the refused consent change');
      assert.equal(await section.getByRole('alert').count(), 0);
    } finally {releaseActivity(); await browser.close();}
  });
}
