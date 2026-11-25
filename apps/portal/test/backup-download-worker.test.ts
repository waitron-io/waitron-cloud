import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {after, before, test} from 'node:test';
import {chromium, type Browser} from 'playwright';
import {loadPortalAssets, portalResponse} from '../../../packages/account-http/src/portal.ts';
import {readBytes} from '../src/backup-download-bytes.ts';
import {backupBytes, backupManifest, recoveryKey, venueDatabase} from './fixtures/backup-download.ts';

const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

for (const scenario of ['raw', 'gzip', 'truncated', 'wrong digest', 'wrong tag', 'oversized database', 'oversized download', 'quota', 'interrupted staging']) {
  test(`database worker handles ${scenario}`, async () => {
    const sizeMiB = ({'quota': 2, 'oversized download': 17} as Record<string,number>)[scenario] ?? 0;
    const archive = backupBytes({gzip: ['gzip','quota'].includes(scenario),
      ...(scenario === 'oversized database' ? {databaseLength: 512 * 1024 ** 2 + 1} : {}),
      ...(sizeMiB ? {database: Buffer.concat([venueDatabase, Buffer.alloc(sizeMiB * 1024 ** 2)])} : {})});
    if (scenario === 'wrong tag') archive[33]! ^= 1;
    const manifest = backupManifest(scenario === 'wrong digest' ? Buffer.from('different archive') : archive);
    const server = createServer(async (req, res) => {
      switch (req.url) {
        case '/empty': res.writeHead(200, {'Content-Type':'text/html'}).end('<title>Storage inspection</title>'); return;
        case '/worker-probe.js':
          res.writeHead(200, {'Content-Type':'text/javascript'}).end(`
            importScripts('/backup-download-worker.js');
            const open = FileSystemFileHandle.prototype.createSyncAccessHandle;
            FileSystemFileHandle.prototype.createSyncAccessHandle = async function () {
              const handle = await open.call(this), write = handle.write.bind(handle);
              handle.write = (bytes, options) => {
                const count = write(bytes, options);
                if (options.at + count >= 64) postMessage({written:true});
                return count;
              };
              return handle;
            };
          `); return;
        case '/api/account/backups/download-manifest':
          res.writeHead(200, {'Content-Type': 'application/json'}).end(manifest); return;
        case '/api/account/backups/download-key':
          res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'}).end(recoveryKey + '\n'); return;
        case '/api/account/backups/download':
          res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': archive.length, Connection: 'close'});
          if (scenario === 'interrupted staging') { res.write(archive.subarray(0, -1)); return; }
          res.end(scenario === 'truncated' ? archive.subarray(0, -1) : archive); return;
      }
      const response = portalResponse(new Request('http://localhost' + req.url), assets);
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const context = scenario === 'quota' ? await chromium.launchPersistentContext('') : await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(origin + '/empty');
      if (scenario === 'quota') {
        const session = await page.context().newCDPSession(page);
        await session.send('Storage.overrideQuotaForOrigin', {origin, quotaSize: 1024 ** 2});
      }
      const result = await page.evaluate(async interrupted => {
        const worker = new Worker(interrupted ? '/worker-probe.js' : '/backup-download-worker.js');
        const reply = await new Promise<{ok:boolean;code?:string;written?:boolean}>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('No worker result')), 7000);
          worker.onmessage = ({data}) => { clearTimeout(timeout); resolve(data); };
          worker.onerror = () => reject(new Error('Database worker failed to load'));
          worker.postMessage({venueId:'test-venue', pointId:'test-point', csrfToken:'fixture', attempt:'test-attempt'});
        });
        if (interrupted) {
          if (!reply.written) throw new Error('Archive finished before interruption');
          return;
        }
        worker.terminate();
        const root = await navigator.storage.getDirectory();
        const files: string[] = [];
        for await (const name of root.keys()) files.push(name);
        const database = reply.ok ? await (await (await root.getDirectoryHandle('waitron-backup-download')).getDirectoryHandle('test-attempt')).getFileHandle('venue.db') : undefined;
        return {ok:reply.ok, code:reply.code, files, bytes: database ? Array.from(new Uint8Array(await (await database.getFile()).arrayBuffer())) : []};
      },scenario === 'interrupted staging');
      if (scenario === 'interrupted staging') {
        await page.close();
        const inspector = await context.newPage();
        await inspector.goto(origin + '/empty');
        const bytes = await inspector.evaluate(async () => {
          const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('waitron-backup-download');
          const directory = await root.getDirectoryHandle('test-attempt');
          const file = await (await directory.getFileHandle('archive.wbk')).getFile();
          return Array.from(new Uint8Array(await file.arrayBuffer()));
        });
        assert.deepEqual(Buffer.from(bytes),archive.subarray(0,-1));
        await inspector.goto(origin);
        await inspector.waitForFunction(async () => {
          const root = await navigator.storage.getDirectory();
          for await (const name of root.keys()) if (name === 'waitron-backup-download') return false;
          return true;
        },null,{timeout:5000});
        return;
      }
      assert.ok(result);
      if (scenario === 'raw' || scenario === 'gzip') {
        assert.equal(result.ok,true);
        assert.deepEqual(Buffer.from(result.bytes),venueDatabase);
      } else {
        assert.equal(result.ok,false);
        if (scenario.startsWith('oversized')) assert.equal(result.code,'download_too_large');
        if (scenario==='truncated') assert.equal(result.code,'network_error');
        if (scenario==='quota') assert.equal(result.code,'database_storage_unavailable');
        assert.deepEqual(result.files,[]);
      }
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}

test('expanded data is bounded across reads even when each entry fits', async () => {
  const input = readBytes(new Blob(['the files each fit']).stream(), 12);
  await assert.rejects(input.exact(7), /Size limit exceeded/);
  await input.close();
});
