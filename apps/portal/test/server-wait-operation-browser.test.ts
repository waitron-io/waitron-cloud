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

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) for (const first of flows) for (const secondWait of [0, 5]) {
  test(`${locale} ${theme} ${width} ${first.path}: another operation's ${secondWait}-second refusal keeps each server wait`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(3000);
      await page.clock.install({time: new Date('2026-11-07T12:00:00Z')});
      await page.clock.pauseAt(new Date('2026-11-07T12:00:01Z'));
      const c = translations[locale], second = flows.find(flow => flow !== first)!;
      const calls: {endpoint: string; body: unknown}[] = [];
      await page.route('https://portal.test/**', route => {
        const endpoint = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (endpoint === '/session') return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
        if (endpoint === first.endpoint || endpoint === second.endpoint) {
          calls.push({endpoint, body: route.request().postDataJSON()});
          const seconds = endpoint === first.endpoint ? 90 : secondWait;
          return route.fulfill(seconds
            ? {status: 429, headers: {'Retry-After': String(seconds)}, json: {error: 'rate_limited'}}
            : {status: 503, json: {error: 'temporarily_unavailable'}});
        }
        return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
      });
      await page.goto(`https://portal.test${first.path}`);
      await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const navigate = async (path: string) => page.evaluate(next => {
        history.pushState(null, '', next); dispatchEvent(new PopStateEvent('popstate'));
      }, path);
      const input = page.locator('input[name=email]');
      const firstButton = page.getByRole('button', {name: c[first.button], exact: true});
      const secondButton = page.getByRole('button', {name: c[second.button], exact: true});
      const wait = page.getByRole('status').filter({hasText: c.cooldown});
      await input.fill('first@example.test'); await firstButton.click();
      await page.getByRole('alert').filter({hasText: c.limited}).waitFor();
      assert.equal(await wait.textContent(), `${c.cooldown} 90 ${c.seconds}`);
      await navigate(second.path); await input.fill('second@example.test');
      assert.equal(await secondButton.isEnabled(), true);
      await secondButton.click();
      await page.getByRole('alert').filter({hasText: secondWait ? c.limited : c.unavailable}).waitFor();
      await input.fill('corrected@example.test');
      assert.equal(await secondButton.isDisabled(), secondWait > 0, 'a refusal must not inherit the other operation’s wait');
      assert.equal(await wait.count(), secondWait ? 1 : 0);
      if (secondWait) assert.equal(await wait.textContent(), `${c.cooldown} 5 ${c.seconds}`);
      if (process.env.SERVER_WAIT_RECEIPT_DIR) {
        await mkdir(process.env.SERVER_WAIT_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.SERVER_WAIT_RECEIPT_DIR}/${locale}-${theme}-${width}-${first.path.slice(1)}-${secondWait}.png`, fullPage: true});
      }
      await navigate(first.path); await input.fill('another@example.test');
      assert.equal(await firstButton.isDisabled(), true, 'the original operation must retain its server wait');
      assert.equal(await wait.textContent(), `${c.cooldown} 90 ${c.seconds}`);
      await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      assert.deepEqual(calls, [
        {endpoint: first.endpoint, body: {email: 'first@example.test', locale}},
        {endpoint: second.endpoint, body: {email: 'second@example.test', locale}},
      ], 'programmatic submission must respect the original wait');
      await page.clock.fastForward(5000);
      await navigate(second.path); await input.fill('corrected@example.test');
      assert.equal(await secondButton.isEnabled(), true, 'the second wait expires independently');
      await navigate(first.path); await input.fill('another@example.test');
      assert.equal(await firstButton.isDisabled(), true);
      assert.equal(await wait.textContent(), `${c.cooldown} 85 ${c.seconds}`);
      await page.clock.fastForward(85_000);
      assert.equal(await firstButton.isEnabled(), true);
      assert.equal(await wait.count(), 0);
    } finally { await browser.close(); }
  });
}
