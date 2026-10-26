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

// Hiding the retry action after failure or sending it elsewhere must break this journey.
for (const locale of ['en', 'es']) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  for (const failure of ['challenge', 'worker', 'proof', 'timeout'] as const) {
    test(`${locale} ${theme} ${width}: reload restarts a running check after ${failure} failure`, async () => {
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
        context = await browser.newContext({locale, colorScheme: theme, viewport: {width, height: 800}});
        const page = await context.newPage(); page.setDefaultTimeout(4000);
        let restarting = false, challengeRequests = 0, proofRequests = 0;
        let requested!: () => void, restarted!: () => void;
        const firstChallenge = new Promise<void>(resolve => {requested = resolve;});
        const nextChallenge = new Promise<void>(resolve => {restarted = resolve;});
        await page.route('**/_cloud/challenge', async route => {
          challengeRequests++;
          if (restarting) {restarted(); await held; await route.abort(); return;}
          requested();
          if (failure === 'timeout') {await held; await route.abort();}
          else if (failure === 'challenge') await route.fulfill({status: 503, body: 'unavailable'});
          else await route.continue();
        });
        if (failure === 'worker') await page.route('**/_cloud/worker.js', route => route.fulfill({
          contentType: 'application/javascript', body: 'throw new Error("worker unavailable");',
        }));
        await page.route('**/_cloud/solve', async route => {
          proofRequests++; await route.fulfill({status: 403, body: ''});
        });
        if (failure === 'timeout') await page.clock.install();
        const url = `http://127.0.0.1:${address.port}/public/availability`;
        assert.equal((await page.goto(url))?.status(), 403);
        await firstChallenge;
        if (failure === 'timeout') await page.clock.runFor(30001);
        await page.getByText(failure === 'worker' || failure === 'timeout'
          ? 'This browser check could not finish.' : 'Please reload to try again.', {exact: false}).waitFor();
        const reload = page.getByRole('link', {name: 'Reload page / Volver a cargar', exact: true});
        assert.equal(await reload.isVisible(), true, 'a failed running check must offer its reload action');
        assert.equal(await reload.getAttribute('href'), '/public/availability');
        assert.equal(await reload.locator('[lang="es"]').innerText(), 'Volver a cargar');
        const visible = await page.locator('body').innerText();
        assert.doesNotMatch(visible, /Allow JavaScript or try another browser|Permite JavaScript o prueba con otro navegador/,
          'a running failure keeps its relevant message instead of repeating static script-download advice');
        assert.match(visible, failure === 'worker' || failure === 'timeout'
          ? /Prueba con otro navegador/ : /Vuelve a cargar para intentarlo de nuevo/);
        assert.equal(pageRequests, 1); assert.equal(challengeRequests, 1);
        assert.equal(proofRequests, failure === 'proof' ? 1 : 0);
        assert.equal(gate.stats().forwarded, 0); assert.equal((await context.cookies()).length, 0);
        if (process.env.PUBLIC_CHALLENGE_RECEIPT_DIR && failure === 'challenge') {
          await mkdir(process.env.PUBLIC_CHALLENGE_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.PUBLIC_CHALLENGE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
        }
        restarting = true;
        if (locale === 'es') {
          await reload.focus();
          assert.equal(await reload.evaluate(element => element === document.activeElement), true);
        }
        const [response] = await Promise.all([
          page.waitForNavigation({waitUntil: 'load'}),
          locale === 'es' ? page.keyboard.press('Enter') : reload.click(),
        ]);
        await nextChallenge;
        assert.equal(response?.status(), 403); assert.equal(page.url(), url);
        assert.equal(pageRequests, 2); assert.equal(challengeRequests, 2);
        assert.equal(await reload.isVisible(), false, 'a new running attempt hides the fallback again');
        assert.equal(await page.getByText('Please wait a moment.', {exact: false}).isVisible(), true);
        assert.equal(gate.stats().forwarded, 0); assert.equal((await context.cookies()).length, 0);
      } finally {
        release(); await context?.close(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
}
