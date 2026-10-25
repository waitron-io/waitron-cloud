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
 window.signoutApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const current = {id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-09-26T00:00:00Z',
  lastUsedAt: '2026-09-26T00:20:00Z', expiresAt: '2099-01-01T00:00:00Z', current: true};
const other = {...current, id: '22345678-1234-4234-8234-123456789abc', current: false};
type Scenario = 'current' | 'lost-reply' | 'other' | 'stale-revoke' | 'passive' | 'expired' | 'logout' | 'recheck-expired' | 'navigate-away' | 'single-navigation' | 'navigate-signup' | 'rejected-revoke' | 'passive-list' | 'recheck-unavailable' | 'new-session' | 'navigate-protected';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  const scenarios: Scenario[] = theme === 'light' && width === 390
    ? ['current', 'lost-reply', 'other', 'stale-revoke', 'passive', 'expired', 'logout', 'recheck-expired', 'navigate-away', 'single-navigation', 'navigate-signup', 'rejected-revoke', 'passive-list', 'recheck-unavailable', 'new-session', 'navigate-protected'] : ['current'];
  for (const scenario of scenarios) test(`${locale} ${theme} ${width}: ${scenario} session sign-out feedback`, async () => {
    const browser = await chromium.launch({headless: true});
    let releaseCheck!: () => void;
    const checkReply = new Promise<void>(resolve => {releaseCheck = resolve;});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale];
      let ended = false;
      let revoked = false;
      let rechecks = 0;
      const writes: {path: string; body: unknown}[] = [];
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        const anonymous = () => route.fulfill({status: 401, json: {error: scenario === 'expired' || scenario === 'recheck-expired' ? 'session_expired' : 'unauthenticated'}});
        if (route.request().method() === 'POST' && path !== '/session/activity') writes.push({path, body: route.request().postDataJSON()});
        if (path === '/session' || path === '/session/activity') {
          if (ended && ['navigate-away', 'single-navigation', 'navigate-signup', 'navigate-protected'].includes(scenario)) await checkReply;
          if (ended && path === '/session' && rechecks++ === 0) {
            if (scenario === 'recheck-unavailable') return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
            if (scenario === 'new-session') await checkReply;
          }
          return ended ? anonymous() : route.fulfill({json: {accountId: 'owner', expiresAt: current.expiresAt}});
        }
        if (path === '/sessions/revoke') {
          revoked = true;
          ended = scenario !== 'other';
          if (scenario === 'lost-reply') return route.abort('connectionreset');
          if (scenario === 'stale-revoke') return anonymous();
          if (scenario === 'rejected-revoke') return route.fulfill({status: 403, json: {error: 'forbidden'}});
          return route.fulfill({status: 204});
        }
        if (path === '/logout') { ended = true; return route.fulfill({status: 204}); }
        if (path === '/sessions') return ended ? anonymous() : route.fulfill({json: {sessions: revoked ? [current] : [current, other]}});
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
      await page.locator('.sessions').getByRole('button', {name: c.sessionSignOut, exact: true}).waitFor();
      if (scenario === 'passive' || scenario === 'expired' || scenario === 'passive-list') {
        ended = true;
        await page.evaluate(async scenario => {
          const app = (window as unknown as {signoutApp: {session: {check(): Promise<void>}; security: {load(): Promise<void>}}}).signoutApp;
          if (scenario === 'passive-list') await app.security.load();
          else await app.session.check();
        }, scenario);
      } else if (scenario === 'logout') {
        await page.getByRole('button', {name: c.signout, exact: true}).click();
      } else {
        const recheck = ['navigate-away', 'single-navigation', 'navigate-signup', 'new-session', 'navigate-protected'].includes(scenario) ? page.waitForRequest('**/api/account/session') : undefined;
        await page.locator('.sessions').getByRole('button', {name: scenario === 'other' ? c.sessionRevoke : c.sessionSignOut, exact: true}).click();
        if (recheck) {
          await recheck;
          await page.evaluate(scenario => {
            if (scenario === 'new-session') {
              window.dispatchEvent(new PageTransitionEvent('pagehide'));
              window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
              return;
            }
            const app = (window as unknown as {signoutApp: {navigate(path: string): void}}).signoutApp;
            if (scenario === 'navigate-protected') { app.navigate('/recover'); return; }
            if (scenario !== 'single-navigation') app.navigate('/signup');
            if (scenario !== 'navigate-signup') app.navigate('/login');
          }, scenario);
          if (scenario !== 'new-session') releaseCheck();
          await page.waitForFunction(() => (window as unknown as {signoutApp: {session: {state: {kind: string}}}}).signoutApp.session.state.kind === 'anonymous');
          releaseCheck();
        }
        if (scenario === 'recheck-unavailable') {
          await page.getByRole('status').filter({hasText: c.sessionUnavailable}).waitFor();
          // The finished failed check must not leave intent for a later passive read.
          await page.evaluate(async () => {
            await (window as unknown as {signoutApp: {session: {check(): Promise<void>}}}).signoutApp.session.check();
          });
        }
      }
      if (scenario === 'other') {
        await page.locator('.sessions').getByRole('status').filter({hasText: c.sessionRevoked}).waitFor();
        assert.equal(new URL(page.url()).pathname, '/account');
        assert.equal(await page.locator('.session-list li').count(), 1);
      } else if (scenario === 'navigate-signup') {
        await page.getByRole('heading', {name: c.signup, exact: true}).waitFor();
        assert.equal(new URL(page.url()).pathname, '/signup');
        assert.equal(await page.getByRole('status').count(), 0);
      } else {
        await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
        assert.equal(new URL(page.url()).pathname, '/login');
        const expected = scenario === 'expired' || scenario === 'recheck-expired' ? c.sessionExpired
          : ['passive', 'passive-list', 'stale-revoke', 'navigate-away', 'single-navigation', 'rejected-revoke', 'recheck-unavailable', 'new-session', 'navigate-protected'].includes(scenario) ? undefined : c.signedOut;
        if (expected) await page.getByRole('status').filter({hasText: expected}).waitFor();
        else assert.equal(await page.getByRole('status').count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal(await page.getByText(c.sessionRevoked, {exact: true}).count(), 0);
        if (scenario === 'current' && process.env.SIGNOUT_RECEIPT_DIR) {
          await mkdir(process.env.SIGNOUT_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.SIGNOUT_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
        }
        await page.getByRole('link', {name: c.signup, exact: true}).click();
        assert.equal(await page.getByText(c.signedOut, {exact: true}).count(), 0, 'navigation clears sign-out feedback');
      }
      assert.deepEqual(writes, scenario === 'passive' || scenario === 'expired' || scenario === 'passive-list' ? []
        : [{path: scenario === 'logout' ? '/logout' : '/sessions/revoke',
          body: scenario === 'logout' ? {} : {id: scenario === 'other' ? other.id : current.id}}]);
    } finally { releaseCheck(); await browser.close(); }
  });
}
