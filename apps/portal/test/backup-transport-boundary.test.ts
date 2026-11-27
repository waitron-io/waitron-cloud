import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest,enrollmentRequiredEvent} from '../src/api.ts';
import {BackupController} from '../src/backup-controller.ts';
import {clearAbandonedDatabaseDownload,downloadDatabase} from '../src/backup-database-download.ts';
import type {BackupPage} from '../src/backup-types.ts';

const venueId = '12345678-1234-4234-8234-123456789abc';
const pointId = '22345678-1234-4234-8234-123456789abc';
const olderPointId = '32345678-1234-4234-8234-123456789abc';
const stamp = '2026-10-28T10:00:00.000Z';
const page: BackupPage = {
  venueId, points: [{id: pointId, capturedAt: stamp, expiresAt: '2026-11-28T10:00:00.000Z',
    verification: 'verified', retention: 'daily', protection: 'fallback'}],
  nextCursor: 'older_page-1', defaultPointId: pointId,
  continuousRecovery: {recoverableAt: stamp, checkedAt: stamp, sourceNodeId: '42345678-1234-4234-8234-123456789abc'},
};
const olderPage: BackupPage = {...page, points: [{...page.points[0]!, id: olderPointId}],
  nextCursor: null, defaultPointId: olderPointId};
type Reply = {body?: unknown; status?: number; raw?: string; retry?: string; brokenBody?: boolean; contentType?: string} | 'network';

function fixture(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', Object.assign(new EventTarget(),{cookie: '__Host-cloud_csrf=backup-proof'})],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const replies: Reply[] = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  let changes = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    requests.push({url: String(url), init});
    assert.ok(replies.length, 'each request needs an explicit HTTP outcome');
    const reply = replies.shift()!;
    if (reply === 'network') throw new TypeError('private connection detail');
    const response = new Response(reply.status === 204 ? null : reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: {
        ...(reply.retry ? {'Retry-After': reply.retry} : {}),
        ...(reply.contentType ? {'Content-Type': reply.contentType} : {}),
      },
    });
    if (reply.brokenBody) Object.defineProperty(response, 'json', {value: async () => {throw new Error('private body detail');}});
    return response;
  });
  const controller = new BackupController(() => { changes++; }, accountRequest);
  controller.account('owner');
  return {controller, replies, requests, changes: () => changes};
}

