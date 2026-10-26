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
  for (const refusal of ['503', 'disconnected', 'delayed'] as const) {
    test(`${locale} ${theme} ${width}: script ${refusal} keeps guidance until execution`, async () => {
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
      let releaseScript!: () => void, releaseChallenge!: () => void;
      const scriptHeld = new Promise<void>(resolve => {releaseScript = resolve;});
      const challengeHeld = new Promise<void>(resolve => {releaseChallenge = resolve;});
      try {
        context = await browser.newContext({locale, colorScheme: theme, viewport: {width, height: 800}});
        const page = await context.newPage(); page.setDefaultTimeout(4000);
        let recover = false, challengeRequested!: () => void;
        const challenged = new Promise<void>(resolve => {challengeRequested = resolve;});
        await page.route('**/_cloud/challenge.js', async route => {
          if (recover) {await route.continue(); return;}
          if (refusal === 'delayed') {await scriptHeld; await route.continue();}
          else if (refusal === '503') await route.fulfill({status: 503, body: 'unavailable'});
          else await route.abort('connectionreset');
        });
        await page.route('**/_cloud/challenge', async route => {
          challengeRequested(); await challengeHeld;
          await route.fulfill({status: 503, contentType: 'application/json', body: 'unavailable'});
        });
        const response = await page.goto(`http://127.0.0.1:${address.port}/public/availability`, {waitUntil: refusal === 'delayed' ? 'commit' : 'load'});
        assert.equal(response?.status(), 403);
        assert.equal(response.headers()['content-security-policy'], "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        await page.locator('h1').waitFor();
        const guidance = page.getByText('Allow JavaScript or try another browser', {exact: false});
        assert.equal(await guidance.isVisible(), true, 'a script that has not executed must leave a visible way forward');
        assert.equal(await page.getByText('Permite JavaScript o prueba con otro navegador', {exact: false}).isVisible(), true);
        assert.doesNotMatch(await page.locator('body').innerText(), /Please wait a moment|Espera un momento/);
        assert.equal(gate.stats().forwarded, 0);
        assert.equal((await context.cookies()).length, 0);
        if (process.env.PUBLIC_CHALLENGE_RECEIPT_DIR) {
          await mkdir(process.env.PUBLIC_CHALLENGE_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.PUBLIC_CHALLENGE_RECEIPT_DIR}/${locale}-${theme}-${width}-${refusal}.png`});
        }
        if (refusal === 'delayed') releaseScript();
        else {recover = true; await page.reload();}
        await challenged;
        assert.equal(await guidance.isVisible(), false);
        assert.equal(await page.getByText('Please wait a moment.', {exact: false}).isVisible(), true);
        assert.equal(await page.getByText('Espera un momento.', {exact: true}).isVisible(), true);
        assert.equal(gate.stats().forwarded, 0);
        releaseChallenge();
        await page.getByText('Please reload to try again.', {exact: false}).waitFor();
        assert.equal(await page.getByText('Vuelve a cargar para intentarlo de nuevo.', {exact: true}).isVisible(), true);
        assert.equal(await guidance.isVisible(), false);
        assert.equal(gate.stats().forwarded, 0);
        assert.equal((await context.cookies()).length, 0);
      } finally {
        releaseScript(); releaseChallenge(); await context?.close(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
}
