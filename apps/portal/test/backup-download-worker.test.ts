import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {chromium, type Browser} from 'playwright';
import {loadPortalAssets, portalResponse} from '../../../packages/account-http/src/portal.ts';
import {readBytes} from '../src/backup-download-bytes.ts';
import {backupBytes, backupManifest, backupPayload, numberedKeyRecord, openBackupExport, recoveryKey, venueDatabase} from './fixtures/backup-download.ts';

const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

for (const scenario of ['raw', 'gzip', 'truncated', 'wrong digest', 'wrong tag', 'oversized database', 'oversized download', 'quota', 'interrupted staging', 'ranged', 'bad range', 'range proof', 'encrypted ranges', 'bad encrypted digest', 'repeated range proof', 'failed release', 'Waitron version 2', 'missing key record', 'malformed key record', 'duplicate key record', 'restore without disk']) {
  test(`database worker handles ${scenario}`, async () => {
    const fixedFrame = scenario === 'Waitron version 2';
    const memoryOnly = scenario === 'restore without disk';
    const refusedRecord = scenario.endsWith('key record');
    const restore = fixedFrame || memoryOnly || refusedRecord || ['encrypted ranges','bad encrypted digest'].includes(scenario);
    const ranged = ['ranged','bad range','range proof','encrypted ranges','bad encrypted digest','repeated range proof','failed release'].includes(scenario);
    const sizeMiB = ({'quota': 2, 'oversized download': 17} as Record<string,number>)[scenario] ?? 0;
    const database = ranged ? Buffer.concat([venueDatabase, Buffer.alloc(4 * 1024 ** 2)]) : venueDatabase;
    const keyRecords = scenario === 'missing key record' || !restore ? [] : scenario === 'duplicate key record' ?
      [numberedKeyRecord, numberedKeyRecord] : scenario === 'malformed key record' ?
      [numberedKeyRecord.replace('2026-11-23', '2026-02-30')] : [numberedKeyRecord];
    const payloadOptions = {gzip: memoryOnly || ['gzip','quota'].includes(scenario), keyRecords,
      ...(scenario === 'oversized database' ? {databaseLength: 512 * 1024 ** 2 + 1} : {}),
      ...(sizeMiB ? {database: Buffer.concat([venueDatabase, Buffer.alloc(sizeMiB * 1024 ** 2)])} : {database})};
    const archive = backupBytes(payloadOptions);
    if (scenario === 'wrong tag') archive[33]! ^= 1;
    const manifest = backupManifest(['wrong digest','bad encrypted digest'].includes(scenario) ? Buffer.from('different archive') : archive);
    const offsets:number[] = [], requests:string[] = [];
    let releases = 0;
    const server = createServer(async (req, res) => {
      if (req.url?.startsWith('/api/account/backups/')) requests.push(req.url.split('/').at(-1)!);
      switch (req.url) {
        case '/empty': res.writeHead(200, {'Content-Type':'text/html'}).end('<title>Storage inspection</title>'); return;
        case '/worker-no-disk.js':
          res.writeHead(200, {'Content-Type':'text/javascript'}).end(`
            navigator.storage.getDirectory = async () => { throw new DOMException('Disk unavailable', 'SecurityError'); };
            importScripts('/backup-download-worker.js');
          `); return;
        case '/worker-fixed-random.js':
          res.writeHead(200, {'Content-Type':'text/javascript'}).end(`
            crypto.getRandomValues = bytes => {
              if (bytes.length === 28) { bytes.fill(24, 0, 16); return bytes.fill(42, 16); }
              return bytes.fill(bytes.length === 16 ? 24 : 42);
            };
            importScripts('/backup-download-worker.js');
          `); return;
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
      const result = await page.evaluate(async ({interrupted,ranged,restore,fixedFrame,memoryOnly}) => {
        const worker = new Worker(interrupted ? '/worker-probe.js' : fixedFrame ? '/worker-fixed-random.js' :
          memoryOnly ? '/worker-no-disk.js' : '/backup-download-worker.js');
        let released = false;
        const reply = await new Promise<{ok:boolean;code?:string;written?:boolean;value?:{file?:Blob;manifest:{archiveVersion:number;archiveSha256:string;masterKeyId:string;masterKeyDay:string}}}>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('No worker result')), ranged ? 15_000 : 7000);
          worker.onmessage = ({data}) => {
            if(data.kind==='proof'){worker.postMessage({kind:'proof',ok:true});return;}
            if(data.kind==='released'){released=true;return;}
            if(data.kind==='stage')return;
            clearTimeout(timeout); resolve(data);
          };
          worker.onerror = () => reject(new Error('Database worker failed to load'));
          worker.postMessage({venueId:'test-venue', pointId:'test-point', csrfToken:'fixture', attempt:'test-attempt',...(restore?{kind:'archive'}:{}),memoryOnly});
        });
        if (interrupted) {
          if (!reply.written) throw new Error('Archive finished before interruption');
          return;
        }
        worker.terminate();
        const root = await navigator.storage.getDirectory();
        const files: string[] = [];
        for await (const name of root.keys()) files.push(name);
        const saved = reply.ok && !reply.value?.file ? await (await (await root.getDirectoryHandle('waitron-backup-download')).getDirectoryHandle('test-attempt')).getFileHandle(restore ? (reply.value ? 'backup.enc' : 'archive.wbk') : 'venue.db') : undefined;
        const file=reply.value?.file ?? await saved?.getFile();
        const sha256=file?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join(''):undefined;
        const bytes = file && (restore || file.size < 2**20) ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]!);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }) : undefined;
        return {ok:reply.ok, code:reply.code, files, sha256, released, manifest:reply.value?.manifest, bytes};
      },{interrupted:scenario === 'interrupted staging',ranged,restore,fixedFrame,memoryOnly});
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
      if (memoryOnly) {
        assert.equal(result.ok, true, 'a small restore backup can be saved without disk staging');
        assert.deepEqual(result.files, []);
        assert.deepEqual(openBackupExport(Buffer.from(result.bytes!, 'base64')), backupPayload(payloadOptions));
        assert.equal(result.sha256, result.manifest?.archiveSha256);
      } else if (refusedRecord) {
        assert.equal(result.code, 'restore_key_unavailable');
        assert.equal(result.ok, false);
        assert.deepEqual(result.files, []);
      } else if (fixedFrame) {
        assert.equal(result.ok, true);
        const bytes = Buffer.from(result.bytes!, 'base64');
        assert.equal(bytes[4], 2, 'downloaded archive frame version');
        const expected = await readFile(new URL('./fixtures/waitron-version-2.backup.b64', import.meta.url), 'utf8');
        assert.deepEqual(bytes, Buffer.from(expected, 'base64'));
        assert.equal(result.manifest?.archiveSha256, result.sha256);
        assert.equal(result.manifest?.masterKeyId, '0011223344556677');
        assert.equal(result.manifest?.masterKeyDay, '2026-11-23');
        assert.equal(result.manifest?.archiveVersion, 2);
      } else if (scenario === 'raw' || scenario === 'gzip') {
        assert.equal(result.ok,true);
        assert.deepEqual(Buffer.from(result.bytes!, 'base64'),venueDatabase);
        assert.deepEqual(requests,['download-manifest','download-key','download']);
      } else if (ranged) {
        assert.equal(result.ok,!['bad range','bad encrypted digest','repeated range proof'].includes(scenario));
        assert.deepEqual(offsets,scenario==='bad range'?[0]:scenario==='range proof'?[0,4194304,4194304]:scenario==='repeated range proof'?[0,0]:[0,4194304]);
        assert.equal(releases,1);
        assert.equal(result.released,scenario!=='failed release');
        if (result.ok && restore) {
          const bytes = Buffer.from(result.bytes!, 'base64');
          assert.equal(bytes[4], 2, 'downloaded archive frame version');
          assert.deepEqual(openBackupExport(bytes), backupPayload(payloadOptions));
          assert.equal(result.sha256, result.manifest?.archiveSha256);
        } else if (result.ok) assert.equal(result.sha256,createHash('sha256').update(database).digest('hex'));
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