function workerRefusals(t: TestContext, ...failures: Array<{status: number;code: string}>) {
  class RefusingWorker {
    onmessage?: (event: {data: unknown}) => void;
    postMessage() {
      assert.ok(failures.length, 'each worker request needs an explicit refusal');
      this.onmessage?.({data: {ok:false,retryAfterMs:0,...failures.shift()}});
    }
    terminate() {}
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', {configurable:true,value:RefusingWorker});
  t.after(() => { if(previous)Object.defineProperty(globalThis,'Worker',previous);else Reflect.deleteProperty(globalThis,'Worker'); });
}

test('manifest transport requires the expected media type and a nonempty bounded body',async t=>{
  const f=fixture(t),body={archiveManifestVersion:1,capturedAt:stamp,archiveSha256:'a'.repeat(64),laterChanges:'unknown'};
  const request=()=>accountRequest<Blob>('/backups/download-manifest',{venueId,pointId});
  f.replies.push({body,contentType:'application/json'});
  const result=await request();
  assert.ok(result.ok);
  assert.deepEqual(JSON.parse(await result.value.text()),body);
  assert.equal(f.requests[0]?.init.redirect,'error');
  assert.equal(f.requests[0]?.init.cache,'no-store');
  for(const reply of [{body,contentType:'text/plain'}, {raw:'',contentType:'application/json'}, {raw:'x'.repeat(1025),contentType:'application/json'}]){
    f.replies.push(reply);
    const rejected=await request();
    assert.ok(!rejected.ok);
    assert.equal(rejected.code,'unexpected_response');
  }
});

test('range transport validates the stage and uses the worker proof for every request',async t=>{
 const f=fixture(t),attemptId='42345678-1234-4234-8234-123456789abc',point={venueId,pointId};
 const start=()=>accountRequest<{attemptId:string;size:number}>('/backups/download-range/start',point,undefined,'worker-proof');
 f.replies.push({body:{attemptId,size:536870912}});
 assert.deepEqual(await start(),{ok:true,value:{attemptId,size:536870912}});
 f.replies.push({body:{attemptId,size:536870913}});
 assert.equal((await start()).ok,false);
 const read=()=>accountRequest<Response>('/backups/download-range/read',{...point,attemptId,offset:'4194304'},undefined,'worker-proof');
 f.replies.push({status:206,raw:'tail',contentType:'application/octet-stream'});
 const reply=await read();assert.ok(reply.ok);assert.equal(await reply.value.text(),'tail');
 f.replies.push({status:200,raw:'tail',contentType:'application/octet-stream'});
 assert.equal((await read()).ok,false);
 f.replies.push({status:204});
 assert.deepEqual(await accountRequest('/backups/download-range/release',{...point,attemptId},undefined,'worker-proof'),{ok:true,value:undefined});
 assert.equal(f.requests.length,5);
 for(const {init} of f.requests){
  assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  assert.equal((init.headers as Record<string,string>)['X-CSRF-Token'],'worker-proof');
 }
});

test('canceling the browser worker releases its server stage',async t=>{
 const f=fixture(t),attemptId='42345678-1234-4234-8234-123456789abc',stop=new AbortController();
 let ready!:()=>void;
 const mounted=new Promise<void>(resolve=>{ready=resolve;});
 class WaitingWorker {
  onmessage?: (event:{data:unknown})=>void;
  postMessage(){this.onmessage?.({data:{kind:'stage',attemptId}});ready();}
  terminate(){}
 }
 const root={async removeEntry(){}};
 for(const [object,name,value] of [[globalThis,'Worker',WaitingWorker],
  [navigator,'storage',{async getDirectory(){return root;}}],
  [navigator,'locks',{async request(_name:string,_options:unknown,run:()=>unknown){return run();}}]] as const){
  const old=Object.getOwnPropertyDescriptor(object,name);
  Object.defineProperty(object,name,{configurable:true,value});
  t.after(()=>{if(old)Object.defineProperty(object,name,old);else Reflect.deleteProperty(object,name);});
 }
 f.replies.push({status:204});
 const download=downloadDatabase(venueId,pointId,stop.signal);
 await mounted;stop.abort();await download;
 assert.deepEqual(f.requests.map(request=>[request.url,JSON.parse(request.init.body as string)]),
  [['/api/account/backups/download-range/release',{venueId,pointId,attemptId}]]);
});

for(const disk of ['absent','refused'])test(`a browser with disk storage ${disk} keeps the encrypted archive size refusal`,async t=>{
 const f=fixture(t);
 if(disk==='refused'){
  const stub={locks:{async request(_name:string,_options:unknown,run:()=>Promise<unknown>){return run();}},
   storage:{async getDirectory(){throw new DOMException('Disk refused','SecurityError');}}};
  for(const [name,value] of Object.entries(stub)){
   const previous=Object.getOwnPropertyDescriptor(navigator,name);
   Object.defineProperty(navigator,name,{configurable:true,value});
   t.after(()=>{if(previous)Object.defineProperty(navigator,name,previous);else Reflect.deleteProperty(navigator,name);});
  }
 }
 f.replies.push({body:{...page,exitDownloadAvailable:true}});
 await f.controller.open(venueId);
 workerRefusals(t,{status:413,code:'download_too_large'});
 await f.controller.download('download');
 assert.equal(f.controller.error,'snapshotDownloadTooLarge');
});

test('backup download preserves the account enrollment event and distinguishes CSRF from loss of ownership',async t=>{
  const f=fixture(t);
  const downloadable={...page,exitDownloadAvailable:true};
  f.replies.push({body:downloadable});
  await f.controller.open(venueId);
  let enrollment=0;
  document.addEventListener(enrollmentRequiredEvent,()=>{enrollment++;});
  workerRefusals(t,{status:403,code:'enrollment_required'},{status:403,code:'forbidden'},{status:403,code:'permission_denied'});
  await f.controller.download('download');
  assert.equal(enrollment,1);
  assert.equal(f.controller.error,'pairEnrollment');
  assert.equal(f.controller.downloadProof,true);
  await f.controller.download('download');
  assert.equal(f.controller.error,'forbidden');
  await f.controller.download('download');
  assert.equal(f.controller.error,'permissionBusiness');
  assert.equal(f.controller.page,undefined);
  assert.equal(f.controller.selected,undefined);
});

test('a storage refusal identifies the backup that could not be saved',async t=>{
  const f=fixture(t);
  f.replies.push({body:{...page,exitDownloadAvailable:true}});
  await f.controller.open(venueId);
  workerRefusals(t,{status:503,code:'database_storage_unavailable'});
  await f.controller.download('download');
  assert.equal(f.controller.error,'snapshotBackupStorageUnavailable');
});

test('database download forwards server refusals and the enrollment event',async t=>{
  const f=fixture(t);
  let locked=true;
  class WorkerReply {
    onmessage:((event:{data:unknown})=>void)|undefined;
    postMessage(){this.onmessage?.({data:{ok:false,retryAfterMs:0,status:403,code:'enrollment_required'}});}
    terminate(){}
  }
  for(const [object,name,value] of [[globalThis,'Worker',WorkerReply],
    [navigator,'storage',{async getDirectory(){if(locked)throw new DOMException('File in use','NoModificationAllowedError');return {async removeEntry(){}};}}]] as const){
    const previous=Object.getOwnPropertyDescriptor(object,name);
    Object.defineProperty(object,name,{configurable:true,value});
    t.after(()=>{if(previous)Object.defineProperty(object,name,previous);else Reflect.deleteProperty(object,name);});
  }
  f.replies.push({body:{...page,exitDownloadAvailable:true}});
  await f.controller.open(venueId);
  let enrollment=0;
  document.addEventListener(enrollmentRequiredEvent,()=>{enrollment++;});
  await f.controller.download('download-database');
  assert.equal(f.controller.error,'snapshotDownloadUnavailable');
  locked=false;
  await f.controller.download('download-database');
  assert.equal(f.controller.error,'pairEnrollment');
  assert.equal(enrollment,1);
});

test('startup retries while a previous page still holds the file',async t=>{
  let attempts=0;
  Object.defineProperty(navigator,'storage',{configurable:true,value:{async getDirectory(){return {
    async removeEntry(){if(++attempts===1)throw new DOMException('Worker still running','NoModificationAllowedError');},
  };}}});
  t.after(()=>{Reflect.deleteProperty(navigator,'storage');});
  await clearAbandonedDatabaseDownload();
  assert.equal(attempts,2);
});

test('changing snapshot clears a download refusal and keeps a catalogue refusal visible',async t=>{
  const f=fixture(t);
  f.replies.push({body:{...page,exitDownloadAvailable:true,points:[page.points[0],olderPage.points[0]]}});
  await f.controller.open(venueId);
  workerRefusals(t,{status:403,code:'proof_required'});
  await f.controller.download('download');
  assert.equal(f.controller.error,'snapshotDownloadProof');
  f.controller.select(olderPointId);
  assert.equal(f.controller.error,undefined);
  assert.equal(f.controller.downloadProof,false);
  f.replies.push({status:503,body:{error:'temporarily_unavailable'}});
  await f.controller.load();
  f.controller.select(pointId);
  assert.equal(f.controller.error,'unavailable');
});

function assertRequest(request: {url: string; init: RequestInit}, cursor?: string) {
  assert.equal(request.url, '/api/account/backups/list');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'same-origin');
  assert.equal(request.init.body, JSON.stringify({venueId, ...(cursor ? {cursor} : {})}));
  assert.deepEqual(request.init.headers, {'Content-Type': 'application/json', 'X-CSRF-Token': 'backup-proof'});
}

