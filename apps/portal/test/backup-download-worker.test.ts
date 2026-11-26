import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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

for (const scenario of ['raw', 'gzip', 'truncated', 'wrong digest', 'wrong tag', 'oversized database', 'oversized download', 'quota', 'interrupted staging', 'ranged', 'bad range', 'range proof', 'encrypted ranges', 'repeated range proof', 'failed release']) {
  test(`database worker handles ${scenario}`, async () => {
    const ranged = ['ranged','bad range','range proof','encrypted ranges','repeated range proof','failed release'].includes(scenario);
    const sizeMiB = ({'quota': 2, 'oversized download': 17} as Record<string,number>)[scenario] ?? 0;
    const database = ranged ? Buffer.concat([venueDatabase, Buffer.alloc(4 * 1024 ** 2)]) : venueDatabase;
    const archive = backupBytes({gzip: ['gzip','quota'].includes(scenario),
      ...(scenario === 'oversized database' ? {databaseLength: 512 * 1024 ** 2 + 1} : {}),
      ...(sizeMiB ? {database: Buffer.concat([venueDatabase, Buffer.alloc(sizeMiB * 1024 ** 2)])} : {database})});
    if (scenario === 'wrong tag') archive[33]! ^= 1;
    const manifest = backupManifest(scenario === 'wrong digest' ? Buffer.from('different archive') : archive);
    const offsets:number[] = [], requests:string[] = [];
    let releases = 0;
    const server = createServer(async (req, res) => {
      if (req.url?.startsWith('/api/account/backups/')) requests.push(req.url.split('/').at(-1)!);
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
          if (ranged) { res.writeHead(413, {'Content-Type':'application/json'}).end('{"error":"download_too_large"}'); return; }
          res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': archive.length, Connection: 'close'});
          if (scenario === 'interrupted staging') { res.write(archive.subarray(0, -1)); return; }
          res.end(scenario === 'truncated' ? archive.subarray(0, -1) : archive); return;
        case '/api/account/backups/download-range/start':
          res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({attemptId:'12345678-1234-4234-8234-123456789abc',size:archive.length})); return;
        case '/api/account/backups/download-range/read': {
          let json='';for await(const chunk of req)json+=chunk;
          const offset=Number(JSON.parse(json).offset), end=Math.min(archive.length,offset+4194304);
          offsets.push(offset);
          if(scenario==='repeated range proof'||scenario==='range proof'&&offset===4194304&&offsets.length===2){res.writeHead(403,{'Content-Type':'application/json'}).end('{"error":"proof_required"}');return;}
          res.writeHead(206,{'Content-Type':'application/octet-stream','Content-Length':end-offset,
            'Content-Range':`bytes ${scenario==='bad range'?offset+1:offset}-${end-1}/${archive.length}`}).end(archive.subarray(offset,end));return;
        }
        case '/api/account/backups/download-range/release':
          releases++;res.writeHead(scenario==='failed release'?503:204).end();return;
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
      const result = await page.evaluate(async ({interrupted,encrypted}) => {
        const worker = new Worker(interrupted ? '/worker-probe.js' : '/backup-download-worker.js');
        let released = false;
        const reply = await new Promise<{ok:boolean;code?:string;written?:boolean}>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('No worker result')), 7000);
          worker.onmessage = ({data}) => {
            if(data.kind==='proof'){worker.postMessage({kind:'proof',ok:true});return;}
            if(data.kind==='released'){released=true;return;}
            if(data.kind==='stage')return;
            clearTimeout(timeout); resolve(data);
          };
          worker.onerror = () => reject(new Error('Database worker failed to load'));
          worker.postMessage({venueId:'test-venue', pointId:'test-point', csrfToken:'fixture', attempt:'test-attempt',...(encrypted?{kind:'archive'}:{})});
        });
        if (interrupted) {
          if (!reply.written) throw new Error('Archive finished before interruption');
          return;
        }
        worker.terminate();
        const root = await navigator.storage.getDirectory();
        const files: string[] = [];
        for await (const name of root.keys()) files.push(name);
        const saved = reply.ok ? await (await (await root.getDirectoryHandle('waitron-backup-download')).getDirectoryHandle('test-attempt')).getFileHandle(encrypted?'archive.wbk':'venue.db') : undefined;
        const file=await saved?.getFile();
        const sha256=file?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join(''):undefined;
        return {ok:reply.ok, code:reply.code, files, sha256, released, bytes: file&&file.size<2**20 ? Array.from(new Uint8Array(await file.arrayBuffer())) : []};
      },{interrupted:scenario === 'interrupted staging',encrypted:scenario==='encrypted ranges'});
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
        assert.deepEqual(requests,['download-manifest','download-key','download']);
      } else if (ranged) {
        assert.equal(result.ok,!['bad range','repeated range proof'].includes(scenario));
        assert.deepEqual(offsets,scenario==='bad range'?[0]:scenario==='range proof'?[0,4194304,4194304]:scenario==='repeated range proof'?[0,0]:[0,4194304]);
        assert.equal(releases,1);
        assert.equal(result.released,scenario!=='failed release');
        if(result.ok)assert.equal(result.sha256,createHash('sha256').update(scenario==='encrypted ranges'?archive:database).digest('hex'));
        else assert.deepEqual(result.files,[]);
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
