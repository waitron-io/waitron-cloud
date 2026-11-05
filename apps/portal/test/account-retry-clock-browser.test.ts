import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const id = '10000000-0000-4000-8000-000000000001', stamp = '2026-11-04T12:00:00Z', expiry = '2099-01-01T00:00:00Z';
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body); window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const scenarios = ['passkeys', 'authenticator', 'security', 'session', 'logout', 'login', 'factor', 'signup', 'reset', 'email'] as const;
for (const scenario of scenarios) for (const locale of ['en', 'es'] as const)
for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${scenario} ${locale} ${theme} ${width}: live waits survive clock corrections and expired waits stay ready`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}}); page.setDefaultTimeout(4000);
      await page.addInitScript(() => {
        const clock = {wall: Date.parse('2026-11-04T12:00:00Z'), elapsed: 0};
        (window as any).accountClock = clock; Date.now = () => clock.wall; performance.now = () => clock.elapsed;
      });
      let armed = false, attempts = 0;
      const anonymous = ['login', 'factor', 'signup', 'reset', 'email'].includes(scenario);
      const target = scenario === 'passkeys' ? '/passkeys' : scenario === 'authenticator' ? '/authenticator'
        : scenario === 'security' ? '/sessions' : scenario === 'session' ? '/session' : scenario === 'logout' ? '/logout'
        : scenario === 'login' ? '/login' : scenario === 'factor' ? '/login/factor' : scenario === 'reset' ? '/password-reset/request' : '/signup/request';
      const errors: string[] = [], unexpected: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('https://portal.test/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith('/api/')) return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
        if (armed && path === '/api/account' + target) {
          attempts++;
          if (scenario === 'email') return route.fulfill({status: 202, json: {status: 'accepted'}});
          return route.fulfill({status: 429, headers: attempts === 1 ? {'Retry-After': '2'} : {}, json: {error: 'rate_limited'}});
        }
        if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill(anonymous
          ? {status: 401, json: {error: 'unauthenticated'}} : {json: {accountId: 'owner', expiresAt: expiry}});
        if (path.endsWith('/installations')) return route.fulfill({json: {installations: []}});
        if (path.endsWith('/authenticator')) return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
        if (path.endsWith('/passkeys')) return route.fulfill({json: {passkeys: []}});
        if (path.endsWith('/sessions')) return route.fulfill({json: {sessions: [{id, current: true, createdAt: stamp, lastUsedAt: stamp, expiresAt: expiry}]}});
        if (path.endsWith('/alerts')) return route.fulfill({json: {enabled: false, locale}});
        if (path.endsWith('/translation-consent')) return route.fulfill({json: {consents: []}});
        if (path.endsWith('/login') && scenario === 'factor') return route.fulfill({status: 202, json: {factorRequired: true, challengeToken: 'A'.repeat(43), expiresAt: expiry}});
        unexpected.push(path); return route.fulfill({status: 500, json: {error: 'unplanned_request'}});
      });
      const path = scenario === 'reset' ? '/forgot-password' : ['signup', 'email'].includes(scenario) ? '/signup' : anonymous ? '/login' : '/account';
      await page.goto('https://portal.test' + path);
      await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      await page.waitForFunction(() => (window as any).app.session.state.kind !== 'checking');
      if (!anonymous) await page.waitForFunction(() => {const a = (window as any).app; return a.passkeys.loaded && a.authenticator.loaded && a.security.loaded;});
      const c = translations[locale];
      if (anonymous) {
        await page.locator('input[name=email]').fill('owner@example.test');
        if (['login', 'factor'].includes(scenario)) await page.locator('input[name=password]').fill('current password');
      }
      if (scenario === 'factor') {
        await page.locator('#submit').click();
        await page.locator('wt-input[name=factorProof] input').fill('123456');
      }
      armed = true;
      if (scenario === 'passkeys') await page.evaluate(() => (window as any).app.passkeys.refresh());
      else if (scenario === 'authenticator') await page.evaluate(() => (window as any).app.authenticator.refresh());
      else if (scenario === 'security') await page.evaluate(() => (window as any).app.security.load());
      else if (scenario === 'session') await page.evaluate(() => (window as any).app.session.check());
      else if (scenario === 'logout') await page.getByRole('button', {name: c.signout, exact: true}).click();
      else await page.locator('#submit').click();
      await page.waitForFunction(() => (window as any).app.waiting > 0);
      const wait = scenario === 'email' ? 60_000 : 2_000;
      const retry = scenario === 'passkeys' ? page.locator('.passkeys').getByRole('button', {name: c.retry, exact: true})
        : scenario === 'authenticator' ? page.locator('.authenticator').getByRole('button', {name: c.retry, exact: true})
        : scenario === 'security' ? page.locator('.sessions').getByRole('button', {name: c.retry, exact: true})
        : scenario === 'session' ? page.getByRole('button', {name: c.retry, exact: true})
        : scenario === 'logout' ? page.getByRole('button', {name: c.signout, exact: true})
        : scenario === 'email' ? page.getByRole('button', {name: c.resend, exact: true}) : page.locator('#submit button');
      for (const correction of [-3_600_000, 3_600_000]) {
        await page.evaluate(wall => {const w = window as any; w.accountClock.wall = wall; w.app.draw();}, Date.parse(stamp) + correction);
        assert.equal(await page.evaluate(() => (window as any).app.waiting), wait / 1000);
        assert.equal(await retry.isDisabled(), true);
        if (scenario === 'signup') {
          await page.evaluate(() => {
            const a = (window as any).app;
            a.navigate('/forgot-password'); a.fields.email = 'owner@example.test'; a.draw();
          });
          assert.equal(await page.evaluate(() => (window as any).app.waiting), 0, 'signup refusal cannot delay a password-reset request');
          assert.equal(await page.locator('#submit button').isEnabled(), true);
          await page.evaluate(() => {
            const a = (window as any).app;
            a.navigate('/signup'); a.fields.email = 'owner@example.test'; a.draw();
          });
          assert.equal(await page.evaluate(() => (window as any).app.waiting), 2, 'returning to signup retains its own live refusal');
          assert.equal(await retry.isDisabled(), true);
          assert.equal(attempts, 1);
        }
        if (scenario === 'session') {
          for (const path of ['/connect', '/recover', '/account']) {
            await page.evaluate(path => (window as any).app.navigate(path), path);
            assert.equal(await page.evaluate(() => (window as any).app.waiting), 2);
            assert.equal(await page.evaluate(() => (window as any).app.logoutWaiting), 2);
            assert.equal(attempts, 1);
          }
        }
      }
      await page.evaluate(elapsed => {const w = window as any; w.accountClock.elapsed = elapsed; w.app.draw();}, wait - 1);
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 1); assert.equal(await retry.isDisabled(), true);
      await page.evaluate(elapsed => {const w = window as any; w.accountClock.elapsed = elapsed; w.accountClock.wall -= 7_200_000; w.app.draw();}, wait);
      assert.equal(await page.evaluate(() => (window as any).app.waiting), 0); assert.equal(await retry.isEnabled(), true);
      assert.equal(attempts, 1, 'clock changes and expiry must not send requests');
      if (process.env.ACCOUNT_CLOCK_RECEIPT_DIR) {
        await mkdir(process.env.ACCOUNT_CLOCK_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.ACCOUNT_CLOCK_RECEIPT_DIR}/${scenario}-${locale}-${theme}-${width}.png`, fullPage: true});
      }
      // Controllers and their rendered buttons must agree on the exact expiry boundary.
      if (scenario === 'login') await page.locator('input[name=password]').fill('current password');
      if (scenario === 'factor') await page.locator('wt-input[name=factorProof] input').fill('123456');
      await retry.click(); await page.waitForFunction(() => !(window as any).app.pending);
      await page.waitForFunction(expected => {
        const a = (window as any).app;
        return !a.passkeys.pending && !a.authenticator.pending && !a.security.pending && a.waiting === expected;
      }, scenario === 'email' ? 60 : 0);
      assert.equal(attempts, 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    } finally {await browser.close();}
  });
}