const failures = [
  {name: 'lost session', reply: {status: 401, body: {error: 'unauthenticated'}}, error: 'pairSession', clears: true},
  {name: 'lost business permission', reply: {status: 403, body: {error: 'permission_denied'}}, error: 'permissionBusiness', clears: true},
  {name: 'forbidden request', reply: {status: 403, body: {error: 'forbidden'}}, error: 'forbidden', clears: true},
  {name: 'unknown permission refusal', reply: {status: 403, body: {error: 'private_detail'}}, error: 'forbidden', clears: true},
  {name: 'rate limit without wait', reply: {status: 429, body: {error: 'rate_limited'}}, error: 'limited', clears: false},
  {name: 'unavailable service', reply: {status: 503, body: {error: 'temporarily_unavailable'}}, error: 'unavailable', clears: false},
  {name: 'server failure with valid catalogue', reply: {status: 500, body: olderPage}, error: 'unavailable', clears: false},
  {name: 'permission refusal with valid catalogue', reply: {status: 403, body: olderPage}, error: 'forbidden', clears: true},
  {name: 'broken JSON', reply: {raw: '{unfinished'}, error: 'unavailable', clears: false},
  {name: 'empty body', reply: {raw: ''}, error: 'unavailable', clears: false},
  {name: 'no-content response', reply: {status: 204}, error: 'unavailable', clears: false},
  {name: 'lost connection', reply: 'network', error: 'unavailable', clears: false},
  {name: 'body read failure', reply: {body: olderPage, brokenBody: true}, error: 'unavailable', clears: false},
] satisfies Array<{name: string; reply: Reply; error: string; clears: boolean}>;

