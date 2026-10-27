import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright';
import {createPublicGate} from '../../../packages/remote-access/src/public-gate.ts';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
let key: Buffer, cert: Buffer, historicalScript: string;
before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-historical-script-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=staff.sol.example.test', '-addext', 'subjectAltName=DNS:staff.sol.example.test,IP:127.0.0.1',
      '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem')], {stdio: 'ignore'});
    key = await readFile(join(root, 'key.pem')); cert = await readFile(join(root, 'cert.pem'));
  } finally {await rm(root, {recursive: true, force: true});}
  historicalScript = await readFile(new URL('./fixtures/public-challenge-68366e7d.js', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(historicalScript).digest('hex'),
    '12ae31cec60f1df89224be7a0f8da0b46c388be631d5059f4b9b8bda434ae8d0', 'keep the exact shipped 68366e7d script independent of current code');
  browser = await chromium.launch({headless: true});
});
after(async () => {await browser?.close();});

// Breaking old-script DOM selectors, the reload target or the proof exchange must fail these journeys.
for (const locale of ['en', 'es']) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: shipped older script retries on current HTML and proves access`, async () => {
    let upstreamRequests = 0;
    const venue = createServer({key, cert}, (req, res) => {
      upstreamRequests++;
      assert.equal(req.url, '/public/availability');
      assert.equal(req.headers.host, 'staff.sol.example.test');
      res.setHeader('Content-Type', 'application/json'); res.end('{"available":true}');
    });
    const context = await browser.newContext({locale, colorScheme: theme, viewport: {width, height: 800}, ignoreHTTPSErrors: true});
    let server: ReturnType<typeof createServer> | undefined;
    let releaseFailure!: () => void, releaseProof!: () => void;
    const failureHeld = new Promise<void>(resolve => {releaseFailure = resolve;});
    const proofHeld = new Promise<void>(resolve => {releaseProof = resolve;});
    try {
      await new Promise<void>(resolve => venue.listen(0, '127.0.0.1', resolve));
      const upstream = venue.address(); assert.ok(upstream && typeof upstream !== 'string');
      const gate = createPublicGate({key: randomBytes(32), difficulty: 8, ca: cert, routes: () => [
        {publicHostname: 'sol.example.test', staffHostname: 'staff.sol.example.test', address: '127.0.0.1', port: upstream.port},
      ]});
      server = createServer({key, cert}, (req, res) => {
        req.headers.host = 'sol.example.test'; req.headers['x-waitron-sni'] = 'sol.example.test';
        req.headers['x-waitron-client-ip'] = '192.0.2.2'; gate.handle(req, res);
      });
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const page = await context.newPage(); page.setDefaultTimeout(4000);
      let challenges = 0, scripts = 0;
      await page.route('**/_cloud/challenge.js', async route => {
        scripts++; await route.fulfill({contentType: 'application/javascript', body: historicalScript});
      });
      await page.route('**/_cloud/challenge', async route => {
        challenges++;
        if (challenges === 1) {await failureHeld; await route.fulfill({status: 503, body: 'unavailable'});}
        else {await proofHeld; await route.continue();}
      });
      const url = `https://127.0.0.1:${address.port}/public/availability`;
      assert.equal((await page.goto(url))?.status(), 403);
      const status = page.getByRole('status');
      await status.getByText('Please wait a moment.', {exact: false}).waitFor();
      assert.equal(scripts, 1);
      assert.equal(await status.locator('[lang="es"]').innerText(), 'Espera un momento.');
      const reload = page.getByRole('main').getByRole('link', {name: 'Reload page / Volver a cargar', exact: true});
      assert.equal(await reload.isVisible(), true, 'the older script leaves the current fallback available');
      assert.equal(gate.stats().forwarded, 0); assert.equal(upstreamRequests, 0);
      assert.deepEqual(await context.cookies(), []);
      releaseFailure();
      await status.getByText('Please reload to try again.', {exact: false}).waitFor();
      assert.equal(await status.locator('[lang="es"]').innerText(), 'Vuelve a cargar para intentarlo de nuevo.');
      assert.equal(await reload.isVisible(), true);
      assert.equal(gate.stats().forwarded, 0); assert.equal(upstreamRequests, 0);
      assert.deepEqual(await context.cookies(), []);
      if (process.env.PUBLIC_CHALLENGE_RECEIPT_DIR) {
        await mkdir(process.env.PUBLIC_CHALLENGE_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PUBLIC_CHALLENGE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      if (locale === 'es') {
        await page.keyboard.press('Tab');
        assert.equal(await reload.evaluate(element => element === document.activeElement), true);
      }
      const [retried] = await Promise.all([
        page.waitForNavigation({waitUntil: 'load'}),
        locale === 'es' ? page.keyboard.press('Enter') : reload.click(),
      ]);
      assert.equal(retried?.status(), 403); assert.equal(page.url(), url);
      await status.getByText('Please wait a moment.', {exact: false}).waitFor();
      assert.equal(gate.stats().forwarded, 0); assert.equal(upstreamRequests, 0);
      assert.deepEqual(await context.cookies(), []);
      const proof = page.waitForResponse(response => response.url().endsWith('/_cloud/solve'));
      const forwarded = page.waitForResponse(response => response.url().endsWith('/public/availability') && response.status() === 200);
      releaseProof();
      const [accepted, result] = await Promise.all([proof, forwarded]);
      assert.equal(accepted.status(), 204);
      assert.equal(await result.text(), '{"available":true}');
      await page.getByText('{"available":true}', {exact: true}).waitFor();
      assert.equal(challenges, 2);
      assert.equal(scripts, 2);
      assert.equal(gate.stats().forwarded, 1); assert.equal(upstreamRequests, 1);
      const cookies = await context.cookies(); assert.equal(cookies.length, 1);
      assert.equal(cookies[0]!.name, '__Host-waitron-public');
      assert.equal(cookies[0]!.secure, true); assert.equal(cookies[0]!.httpOnly, true);
      assert.equal(cookies[0]!.sameSite, 'Strict');
    } finally {
      releaseFailure(); releaseProof(); await context.close();
      server?.closeAllConnections(); venue.closeAllConnections();
      await Promise.all([server && new Promise<void>(resolve => server!.close(() => resolve())),
        new Promise<void>(resolve => venue.close(() => resolve()))]);
    }
  });
}
