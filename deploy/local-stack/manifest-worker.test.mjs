import assert from 'node:assert/strict';
import {createPublicKey} from 'node:crypto';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {bootstrap} from './bootstrap.mjs';
import {refreshManifest,runManifestWorker} from './manifest-worker.mjs';

const roots=[];test.afterEach(async()=>Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true}))));
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'cloud-manifest-'));roots.push(directory);const config=await bootstrap(directory);return {directory,config};}
async function manifest(directory,config,now){return verifyManifest(JSON.parse(await readFile(join(directory,'gateway-manifest.json'),'utf8')),createPublicKey(await readFile(join(directory,'gateway-issuer.pem'))),config.gateway.cellId,now);}

test('refresh publishes monotonically increasing, short-lived signed authority across restarts',async()=>{
 const {directory,config}=await fixture(),firstNow=Date.now()+1000;
 const first=await refreshManifest(directory,{now:firstNow});assert.equal(first.sequence,2);assert.equal(first.expiresAt,new Date(firstNow+540000).toISOString());
 assert.equal((await stat(join(directory,'gateway-sequence'))).mode&0o777,0o600);
 assert.equal((await manifest(directory,config,firstNow)).sequence,2);
 const restarted=await refreshManifest(directory,{now:firstNow+240000});assert.equal(restarted.sequence,3);assert.equal((await manifest(directory,config,firstNow+240000)).sequence,3);
 const status=JSON.parse(await readFile(join(directory,'gateway-manifest-status.json'),'utf8'));
 assert.deepEqual(status,{version:1,sequence:3,publishedAt:new Date(firstNow+240000).toISOString(),expiresAt:new Date(firstNow+780000).toISOString()});
});

test('refresh refuses a stale persisted sequence instead of lowering authority',async()=>{
 const {directory}=await fixture(),now=Date.now()+1000;await refreshManifest(directory,{now});
 await writeFile(join(directory,'gateway-sequence'),'1\n',{mode:0o600});
 await assert.rejects(refreshManifest(directory,{now:now+1000}),/local_stack\.manifest_state_invalid/);
});

test('manifest replacement remains complete while the next sequence is persisted',async()=>{
 const {directory,config}=await fixture(),before=await readFile(join(directory,'gateway-manifest.json'),'utf8');
 let release;const gate=new Promise(resolve=>{release=resolve;});let reached;const paused=new Promise(resolve=>{reached=resolve;});
 const running=refreshManifest(directory,{now:Date.now()+1000,afterSequence:async()=>{reached();await gate;}});
 await paused;assert.equal(await readFile(join(directory,'gateway-manifest.json'),'utf8'),before);release();
 const result=await running;assert.equal(result.sequence,2);assert.equal((await manifest(directory,config,Date.now())).sequence,2);
});

test('worker exits cleanly when its refresh wait is aborted',async()=>{
 const {directory}=await fixture(),controller=new AbortController();let waits=0;
 await runManifestWorker({directory,signal:controller.signal,now:()=>Date.now()+waits*240000,wait:async(_delay,signal)=>{waits++;controller.abort();throw Object.assign(new Error('aborted'),{name:'AbortError',cause:signal.reason});}});
 assert.equal(waits,1);assert.equal(Number((await readFile(join(directory,'gateway-sequence'),'utf8')).trim()),2);
});