for (const next of [false, true]) for (const entry of failures) {
  test(`backup transport ${entry.name} during ${next ? 'pagination' : 'initial load'} permits an explicit valid retry`, async t => {
    const f = fixture(t);
    if (next) {
      f.replies.push({body: page});
      await f.controller.open(venueId);
      f.controller.select(pointId);
    }
    const before = f.requests.length;
    f.replies.push(entry.reply);
    if (next) await f.controller.load(true);
    else await f.controller.open(venueId);
    assert.equal(f.controller.error, entry.error);
    assert.equal(f.controller.pending, false);
    assert.equal(f.controller.waiting, 0);
    assert.equal(f.controller.venueId, venueId);
    assert.deepEqual(f.controller.page, next && !entry.clears ? page : undefined);
    assert.equal(f.controller.selected, next && !entry.clears ? pointId : undefined);
    assert.equal(f.controller.selectedSource, next && !entry.clears ? 'snapshot' : undefined);
    assert.equal(f.requests.length, before + 1, 'a failed read must not retry by itself');
    assertRequest(f.requests[before]!, next ? 'older_page-1' : undefined);

    const retryNext = next && !entry.clears;
    if (entry.clears) {
      await f.controller.load(true);
      assert.equal(f.requests.length, before + 1, 'permission loss removes the older-page cursor');
    }
    f.replies.push({body: olderPage});
    await f.controller.load(retryNext);
    assert.deepEqual(f.controller.page, olderPage);
    assert.equal(f.controller.selected, olderPointId);
    assert.equal(f.controller.selectedSource, retryNext ? 'snapshot' : 'continuous');
    assert.equal(f.controller.error, undefined);
    assert.equal(f.controller.pending, false);
    assert.equal(f.requests.length, before + 2);
    assertRequest(f.requests[before + 1]!, retryNext ? 'older_page-1' : undefined);
    assert.equal(f.replies.length, 0);
  });
}

