import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright';
import {createPublicGate} from '../../../packages/remote-access/src/public-gate.ts';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
let key: Buffer, cert: Buffer, historicalPage: string;
before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-historical-proof-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=staff.sol.example.test', '-addext', 'subjectAltName=DNS:staff.sol.example.test,IP:127.0.0.1',
      '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem')], {stdio: 'ignore'});
    key = await readFile(join(root, 'key.pem')); cert = await readFile(join(root, 'cert.pem'));
  } finally {await rm(root, {recursive: true, force: true});}
  historicalPage = await readFile(new URL('./fixtures/public-challenge-68366e7d.html', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(historicalPage).digest('hex'),
    '0779568c1600f440e547b08e2e213237013206d1232b935a1476b86abe3f7b42');
  browser = await chromium.launch({headless: true});
});
after(async () => {await browser?.close();});

for (const locale of ['en', 'es']) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: historical page completes real proof before forwarding`, async () => {
    let upstreamRequests = 0;
    const venue = createServer({key, cert}, (req, res) => {
      upstreamRequests++;
      assert.equal(req.url, '/public/availability');
      assert.equal(req.headers.host, 'staff.sol.example.test');
      res.setHeader('Content-Type', 'application/json');
      res.end('{"available":true}');
    });
    const context = await browser.newContext({locale, colorScheme: theme, viewport: {width, height: 800}, ignoreHTTPSErrors: true});
    let server: ReturnType<typeof createServer> | undefined, release!: () => void;
    const held = new Promise<void>(resolve => {release = resolve;});
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
      await page.route('**/public/availability', async route => {
        const response = await route.fetch();
        if (response.status() === 403) await route.fulfill({response, body: historicalPage});
        else await route.fulfill({response});
      });
      await page.route('**/_cloud/challenge', async route => {await held; await route.continue();});
      const initial = await page.goto(`https://127.0.0.1:${address.port}/public/availability`);
      assert.equal(initial?.status(), 403);
      assert.equal(await initial.text(), historicalPage, 'the browser must execute against the shipped historical HTML');
      await page.getByText('Please wait a moment.', {exact: false}).waitFor();
      assert.equal(await page.getByText('Espera un momento.', {exact: true}).isVisible(), true);
      assert.equal(gate.stats().forwarded, 0); assert.equal(upstreamRequests, 0);
      assert.deepEqual(await context.cookies(), []);
      const proof = page.waitForResponse(response => response.url().endsWith('/_cloud/solve'));
      const forwarded = page.waitForResponse(response => response.url().endsWith('/public/availability') && response.status() === 200);
      release();
      const [accepted, result] = await Promise.all([proof, forwarded]);
      assert.equal(accepted.status(), 204, 'the real worker solution must be accepted by the gate');
      assert.equal(await result.text(), '{"available":true}');
      await page.getByText('{"available":true}', {exact: true}).waitFor();
      assert.equal(gate.stats().forwarded, 1); assert.equal(upstreamRequests, 1);
      const cookies = await context.cookies(); assert.equal(cookies.length, 1);
      assert.equal(cookies[0]!.name, '__Host-waitron-public');
      assert.equal(cookies[0]!.secure, true); assert.equal(cookies[0]!.httpOnly, true);
      assert.equal(cookies[0]!.sameSite, 'Strict');
    } finally {
      release(); await context.close();
      server?.closeAllConnections(); venue.closeAllConnections();
      await Promise.all([server && new Promise<void>(resolve => server!.close(() => resolve())),
        new Promise<void>(resolve => venue.close(() => resolve()))]);
    }
  });
}
