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

// Losing the live status semantics or replacing its node on failure breaks these journeys.
for (const locale of ['en', 'es']) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  for (const failure of ['challenge', 'worker'] as const) {
    const handlers = locale === 'en' && theme === 'light' && width === 390 && failure === 'challenge'
      ? ['ordinary', 'delayed', 'missing'] as const : ['ordinary', 'delayed'] as const;
    for (const handler of handlers) test(`${locale} ${theme} ${width}: browser-check status survives ${failure} failure${handler === 'ordinary' ? '' : ` (${handler} handler)`}`, async t => {
      const gate = createPublicGate({key: randomBytes(32), difficulty: 8, routes: () => [
        {publicHostname: 'sol.example.test', staffHostname: 'staff.sol.example.test', address: '127.0.0.1', port: 1},
      ]});
      const server = createServer((req, res) => {
        req.headers.host = 'sol.example.test'; req.headers['x-waitron-sni'] = 'sol.example.test';
        req.headers['x-waitron-client-ip'] = '192.0.2.2'; gate.handle(req, res);
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
      let release!: () => void;
      let challengeEntered = false;
      const held = new Promise<void>(resolve => {release = resolve;});
      const waitForHandler = () => t.waitFor(() => {
        assert.equal(challengeEntered, true, 'the challenge handler must observe the browser request');
      }, {timeout: 4000});
      try {
        context = await browser.newContext({locale, colorScheme: theme, viewport: {width, height: 800}});
        const page = await context.newPage(); page.setDefaultTimeout(4000);
        await page.route('**/_cloud/challenge', async route => {
          if (handler === 'delayed') await new Promise(resolve => setTimeout(resolve, 100));
          if (handler !== 'missing') challengeEntered = true;
          await held;
          if (failure === 'challenge') await route.fulfill({status: 503, body: 'unavailable'});
          else await route.continue();
        });
        if (failure === 'worker') await page.route('**/_cloud/worker.js', route => route.fulfill({
          contentType: 'application/javascript', body: 'throw new Error("worker unavailable");',
        }));
        assert.equal((await page.goto(`http://127.0.0.1:${address.port}/public/availability`))?.status(), 403);
        if (handler === 'missing') {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await assert.rejects(Promise.race([
              waitForHandler(), new Promise<void>(resolve => {timer = setTimeout(resolve, 5000);}),
            ]), /waitFor\(\) timed out/);
          } finally {clearTimeout(timer);}
          return;
        }
        await waitForHandler();
        const status = page.getByRole('status');
        assert.equal(await status.count(), 1, 'the running browser check must expose a status region');
        assert.match(await status.innerText(), /Please wait a moment/);
        assert.equal(await status.locator('[lang="es"]').innerText(), 'Espera un momento.');
        const client = await context.newCDPSession(page);
        const waiting = (await client.send('Accessibility.getFullAXTree')).nodes.find(node => node.role?.value === 'status');
        assert.ok(waiting);
        assert.equal(waiting.properties?.find(property => property.name === 'live')?.value.value, 'polite');
        assert.equal(waiting.properties?.find(property => property.name === 'atomic')?.value.value, true);
        const original = await status.elementHandle(); assert.ok(original);
        release();
        await status.getByText(failure === 'worker' ? 'This browser check could not finish.' : 'Please reload to try again.', {exact: false}).waitFor();
        assert.equal(await status.evaluate((element, previous) => element === previous, original), true);
        assert.match(await status.locator('[lang="es"]').innerText(), failure === 'worker'
          ? /No se pudo completar la comprobación/ : /Vuelve a cargar para intentarlo de nuevo/);
        const failed = (await client.send('Accessibility.getFullAXTree')).nodes.find(node => node.role?.value === 'status');
        assert.ok(failed); assert.equal(failed.backendDOMNodeId, waiting.backendDOMNodeId);
        assert.equal(failed.properties?.find(property => property.name === 'live')?.value.value, 'polite');
        assert.equal(failed.properties?.find(property => property.name === 'atomic')?.value.value, true);
        assert.equal(await page.getByRole('link', {name: 'Reload page / Volver a cargar', exact: true}).isVisible(), true);
        assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
        assert.equal(gate.stats().forwarded, 0); assert.equal((await context.cookies()).length, 0);
        if (process.env.PUBLIC_CHALLENGE_RECEIPT_DIR && failure === 'challenge') {
          await mkdir(process.env.PUBLIC_CHALLENGE_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.PUBLIC_CHALLENGE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
        }
      } finally {
        release(); await context?.close(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
}