for (const entry of [
  {name: 'seconds', status: 429, retry: '2', error: 'limited'},
  {name: 'HTTP date', status: 503, retry: 'Wed, 28 Oct 2026 10:00:02 GMT', error: 'unavailable'},
]) for (const reopen of [false, true]) {
  test(`backup transport Retry-After ${entry.name} blocks ${reopen ? 'reopening' : 'pagination'} until its exact expiry`, async t => {
    const f = fixture(t);
    let now = Date.parse(stamp);
    t.mock.method(Date, 'now', () => now);
    t.mock.method(performance, 'now', () => now - Date.parse(stamp));
    f.replies.push({body: page});
    await f.controller.open(venueId);
    f.controller.select(pointId);
    f.replies.push({status: entry.status, retry: entry.retry, body: {error: 'temporarily_unavailable'}});
    await f.controller.load(true);
    assert.deepEqual(f.controller.page, page);
    assert.equal(f.controller.selected, pointId);
    assert.equal(f.controller.selectedSource, 'snapshot');
    assert.equal(f.controller.error, entry.error);
    assert.equal(f.controller.retryAt, Date.parse('2026-10-28T10:00:02.000Z'));
    assert.equal(f.controller.waiting, 2);
    if (reopen) {
      f.controller.close();
      await f.controller.open(venueId);
      assert.equal(f.controller.page, undefined);
      assert.equal(f.controller.selectedSource, undefined);
      assert.equal(f.controller.waiting, 2);
    }
    const changes = f.changes();
    now += 1_999;
    await f.controller.load(!reopen);
    assert.equal(f.requests.length, 2);
    assert.equal(f.controller.waiting, 1);
    assert.equal(f.controller.pending, false);
    assert.equal(f.changes(), changes, 'a blocked retry must not begin a new pending read');
    now++;
    assert.equal(f.controller.waiting, 0);
    f.replies.push({body: olderPage});
    await f.controller.load(!reopen);
    assert.deepEqual(f.controller.page, olderPage);
    assert.equal(f.controller.selected, olderPointId);
    assert.equal(f.controller.selectedSource, reopen ? 'continuous' : 'snapshot');
    assert.equal(f.controller.error, undefined);
    assert.equal(f.controller.pending, false);
    assert.equal(f.changes(), changes + 2, 'pending and completed state both notify the screen');
    assert.equal(f.requests.length, 3);
    assertRequest(f.requests[0]!);
    assertRequest(f.requests[1]!, 'older_page-1');
    assertRequest(f.requests[2]!, reopen ? undefined : 'older_page-1');
    assert.equal(f.replies.length, 0);
  });
}

for (const reply of ['network', {status: 503, body: {error: 'temporarily_unavailable'}}] satisfies Reply[]) {
  test(`backup transport ${typeof reply === 'string' ? 'lost connection' : 'service refusal'} preserves a continuous recovery selection`, async t => {
    const f = fixture(t);
    f.replies.push({body: page});
    await f.controller.open(venueId);
    assert.equal(f.controller.selectedSource, 'continuous');
    f.replies.push(reply);
    await f.controller.load(true);
    assert.deepEqual(f.controller.page, page);
    assert.equal(f.controller.selected, pointId);
    assert.equal(f.controller.selectedSource, 'continuous');
    assert.equal(f.controller.error, 'unavailable');
    assert.equal(f.controller.pending, false);
    assert.equal(f.requests.length, 2);
    assertRequest(f.requests[1]!, 'older_page-1');
    f.replies.push({body: olderPage});
    await f.controller.load(true);
    assert.deepEqual(f.controller.page, olderPage);
    assert.equal(f.controller.selected, olderPointId);
    assert.equal(f.controller.selectedSource, 'continuous');
    assert.equal(f.controller.error, undefined);
    assert.equal(f.requests.length, 3);
    assertRequest(f.requests[2]!, 'older_page-1');
    assert.equal(f.replies.length, 0);
  });
}
