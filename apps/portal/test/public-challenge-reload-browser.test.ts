import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright';
import {createPublicGate} from '../../../packages/remote-access/src/public-gate.ts';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
before(async () => {browser = await chromium.launch({headless: true});});
after(async () => {await browser?.close();});

// Removing the fallback link must prevent a visitor from restarting the real page request.
for (const locale of ['en', 'es']) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  for (const failure of ['503', 'disconnected', 'disabled'] as const) {
    test(`${locale} ${theme} ${width}: reload link restarts the browser check after ${failure}`, async () => {
      const gate = createPublicGate({key: randomBytes(32), difficulty: 8, routes: () => [
        {publicHostname: 'sol.example.test', staffHostname: 'staff.sol.example.test', address: '127.0.0.1', port: 1},
      ]});
      let pageRequests = 0;
      const server = createServer((req, res) => {
        if (req.url === '/public/availability') pageRequests++;
        req.headers.host = 'sol.example.test'; req.headers['x-waitron-sni'] = 'sol.example.test';
        req.headers['x-waitron-client-ip'] = '192.0.2.2'; gate.handle(req, res);
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
      let release!: () => void;
      const held = new Promise<void>(resolve => {release = resolve;});
      try {
        context = await browser.newContext({locale, colorScheme: theme, viewport: {width, height: 800}, javaScriptEnabled: failure !== 'disabled'});
        const page = await context.newPage(); page.setDefaultTimeout(4000);
        let recovered = false, requested!: () => void;
        const challenged = new Promise<void>(resolve => {requested = resolve;});
        await page.route('**/_cloud/challenge.js', async route => {
          if (recovered) await route.continue();
          else if (failure === '503') await route.fulfill({status: 503, body: 'unavailable'});
          else await route.abort('connectionreset');
        });
        await page.route('**/_cloud/challenge', async route => {
          requested(); await held;
          await route.fulfill({status: 503, contentType: 'application/json', body: 'unavailable'});
        });
        const url = `http://127.0.0.1:${address.port}/public/availability`;
        assert.equal((await page.goto(url))?.status(), 403);
        const reload = page.getByRole('link', {name: 'Reload page / Volver a cargar', exact: true});
        assert.equal(await reload.isVisible(), true, 'the fallback must offer a visible reload action');
        assert.equal(await reload.getAttribute('href'), '/public/availability');
        assert.equal(await reload.locator('[lang="es"]').innerText(), 'Volver a cargar');
        assert.equal(pageRequests, 1);
        assert.equal(gate.stats().forwarded, 0); assert.equal((await context.cookies()).length, 0);
        if (process.env.PUBLIC_CHALLENGE_RECEIPT_DIR) {
          await mkdir(process.env.PUBLIC_CHALLENGE_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.PUBLIC_CHALLENGE_RECEIPT_DIR}/${locale}-${theme}-${width}-${failure}.png`});
        }
        recovered = true;
        if (locale === 'es') {
          await page.keyboard.press('Tab');
          assert.equal(await reload.evaluate(element => element === document.activeElement), true);
        }
        const [response] = await Promise.all([
          page.waitForNavigation({waitUntil: 'load'}),
          locale === 'es' ? page.keyboard.press('Enter') : reload.click(),
        ]);
        assert.equal(response?.status(), 403); assert.equal(page.url(), url); assert.equal(pageRequests, 2);
        if (failure === 'disabled') {
          assert.equal(await reload.isVisible(), true);
          assert.doesNotMatch(await page.locator('body').innerText(), /Please wait a moment|Espera un momento/);
        } else {
          await challenged;
          assert.equal(await reload.isVisible(), false);
          assert.equal(await page.getByText('Please wait a moment.', {exact: false}).isVisible(), true);
          release();
          await page.getByText('Please reload to try again.', {exact: false}).waitFor();
          assert.equal(await reload.isVisible(), false);
        }
        assert.equal(gate.stats().forwarded, 0); assert.equal((await context.cookies()).length, 0);
      } finally {
        release(); await context?.close(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
}
