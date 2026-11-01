import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {after, before, test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import axe from 'axe-core';
import {chromium} from 'playwright';
import {createPublicGate} from '../../../packages/remote-access/src/public-gate.ts';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
before(async () => {browser = await chromium.launch({headless: true});});
after(async () => {await browser?.close();});

// Losing the main region or leaving guidance outside it must break guidance journeys.
for (const locale of ['en', 'es']) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  for (const mode of ['disabled', 'script-unavailable', 'running'] as const) for (const handler of ['normal', 'delayed', 'missing'] as const) {
    if (handler !== 'normal' && mode !== 'running') continue;
    if (handler === 'missing' && (locale !== 'en' || theme !== 'light' || width !== 390)) continue;
    test(`${locale} ${theme} ${width}${handler === 'normal' ? '' : ` with ${handler} challenge handler`}: ${handler === 'missing' ? 'absent challenge-handler signal refuses within the outer budget' : `main region contains browser-check ${mode} guidance`}`, async t => {
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
      const held = new Promise<void>(resolve => {release = resolve;});
      try {
        context = await browser.newContext({locale, colorScheme: theme, viewport: {width, height: 800}, javaScriptEnabled: mode !== 'disabled'});
        const page = await context.newPage(); page.setDefaultTimeout(4000);
        let challengeEntered = false;
        const requested = () => {challengeEntered = true;};
        if (mode === 'script-unavailable') await page.route('**/_cloud/challenge.js', route => route.fulfill({status: 503, body: 'unavailable'}));
        await page.route('**/_cloud/challenge', async route => {
          if (handler === 'delayed') await delay(100);
          if (handler !== 'missing') requested();
          await held; await route.fulfill({status: 503, body: 'unavailable'});
        });
        assert.equal((await page.goto(`http://127.0.0.1:${address.port}/public/availability`))?.status(), 403);
        if (mode === 'running') {
          const waitForHandler = () => t.waitFor(() => {assert.equal(challengeEntered, true, 'the challenge route handler must enter');}, {timeout: 4000});
          // The absent-signal control must fail when its observation outlasts the outer timer.
          if (handler === 'missing') {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await assert.rejects(Promise.race([waitForHandler(), new Promise<void>(resolve => {timer = setTimeout(resolve, 5000);})]), /waitFor\(\) timed out/);
            } finally {clearTimeout(timer);}
            return;
          }
          await waitForHandler();
        }
        const main = page.getByRole('main');
        assert.equal(await main.count(), 1, 'the browser-check content must have a main region');
        if (mode !== 'disabled') {
          await page.evaluate(axe.source);
          const violations = await page.evaluate(async () => (await window.axe.run(document, {
            runOnly: {type: 'rule', values: ['landmark-one-main', 'region']},
          })).violations.map(({id, nodes}) => ({id, targets: nodes.map(node => node.target)})));
          assert.deepEqual(violations, [], 'all browser-check guidance belongs inside the main region');
        }
        assert.match(await main.getByRole('heading', {level: 1}).innerText(), /Checking your browser/);
        if (mode === 'running') {
          assert.equal(await main.getByText('Espera un momento.', {exact: true}).isVisible(), true);
          assert.equal(await main.getByRole('link', {name: 'Reload page / Volver a cargar', exact: true}).isVisible(), false);
          release();
          await main.getByText('Please reload to try again.', {exact: false}).waitFor();
          assert.equal(await main.getByText('Vuelve a cargar para intentarlo de nuevo.', {exact: true}).isVisible(), true);
        } else {
          assert.match(await main.innerText(), /Allow JavaScript or try another browser/);
          assert.match(await main.innerText(), /Permite JavaScript o prueba con otro navegador/);
          assert.doesNotMatch(await main.innerText(), /Please wait a moment|Espera un momento/);
        }
        const reload = main.getByRole('link', {name: 'Reload page / Volver a cargar', exact: true});
        assert.equal(await reload.isVisible(), true);
        assert.equal(await reload.getAttribute('href'), '/public/availability');
        assert.equal(await reload.locator('[lang="es"]').innerText(), 'Volver a cargar');
        assert.equal(gate.stats().forwarded, 0); assert.equal((await context.cookies()).length, 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.PUBLIC_CHALLENGE_RECEIPT_DIR) {
          await mkdir(process.env.PUBLIC_CHALLENGE_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.PUBLIC_CHALLENGE_RECEIPT_DIR}/${locale}-${theme}-${width}-${mode}${handler === 'normal' ? '' : `-${handler}`}.png`});
        }
      } finally {
        release(); await context?.close(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
}
