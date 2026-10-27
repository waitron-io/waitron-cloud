import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {chromium, type Route} from 'playwright';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const path of ['/connect', '/recover']) for (const locale of ['en', 'es'] as const)
for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280])
for (const failure of ['503', 'network'] as const) for (const setupDelay of [0, 1100])
for (const handler of ['normal', 'delayed', 'missing'] as const) {
  if (setupDelay && (locale !== 'en' || theme !== 'light' || width !== 390)) continue;
  if (handler !== 'normal' && setupDelay) continue;
  if (handler === 'missing' && (locale !== 'en' || theme !== 'light' || width !== 390 || failure !== '503')) continue;
  test(`${path} ${locale} ${theme} ${width} ${failure}${setupDelay ? ' with delayed clock setup' : ''}${handler === 'normal' ? '' : ` with ${handler} handler`}: retry appears only after the session check fails`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(3000);
      // The clock runs after installation; freeze before registering application timers.
      await page.clock.install({time: new Date('2026-10-24T12:00:01Z')});
      if (setupDelay) await delay(setupDelay);
      await page.clock.pauseAt(new Date('2026-10-25T12:00:01Z'));
      let held!: Route, handlerEntered = false, requests = 0;
      const unexpected: string[] = [];
      await page.route('https://portal.test/**', async route => {
        const endpoint = new URL(route.request().url()).pathname;
        if (endpoint === '/api/account/session') {
          requests++;
          if (requests === 1) {
            if (handler === 'delayed') await delay(100);
            held = route;
            if (handler !== 'missing') handlerEntered = true;
            return;
          }
          return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
        }
        if (!endpoint.startsWith('/api/')) return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
        unexpected.push(endpoint);
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto(`https://portal.test${path}#request=10000000-0000-4000-8000-000000000001`);
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const waitForHandler = () => t.waitFor(() => {
        assert.equal(handlerEntered, true, 'the first session route handler must enter');
      }, {timeout: 3000});
      if (handler === 'missing') {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await assert.rejects(Promise.race([
            waitForHandler(), new Promise<void>(resolve => {timer = setTimeout(resolve, 4000);}),
          ]), /waitFor\(\) timed out/);
          assert.equal(requests, 1, 'the missing signal belongs to the held first request');
          assert.deepEqual(unexpected, []);
        } finally {clearTimeout(timer);}
        return;
      }
      await waitForHandler();
      const checking = locale === 'en' ? 'Checking your session…' : 'Comprobando tu sesión…';
      const unavailable = locale === 'en' ? 'We could not check your session. Try again.' : 'No hemos podido comprobar tu sesión. Vuelve a intentarlo.';
      const retry = page.getByRole('button', {name: locale === 'en' ? 'Try again' : 'Volver a intentar', exact: true});
      assert.equal(await page.getByRole('status').textContent(), checking);
      assert.equal(requests, 1);
      assert.equal(await retry.count(), 0, 'an in-flight session check has no retry action');
      assert.equal(await page.locator('input[name=pairingCode], input[name=recoveryCode]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.SESSION_CHECKING_RECEIPT_DIR && failure === '503') {
        await mkdir(process.env.SESSION_CHECKING_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.SESSION_CHECKING_RECEIPT_DIR}/${path.slice(1)}-${locale}-${theme}-${width}.png`, fullPage: true});
      }
      if (failure === '503') await held.fulfill({status: 503, headers: {'Retry-After': '2'}, json: {error: 'temporarily_unavailable'}});
      else await held.abort('failed');
      await page.getByRole('status').filter({hasText: unavailable}).waitFor();
      assert.equal(await retry.count(), 1);
      assert.equal(requests, 1);
      if (failure === '503') {
        assert.equal(await retry.isDisabled(), true);
        await retry.evaluate(button => (button as HTMLElement).click());
        assert.equal(requests, 1, 'cooldown cannot start another session request');
        await page.clock.runFor(2000);
      }
      assert.equal(await retry.isEnabled(), true);
      await retry.click();
      await page.waitForURL('https://portal.test/login');
      assert.equal(requests, 2, 'retry starts a fresh session check');
      assert.deepEqual(unexpected, [], 'session checks never expose protected actions');
    } finally { await browser.close(); }
  });
}
