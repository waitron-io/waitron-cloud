// Runs in a disposable target, separate from the verifier. No fiscal authority enters this process.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:https';
import {createCloudRecoveryClient} from '/waitron/apps/server/src/cloud-recovery.ts';
import {currentBackupVerificationTarget} from '/waitron/apps/server/src/backup-verification-target.ts';
import {backupVerificationTargetDigests,validateBackupVerificationTarget} from '/waitron/apps/server/src/backup-verification-protocol.ts';
import {stageRestoreRequest,runStagedRestore} from '/waitron/apps/server/src/restore-request.ts';
import {REBUILD_MARKER} from '/waitron/apps/server/src/rebuild-first-start.ts';
const root='/tmp/cloud-integration-backup-recovery-d79',origin='https://waitron.local:3000';
let text='';for await(const bytes of process.stdin){text+=bytes;assert(text.length<65536);}
const input=JSON.parse(text),phase=input.phase;
await mkdir(root,{recursive:true,mode:0o700});
if(phase==='start')await writeFile(join(root,'ca.pem'),input.ca,{mode:0o600});
const ca=await readFile(join(root,'ca.pem'),'utf8'),actions=[];
// Only route the HTTPS socket through the proof proxy; signed origins and response bytes stay intact.
const fetchApi=(url,options)=>new Promise((resolve,reject)=>{
 const target=new URL(url);assert.equal(target.origin,origin);actions.push(target.pathname.split('/').at(-1));
 const req=request({hostname:'proxy',port:3000,servername:'waitron.local',ca,path:target.pathname,method:options.method,headers:{...options.headers,host:'waitron.local:3000'}},res=>{
  const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>65536)req.destroy(Error('fixture.response_large'));else chunks.push(chunk);});
  res.once('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode})));
 });req.once('error',reject);req.setTimeout(10000,()=>req.destroy(Error('fixture.api_timeout')));req.end(options.body);
});
const client=createCloudRecoveryClient({stateDir:root,origin,environment:'preproduction',snapshotProtocol:2,target:currentBackupVerificationTarget,fetch:fetchApi,storageCa:ca});
const absent=async name=>{try{await stat(join(root,name));return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};
if(phase==='start'){
 const started=await client.start();assert.equal(started.state,'awaiting_owner');assert.deepEqual(actions,['start']);
 // The code stays on the private stdin path to the owner fixture; it is never printed by the outer test.
 console.log(JSON.stringify({requestId:started.requestId,code:started.code,targetDigest:currentBackupVerificationTarget().digest}));
}else if(phase==='read'){
 const approved=await client.status();assert.equal(approved.state,'approved');assert.equal(approved.point.id,input.pointId);
 const checked=await client.preview(async archive=>{
  assert.equal(archive.managedCloud.pointId,input.pointId);assert.equal(archive.snapshotVerification.target.digest,currentBackupVerificationTarget().digest);
  assert.equal(archive.artifact.length,input.bytes);assert.equal(createHash('sha256').update(archive.artifact).digest('hex'),input.digest);
  assert.equal(await absent('venue/venue.db'),true);assert.equal(await absent('restore-request.json'),true);
  return{independentDigest:true,prePlacement:true,privateDelivery:{archive:Buffer.from(archive.artifact).toString('base64'),recoveryKey:archive.recoveryKey,digest:input.digest}};
 },input.pointId);
 assert(actions.includes('info'));assert(actions.includes('read'));
 console.log(JSON.stringify({...checked,client:'pinned-compiled-waitron',targetDigest:currentBackupVerificationTarget().digest,actions}));
}else if(phase==='delivery-refusals'){
 const original=await client.preview(async archive=>Buffer.from(archive.artifact),input.pointId);
 assert.equal(createHash('sha256').update(original).digest('hex'),input.digest);
 const saved=await readFile(join(root,'cloud-recovery.json'));
 let placementCalls=0,downloads=0;
 const stage=async()=>{placementCalls++;};
 const current=currentBackupVerificationTarget(),runtime={...current.runtime,fingerprint:createHash('sha256').update(current.runtime.fingerprint+'alternate-binary').digest('hex')};
 const alternate=validateBackupVerificationTarget({...current,runtime,...backupVerificationTargetDigests({runtime,modules:current.modules})});
 assert.notEqual(alternate.digest,current.digest);
 actions.length=0;
 const changed=createCloudRecoveryClient({stateDir:root,origin,environment:'preproduction',snapshotProtocol:2,target:()=>alternate,fetch:fetchApi,storageCa:ca});
 await assert.rejects(changed.restore(stage,input.pointId),/Cloud recovery is unavailable/);
 assert.deepEqual(actions,[],'a changed runtime must refuse before any remote read');
 // Damage a copy at the transport boundary; the unchanged client must check its actual grant.
 const damaged=Buffer.from(original);damaged[damaged.length-1]^=1;
 const broken=createCloudRecoveryClient({stateDir:root,origin,environment:'preproduction',snapshotProtocol:2,target:currentBackupVerificationTarget,fetch:fetchApi,storageCa:ca,download:async grant=>{
  downloads++;assert.equal(grant.point.id,input.pointId);assert.equal(grant.point.digest,input.digest);return damaged;
 }});
 await assert.rejects(broken.restore(stage,input.pointId),/Cloud recovery is unavailable/);
 assert.equal(downloads,1,'the damaged copy must reach the real client integrity check');
 assert(actions.includes('info'));assert(actions.includes('read'));assert(!actions.includes('restored'));
 assert.equal(placementCalls,0);assert.equal(await absent('restore-request.json'),true);assert.equal(await absent('venue/venue.db'),true);
 assert.deepEqual(await readFile(join(root,'cloud-recovery.json')),saved);
 console.log(JSON.stringify({alternateTargetRefused:true,damagedArchiveRefused:true,placementCalls,restoredReports:0,stateUnchanged:true}));
}else if(phase==='restore-refusal'){
 await client.restore(archive=>stageRestoreRequest(root,archive),input.pointId);
 assert.equal(JSON.parse(await readFile(join(root,'restore-request.json'),'utf8')).version,2);
 let refusal;try{await runStagedRestore({stateDir:root,venueDir:join(root,'venue'),migrationsRoot:'/waitron/apps/server/dist/drizzle',log:()=>{}});}catch(error){refusal=error;}
 if(refusal?.code!=='restore.hook_failed')console.error('fixture-error:restore_refusal:'+String(refusal?.code??'missing').replace(/[^A-Za-z0-9_]/g,'_'));
 assert.equal(refusal?.code,'restore.hook_failed');assert.deepEqual(refusal?.params,{module:'fiscal-verifactu',code:'sif.allocation_invalid'});
 assert.equal(await absent('restore-request.json'),true);assert.equal(await absent('trading.env'),true);assert.equal(await absent(REBUILD_MARKER),true);
 const saved=JSON.parse(await readFile(join(root,'cloud-recovery.json'),'utf8'));assert.equal(saved.phase,'staged');assert(!actions.includes('restored'));
 console.log(JSON.stringify({ordinaryRestore:'FISCAL_RESTORE',activation:'not_attempted',routeMoved:false,reportedRestored:false,actions}));
}else throw Error('fixture.phase');
