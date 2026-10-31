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

for (const locale of ['en', 'es']) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  for (const javaScriptEnabled of [false, true]) {
    const handlers = !javaScriptEnabled ? ['ordinary'] as const
      : locale === 'en' && theme === 'light' && width === 390
        ? ['ordinary', 'delayed', 'missing'] as const : ['ordinary', 'delayed'] as const;
    for (const handler of handlers) test(`${locale} ${theme} ${width}: browser-check waiting requires JavaScript=${javaScriptEnabled}${handler === 'ordinary' ? '' : ` (${handler} handler)`}`, async t => {
      const gate = createPublicGate({key: randomBytes(32), difficulty: 8, routes: () => [
        {publicHostname: 'sol.example.test', staffHostname: 'staff.sol.example.test', address: '127.0.0.1', port: 1},
      ]});
      const server = createServer((req, res) => {
        req.headers.host = 'sol.example.test';
        req.headers['x-waitron-sni'] = 'sol.example.test';
        req.headers['x-waitron-client-ip'] = '192.0.2.2';
        gate.handle(req, res);
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
      let release!: () => void;
      const held = new Promise<void>(resolve => {release = resolve;});
      try {
        context = await browser.newContext({javaScriptEnabled, locale, colorScheme: theme, viewport: {width, height: 800}});
        const page = await context.newPage();
        page.setDefaultTimeout(4000);
        let challengeEntered = false;
        const waitForHandler = () => t.waitFor(() => {
          assert.equal(challengeEntered, true, 'the challenge handler must observe the browser request');
        }, {timeout: 4000});
        await page.route('**/_cloud/challenge', async route => {
          if (handler === 'delayed') await new Promise(resolve => setTimeout(resolve, 100));
          if (handler !== 'missing') challengeEntered = true;
          await held;
          await route.fulfill({status: 503, contentType: 'application/json', body: 'unavailable'});
        });
        const response = await page.goto(`http://127.0.0.1:${address.port}/public/availability`);
        assert.equal(response?.status(), 403);
        assert.equal(response.headers()['content-security-policy'], "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        if (handler === 'missing') {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await assert.rejects(Promise.race([
              waitForHandler(), new Promise<void>(resolve => {timer = setTimeout(resolve, 5000);}),
            ]), /waitFor\(\) timed out/);
          } finally {clearTimeout(timer);}
          return;
        }
        if (javaScriptEnabled) await waitForHandler();
        assert.equal(await page.getByText('Please wait a moment.', {exact: false}).isVisible(), javaScriptEnabled);
        assert.equal(await page.getByText('Espera un momento.', {exact: true}).isVisible(), javaScriptEnabled);
        assert.equal(await page.locator('#browser-guidance').isVisible(), !javaScriptEnabled);
        if (!javaScriptEnabled) {
          const visible = await page.locator('body').innerText();
          assert.match(visible, /Allow JavaScript or try another browser/);
          assert.match(visible, /Permite JavaScript o prueba con otro navegador/);
          assert.doesNotMatch(visible, /Please wait a moment|Espera un momento/);
        }
        assert.equal(gate.stats().forwarded, 0);
        assert.equal((await page.context().cookies()).length, 0);
        if (process.env.PUBLIC_CHALLENGE_RECEIPT_DIR) {
          await mkdir(process.env.PUBLIC_CHALLENGE_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.PUBLIC_CHALLENGE_RECEIPT_DIR}/${locale}-${theme}-${width}-${javaScriptEnabled ? 'enabled' : 'disabled'}${handler === 'delayed' ? '-delayed' : ''}.png`});
        }
        if (javaScriptEnabled) {
          release();
          await page.getByText('Please reload to try again.', {exact: false}).waitFor();
          assert.equal(await page.getByText('Vuelve a cargar para intentarlo de nuevo.', {exact: true}).isVisible(), true);
          assert.equal(gate.stats().forwarded, 0);
        }
      } finally {
        release(); await context?.close(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
}
