import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {after, before, test} from 'node:test';
import {chromium, type Browser} from 'playwright';
import {loadPortalAssets, portalResponse} from '../../../packages/account-http/src/portal.ts';
import {backupBytes, backupManifest, recoveryKey, venueDatabase} from './fixtures/backup-download.ts';

const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

for (const scenario of ['raw', 'gzip', 'truncated', 'wrong digest', 'wrong tag', 'oversized entry', 'quota', 'abort']) {
  test(`database worker handles ${scenario}`, async () => {
    const archive = backupBytes({gzip: ['gzip','quota'].includes(scenario), oversized: scenario === 'oversized entry',
      ...(scenario === 'quota' ? {database: Buffer.concat([venueDatabase, Buffer.alloc(2 * 1024 ** 2)])} : {})});
    if (scenario === 'wrong tag') archive[33]! ^= 1;
    const manifest = backupManifest(scenario === 'wrong digest' ? Buffer.from('different archive') : archive);
    const server = createServer(async (req, res) => {
      switch (req.url) {
        case '/api/account/backups/download-manifest':
          res.writeHead(200, {'Content-Type': 'application/json'}).end(manifest); return;
        case '/api/account/backups/download-key':
          res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'}).end(recoveryKey + '\n'); return;
        case '/api/account/backups/download':
          res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': archive.length, Connection: 'close'});
          if (scenario === 'abort') { res.flushHeaders(); return; }
          if (scenario === 'truncated') { res.end(archive.subarray(0, -1)); return; }
          res.end(archive); return;
      }
      const response = portalResponse(new Request('http://localhost' + req.url), assets);
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const context = scenario === 'quota' ? await chromium.launchPersistentContext('') : await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(origin);
      if (scenario === 'quota') {
        const session = await page.context().newCDPSession(page);
        await session.send('Storage.overrideQuotaForOrigin', {origin, quotaSize: 1024 ** 2});
      }
      const [result] = await Promise.all([page.evaluate(async () => {
        const worker = new Worker('/backup-download-worker.js');
        (window as Window & {backupWorker?: Worker}).backupWorker = worker;
        const reply = await new Promise<{ok:boolean}>((resolve, reject) => {
          worker.onmessage = event => resolve(event.data);
          worker.onerror = () => reject(new Error('Database worker failed to load'));
          worker.postMessage({venueId:'test-venue', pointId:'test-point', csrfToken:'fixture'});
        });
        worker.terminate();
        const root = await navigator.storage.getDirectory();
        const files: string[] = [];
        for await (const name of root.keys()) files.push(name);
        const database = reply.ok ? await (await root.getDirectoryHandle('waitron-backup-download')).getFileHandle('venue.db') : undefined;
        return {ok:reply.ok, files, bytes: database ? Array.from(new Uint8Array(await (await database.getFile()).arrayBuffer())) : []};
      }), scenario === 'abort' ? page.waitForResponse('**/backups/download').then(() => page.evaluate(() => {
        (window as Window & {backupWorker?: Worker}).backupWorker?.postMessage('cancel');
      })) : Promise.resolve()]);
      if (scenario === 'raw' || scenario === 'gzip') {
        assert.equal(result.ok,true);
        assert.deepEqual(Buffer.from(result.bytes),venueDatabase);
      } else {
        assert.equal(result.ok,false);
        assert.deepEqual(result.files,[]);
      }
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
