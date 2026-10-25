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
const flows = [
  {path: '/signup', endpoint: '/signup/request', button: 'continue'},
  {path: '/forgot-password', endpoint: '/password-reset/request', button: 'sendReset'},
] as const;

// An operation-wide resend wait breaks the corrected-address submission; forgetting
// earlier addresses or treating a server wait as address-specific breaks the controls.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) for (const flow of flows) {
  test(`${locale} ${theme} ${width} ${flow.path}: a different address can be sent straight away`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(3000);
      await page.clock.install({time: new Date('2026-10-25T12:00:00Z')});
      await page.clock.pauseAt(new Date('2026-10-25T12:00:01Z'));
      const c = translations[locale], calls: {email: string; locale: string}[] = [];
      const other = flows.find(item => item.path !== flow.path)!, otherCalls: unknown[] = [];
      let limited = false;
      await page.route('https://portal.test/**', route => {
        const endpoint = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (endpoint === '/session') return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
        if (endpoint === flow.endpoint) {
          calls.push(route.request().postDataJSON());
          return limited
            ? route.fulfill({status: 429, headers: {'Retry-After': '90'}, json: {error: 'rate_limited'}})
            : route.fulfill({status: 202, json: {status: 'accepted'}});
        }
        if (endpoint === other.endpoint) {
          otherCalls.push(route.request().postDataJSON());
          return route.fulfill({status: 202, json: {status: 'accepted'}});
        }
        return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
      });
      await page.goto(`https://portal.test${flow.path}`);
      await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const input = page.locator('input[name=email]');
      const submit = page.getByRole('button', {name: c[flow.button], exact: true});
      const resend = page.getByRole('button', {name: c.resend, exact: true});
      const wait = page.getByRole('status').filter({hasText: c.cooldown});
      const change = page.getByRole('button', {name: c.changeEmail, exact: true});
      await input.fill('owner@exmaple.test'); await submit.click();
      await page.getByRole('heading', {name: c.checkEmail, exact: true}).waitFor();
      assert.equal(await resend.isDisabled(), true);
      await change.click();
      assert.equal(await submit.isDisabled(), true, 'returning to the same address keeps its minute');
      await input.fill('  OWNER@EXMAPLE.TEST  ');
      assert.equal(await submit.isDisabled(), true, 'case and surrounding spaces identify the same mailbox');
      assert.equal(calls.length, 1);
      await input.fill('owner@example.test');
      await t.test('a corrected address has no resend wait', async () => {
        assert.equal(await submit.isEnabled(), true, 'a different address must not inherit the resend wait');
        assert.equal(await wait.count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.CHANGE_EMAIL_RECEIPT_DIR) {
          await mkdir(process.env.CHANGE_EMAIL_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.CHANGE_EMAIL_RECEIPT_DIR}/${locale}-${theme}-${width}-${flow.path.slice(1)}.png`, fullPage: true});
        }
        await page.clock.fastForward(30_000);
        await submit.click(); await page.getByRole('heading', {name: c.checkEmail, exact: true}).waitFor();
        assert.deepEqual(calls, [{email: 'owner@exmaple.test', locale}, {email: 'owner@example.test', locale}]);
      });
      // Stop after the reproducer if it fails, without producing unrelated timeouts.
      if (!calls.at(1)) return;
      await t.test('each previously sent address keeps its own deadline', async () => {
        assert.equal(await resend.isDisabled(), true);
        await change.click(); await input.fill('owner@exmaple.test');
        assert.equal(await submit.isDisabled(), true, 'sending to another address cannot forget the first wait');
        await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        assert.equal(calls.length, 2, 'the submission guard also enforces the wait');
        await page.clock.fastForward(30_000);
        assert.equal(await submit.isEnabled(), true, 'the first address becomes available after its own minute');
        await input.fill('owner@example.test');
        assert.equal(await submit.isDisabled(), true, 'the second address still has half its minute left');
        await page.clock.fastForward(30_000);
        assert.equal(await submit.isEnabled(), true);
      });
      await t.test('server Retry-After blocks every address and survives navigation', async () => {
        limited = true;
        await input.fill('third@example.test'); await submit.click();
        await page.getByRole('alert').filter({hasText: c.limited}).waitFor();
        await input.fill('fourth@example.test');
        assert.equal(await submit.isDisabled(), true);
        assert.equal(await wait.textContent(), `${c.cooldown} 90 ${c.seconds}`);
        await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        assert.equal(calls.length, 3);
        await page.evaluate(path => {
          for (const next of ['/login', path]) {
            history.pushState(null, '', next); dispatchEvent(new PopStateEvent('popstate'));
          }
        }, flow.path);
        await input.fill('fifth@example.test');
        assert.equal(await submit.isDisabled(), true);
        await page.clock.fastForward(61_000);
        assert.equal(await submit.isDisabled(), true);
        await page.clock.fastForward(29_000);
        assert.equal(await submit.isEnabled(), true);
        assert.equal(calls.length, 3);
        limited = false; await submit.click();
        await page.getByRole('heading', {name: c.checkEmail, exact: true}).waitFor();
        assert.equal(await resend.isDisabled(), true);
        assert.deepEqual(calls, [
          {email: 'owner@exmaple.test', locale}, {email: 'owner@example.test', locale},
          {email: 'third@example.test', locale}, {email: 'fifth@example.test', locale},
        ]);
      });
      await t.test('sign-up and password recovery keep separate resend waits', async () => {
        await page.evaluate(path => {
          history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate'));
        }, other.path);
        await input.fill('fifth@example.test');
        const otherSubmit = page.getByRole('button', {name: c[other.button], exact: true});
        assert.equal(await otherSubmit.isEnabled(), true);
        await otherSubmit.click();
        await page.getByRole('heading', {name: c.checkEmail, exact: true}).waitFor();
        assert.deepEqual(otherCalls, [{email: 'fifth@example.test', locale}]);
        await page.evaluate(path => {
          history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate'));
        }, flow.path);
        await input.fill('fifth@example.test');
        assert.equal(await submit.isDisabled(), true, 'another operation cannot discard this address’s wait');
        await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        assert.equal(calls.length, 4);
      });
    } finally { await browser.close(); }
  });
}
