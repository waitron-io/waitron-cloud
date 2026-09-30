import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { BackupObjects } from '../packages/backups/src/storage.ts';
import { MAX_OBJECT_BYTES, stageReadable } from '../packages/backups/src/object-transfer.ts';

const MiB = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const exists = async path => access(path).then(() => true, () => false);
const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};

// The fixture verifies the actual signed request before applying its venue prefix policy.
export function authorised(request, credentials, venue) {
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(request.headers.authorization ?? '');
  if (!match) return false;
  const [, id, scope, signed, signature] = match;
  const credential = credentials.find(c => c.accessKeyId === id);
  if (!credential || credential.venue !== venue) return false;
  const parts = scope.split('/');
  if (parts.length !== 4 || parts[1] !== 'local' || parts[2] !== 's3' || parts[3] !== 'aws4_request') return false;
  const names = signed.split(';');
  if (!names.includes('host') || !names.includes('x-amz-date')) return false;
  const url = new URL(request.url, 'https://127.0.0.1');
  const encode = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const query = [...url.searchParams].map(([k,v]) => [encode(k), encode(v)]).sort(([a,b],[c,d]) => a < c ? -1 : a > c ? 1 : b < d ? -1 : b > d ? 1 : 0).map(v => v.join('=')).join('&');
  const headers = names.map(n => `${n}:${String(request.headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonical = [request.method, url.pathname, query, headers, signed, request.headers['x-amz-content-sha256']].join('\n');
  let key = hmac(`AWS4${credential.secretAccessKey}`, parts[0]);
  for (const part of parts.slice(1)) key = hmac(key, part);
  const expected = hmac(key, ['AWS4-HMAC-SHA256', request.headers['x-amz-date'], scope, hash(canonical)].join('\n'));
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

// Decode the SDK's aws-chunked envelope incrementally; retain at most one wire chunk.
async function* decoded(request) {
  if (!String(request.headers['content-encoding']).includes('aws-chunked')) {yield* request; return;}
  let buffer = Buffer.alloc(0), remaining = null, delimiter = false, ended = false;
  for await (const chunk of request) {
    buffer = Buffer.concat([buffer, chunk]);
    while (!ended) {
      if (delimiter) {
        if (buffer.length < 2) break;
        assert.equal(buffer.subarray(0, 2).toString(), '\r\n');
        buffer = buffer.subarray(2); delimiter = false;
      }
      if (remaining === null) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) {assert(buffer.length < 1024); break;}
        const line = buffer.subarray(0, end).toString();
        assert.match(line, /^[0-9a-f]+(?:;.*)?$/i);
        remaining = parseInt(line, 16); buffer = buffer.subarray(end + 2);
        if (remaining === 0) {ended = true; break;}
      }
      if (!buffer.length) break;
      const n = Math.min(remaining, buffer.length);
      yield buffer.subarray(0, n); buffer = buffer.subarray(n); remaining -= n;
      if (remaining === 0) {remaining = null; delimiter = true;}
    }
    if (ended) {assert(buffer.length < 4096); buffer = Buffer.alloc(0);}
  }
  assert(ended, 'incomplete aws-chunked body');
}

export async function diskUsage(root) {
  let bytes = 0, allocated = 0, files = 0;
  async function walk(path) {
    for (const entry of await readdir(path, {withFileTypes: true}).catch(e => {if (e.code === 'ENOENT') return []; throw e;})) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {const s = await stat(file).catch(e => {if (e.code === 'ENOENT') return null; throw e;}); if (s) {bytes += s.size; allocated += s.blocks * 512; files++;}}
    }
  }
  await walk(root); return {bytes, allocated, files};
}
export async function preflight(bytes, directory = tmpdir()) {
  const fs = await statfs(directory);
  const value = {availableMemoryBytes: process.availableMemory(), freeDiskBytes: fs.bavail * fs.bsize};
  return {...value, reason: value.freeDiskBytes < 8 * bytes + 256 * MiB ? 'insufficient disk' : value.availableMemoryBytes < 1024 * MiB ? 'insufficient memory' : null};
}

export async function runCapacityFixture(bytes, {onRoot = () => {}} = {}) {
  assert(Number.isSafeInteger(bytes) && bytes > 256 * 1024 && bytes <= MAX_OBJECT_BYTES);
  const resources = await preflight(bytes);
  assert.equal(resources.reason, null, resources.reason ?? 'resource preflight');
  const root = await mkdtemp(join(tmpdir(), 'cloud-backup-capacity-'));
  onRoot(root);
  const clients = [], sources = [], sockets = new Set(), handlers = new Set(), errors = [];
  let server, sampler;
  let sampling = Promise.resolve();
  let result;
  try {
    for (const name of ['source', 'store', 'partial', 'download']) await mkdir(join(root, name));
    execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'], {stdio:'ignore'});
    const ca = await readFile(join(root, 'cert.pem'), 'utf8');
    const credentials = ['a', 'b'].map(venue => ({venue, accessKeyId: `fixture-${venue}`, secretAccessKey: randomBytes(32).toString('hex')}));
    const attempts = new Map(), events = new Map();
    const event = name => {if (!events.has(name)) events.set(name, deferred()); return events.get(name);};
    const waitEvent = name => Promise.race([event(name).promise, delay(10000, undefined, {ref:false}).then(() => {throw new Error(`fixture event timed out: ${name}`);})]);
    const overlap = {PUT: 0, GET: 0}, entered = {PUT: 0, GET: 0};
    const barrier = {PUT: deferred(), GET: deferred()};
    const errorResponse = (response, code, name) => {response.writeHead(code, {'content-type':'application/xml', connection:'close'}); response.end(`<Error><Code>${name}</Code></Error>`);};
    async function handle(request, response) {
      request.on('error', () => {}); response.on('error', () => {});
      const path = new URL(request.url, 'https://127.0.0.1').pathname;
      const match = /^\/capacity-probe\/([ab])\/([a-z-]+)$/.exec(path);
      if (!match || !authorised(request, credentials, match[1])) {errorResponse(response, 403, 'AccessDenied'); return;}
      const [, venue, key] = match, name = `${venue}-${key}`, file = join(root, 'store', name);
      const attemptKey = `${request.method} ${name}`, attempt = (attempts.get(attemptKey) ?? 0) + 1;
      attempts.set(attemptKey, attempt);
      if (key === 'normal' && attempt === 1 && ['PUT','GET'].includes(request.method)) {
        entered[request.method]++;
        overlap[request.method] = entered[request.method];
        if (entered[request.method] === 2) barrier[request.method].resolve();
        await Promise.race([barrier[request.method].promise, delay(5000, undefined, {ref:false}).then(() => {throw new Error('two-venue barrier timed out');})]);
      }
      if (request.method === 'PUT') {
        if (await exists(file)) {errorResponse(response, 412, 'PreconditionFailed'); return;}
        if (key === 'retry' && attempt === 2) {
          assert.equal(await exists(file), false);
          assert.deepEqual(await readdir(join(root,'partial')), []);
          event('interrupted-clean').resolve(true);
        }
        let received = 0;
        const body = Readable.from((async function* () {
          for await (const chunk of decoded(request)) {
            received += chunk.length;
            if (key === 'retry' && attempt === 1 && received >= 128 * 1024) {
              event('interrupted').resolve(); throw new Error('fixture.interrupted');
            }
            if (key === 'cancel-upload' && received >= 128 * 1024) {
              event('upload-started').resolve();
              await delay(5);
            }
            yield chunk;
          }
        })());
        let staged;
        try {
          staged = await stageReadable(body, Number(request.headers['x-amz-decoded-content-length'] ?? request.headers['content-length']), {temporaryRoot: join(root,'partial'), timeoutMs: 30000});
          assert.equal(staged.receipt.size, bytes);
          await rename(staged.path, file);
          response.writeHead(200, {etag:`"${staged.receipt.digest}"`}); response.end();
        } catch (e) {
          if (key === 'retry' && attempt === 1) errorResponse(response, 503, 'SlowDown');
          else if (key === 'cancel-upload') {response.destroy(); event('upload-cancel-clean').resolve();}
          else throw e;
        } finally {await staged?.dispose();}
        return;
      }
      if (request.method === 'GET') {
        const source = ['retry-download','cancel-download','wrong-length'].includes(key) ? join(root,'store',`${venue}-normal`) : file;
        if (!await exists(source)) {errorResponse(response,404,'NoSuchKey'); return;}
        response.writeHead(200, {'content-length': key === 'wrong-length' ? bytes + 1 : bytes});
        if ((key === 'retry-download' && attempt === 1) || key === 'cancel-download' || key === 'wrong-length') {
          const stream = createReadStream(source, {start:0,end:128*1024-1});
          for await (const chunk of stream) response.write(chunk);
          if (key === 'cancel-download') {
            event('download-started').resolve();
            await new Promise(resolve => response.once('close', resolve));
          } else {await delay(20); response.destroy();}
          return;
        }
        await pipeline(createReadStream(source), response).catch(e => {if (!response.destroyed) throw e;});
        return;
      }
      errorResponse(response,405,'MethodNotAllowed');
    }
    server = createServer({key:await readFile(join(root,'key.pem')),cert:ca}, (request,response) => {
      const task = handle(request,response).catch(e => {errors.push(e); response.destroy();}).finally(() => handlers.delete(task));
      handlers.add(task);
    });
    server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const location = {endpoint:`https://127.0.0.1:${server.address().port}`,bucket:'capacity-probe',region:'local'};
    for (const credential of credentials) clients.push(new BackupObjects(location,credential,ca));
    const m = process.memoryUsage(), baseline = {rssBytes:m.rss,arrayBufferBytes:m.arrayBuffers};
    const peaks = {...baseline,scratchBytes:0,diskAllocatedBytes:0};
    async function sample() {
      const m = process.memoryUsage(), d = await diskUsage(root);
      peaks.rssBytes = Math.max(peaks.rssBytes,m.rss); peaks.arrayBufferBytes = Math.max(peaks.arrayBufferBytes,m.arrayBuffers);
      peaks.scratchBytes = Math.max(peaks.scratchBytes,d.bytes); peaks.diskAllocatedBytes = Math.max(peaks.diskAllocatedBytes,d.allocated);
    }
    sampler = setInterval(() => {sampling = sampling.then(sample).catch(error => errors.push(error));},20);
    const expected = [];
    for (const [i] of credentials.entries()) {
      const digest = createHash('sha256');
      const stream = Readable.from((async function* () {for(let offset=0;offset<bytes;offset+=65536) {const chunk=Buffer.alloc(Math.min(65536,bytes-offset),0x61+i);digest.update(chunk);yield chunk;}})());
      const source = await stageReadable(stream,bytes,{temporaryRoot:join(root,'source')});
      sources.push(source); expected.push({size:bytes,digest:digest.digest('hex')}); assert.deepEqual(source.receipt,expected[i]);
    }
    const venues = await Promise.all(clients.map(async (client,i) => {
      const started = performance.now(), key = `${credentials[i].venue}/normal`;
      assert.deepEqual(await client.putStaged(key,sources[i]),expected[i]);
      return {venue:credentials[i].venue,digest:expected[i].digest,uploadedBytes:bytes,uploadMs:performance.now()-started};
    }));
    await Promise.all(clients.map(async (client,i) => {
      const start = performance.now(), stage = await client.stage(`${credentials[i].venue}/normal`,undefined,{temporaryRoot:join(root,'download')});
      try {assert.deepEqual(stage.receipt,expected[i]); venues[i].downloadedBytes=stage.receipt.size; venues[i].downloadMs=performance.now()-start; await sample();}
      finally {await stage.dispose();}
    }));
    const failures = {crossedReadDenied:0,crossedWriteDenied:0};
    const forbidden = e => e.$metadata?.httpStatusCode === 403;
    for (const [i,client] of clients.entries()) {
      const other = credentials[1-i].venue;
      await assert.rejects(client.stage(`${other}/normal`,undefined,{temporaryRoot:join(root,'download')}),forbidden); failures.crossedReadDenied++;
      await assert.rejects(client.putStaged(`${other}/crossed`,sources[i]),forbidden); failures.crossedWriteDenied++;
      assert.equal(await exists(join(root,'store',`${other}-crossed`)),false);
    }
    const wrong = new BackupObjects(location,{...credentials[0],secretAccessKey:'wrong'},ca); clients.push(wrong);
    await assert.rejects(wrong.stage('a/normal',undefined,{temporaryRoot:join(root,'download')}),forbidden); failures.wrongSecretDenied=true;
    assert.deepEqual(await clients[0].putStaged('a/retry',sources[0]),expected[0]);
    failures.uploadAttempts=attempts.get('PUT a-retry'); failures.interruptedUploadUnpublished=await waitEvent('interrupted-clean');
    const retry = await clients[0].stage('a/retry',undefined,{temporaryRoot:join(root,'download')});
    assert.deepEqual(retry.receipt,expected[0]); await retry.dispose(); failures.uploadRecovered=true;
    const downloaded = await clients[1].stage('b/retry-download',undefined,{temporaryRoot:join(root,'download')});
    assert.deepEqual(downloaded.receipt,expected[1]); await downloaded.dispose();
    failures.downloadAttempts=attempts.get('GET b-retry-download'); failures.downloadRecovered=true;
    const uploadAbort = new AbortController();
    const uploading = assert.rejects(clients[0].putStaged('a/cancel-upload',sources[0],undefined,{signal:uploadAbort.signal}),/backup.cancelled/);
    await waitEvent('upload-started'); let start=performance.now(); uploadAbort.abort(); await uploading;
    failures.uploadAbortMs=performance.now()-start;
    await waitEvent('upload-cancel-clean');
    failures.cancelledUploadUnpublished=!await exists(join(root,'store','a-cancel-upload'));
    assert.deepEqual(await readdir(join(root,'partial')),[]);
    const downloadAbort = new AbortController();
    const downloading = assert.rejects(clients[1].stage('b/cancel-download',undefined,{signal:downloadAbort.signal,temporaryRoot:join(root,'download')}),/backup.cancelled/);
    await waitEvent('download-started'); start=performance.now(); downloadAbort.abort(); await downloading;
    failures.downloadAbortMs=performance.now()-start;
    failures.cancelledDownloadStages=(await readdir(join(root,'download'))).length;
    await assert.rejects(clients[0].stage('a/wrong-length',undefined,{temporaryRoot:join(root,'download')}));
    // HTTP truncation fails in the transport; clean finite sources exercise both staging length guards.
    await assert.rejects(stageReadable(Readable.from([Buffer.alloc(65536)]),65537,{temporaryRoot:join(root,'download')}),/backup.object_invalid/);
    await assert.rejects(stageReadable(Readable.from([Buffer.alloc(65537)]),65536,{temporaryRoot:join(root,'download')}),/backup.object_invalid/);
    failures.wrongLengthRefused=true;
    await assert.rejects(clients[0].putStaged('a/normal',sources[1],undefined,{temporaryRoot:join(root,'download')}),/backup.object_conflict/); failures.wrongDigestRefused=true;
    // Cancellation must leave both clients able to use their original immutable objects.
    for (const [i,client] of clients.slice(0,2).entries()) {
      const stage=await client.stage(`${credentials[i].venue}/normal`,undefined,{temporaryRoot:join(root,'download')});
      assert.deepEqual(stage.receipt,expected[i]); await stage.dispose();
    }
    await sample();
    assert.deepEqual(await readdir(join(root,'partial')),[]);
    assert.deepEqual(await readdir(join(root,'download')),[]);
    assert.deepEqual((await readdir(join(root,'store'))).sort(),['a-normal','a-retry','b-normal']);
    assert.deepEqual(errors,[]);
    result={bytes,status:'ran',preflight:{availableMemoryBytes:resources.availableMemoryBytes,freeDiskBytes:resources.freeDiskBytes},uploadOverlap:overlap.PUT,downloadOverlap:overlap.GET,venues,baseline,peaks,failures};
  } finally {
    clearInterval(sampler); await sampling;
    for(const client of clients) client.close();
    if(server) {const closed=new Promise(resolve=>server.close(resolve)); for(const socket of sockets) socket.destroy(); await closed;}
    await Promise.allSettled(handlers);
    for(const source of sources) await source.dispose();
    // Remove only this mkdtemp fixture, including every interrupted stage and TLS key.
    await rm(root,{recursive:true,force:true});
  }
  assert.equal(await exists(root),false);
  assert.equal(sockets.size,0); assert.equal(handlers.size,0);
  assert.deepEqual(errors,[]);
  const residue=await diskUsage(root);
  result.cleanup={remainingFiles:residue.files,remainingBytes:residue.bytes};
  assert.deepEqual(result.cleanup,{remainingFiles:0,remainingBytes:0});
  return {fixture:result,cleanup:{rootRemoved:true,sockets:sockets.size,activeRequests:handlers.size}};
}
