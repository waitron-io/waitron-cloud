import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bufferObject} from '../../packages/backups/src/object-transfer.ts';
const execute=promisify(execFile),image=process.env.TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE;
const implementation=await import('./test-fixtures/snapshot-verifier-controls.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});

test('same-run verifier controls have an executable fixture',()=>assert.equal(typeof implementation.snapshotVerifierControls,'function','same-run verifier controls are missing'));
// The same genuine bytes must survive every failed child and still pass the real pinned verifier.
test('same-run controls retain archive identity, bound outcomes and exact child cleanup',{skip:!image,timeout:150000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-verifier-controls-')),runId='controls-'+randomUUID(),owner='proof-'+randomUUID();let captureId;
 const docker=async args=>(await execute('docker',args,{timeout:60000,maxBuffer:8*1024*1024})).stdout.trim();
 t.after(async()=>{try{if(captureId)await docker(['rm','-f','-v',captureId]);}finally{await rm(directory,{recursive:true,force:true});}});
 const source=await readFile(new URL('test-fixtures/snapshot-archive.mjs',import.meta.url),'utf8'),recoveryKey=randomBytes(32).toString('base64url');
 captureId=await docker(['create','--network','none','--memory','1024m','--memory-swap','1024m','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--pids-limit','128','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777','--entrypoint','node','-i',image,'--import','/waitron/apps/server/node_modules/tsx/dist/loader.mjs','--input-type=module','-e',source]);
 const captured=await new Promise((resolve,reject)=>{const child=spawn('docker',['start','-ai',captureId],{stdio:['pipe','pipe','pipe']});let output='',size=0;const timer=setTimeout(()=>child.kill('SIGKILL'),60000);child.stdout.on('data',part=>{size+=part.length;if(size>8*1024*1024)child.kill('SIGKILL');else output+=part;});child.stderr.resume();child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(JSON.parse(output.trim().split('\n').at(-1))):reject(Error('fixture capture failed'));});child.stdin.end(JSON.stringify({recoveryKey}));});
 const archive=Buffer.from(captured.archive,'base64'),object=bufferObject(archive),target=JSON.parse(await readFile(new URL('../backup-verifier/target.json',import.meta.url),'utf8')),vector=JSON.parse(await readFile(new URL('../../packages/backups/test/fixtures/verification-vector.json',import.meta.url),'utf8'));
 const request={...vector,target,sourceNodeId:captured.metadata.sourceNodeId,capturedAt:captured.metadata.manifest.createdAt,archive:{...vector.archive,sha256:object.receipt.digest,bytes:object.receipt.size,modules:captured.metadata.manifest.modules},verifierImage:'local.waitron-verifier@'+image};
 const actual=await implementation.snapshotVerifierControls({directory,image,owner,runId,request,archive:captured.archive,recoveryKey});
 const unsupported=actual.cases.find(c=>c.name==='unsupported-format');assert(unsupported,'real unsupported-format control is required');
 assert.equal(unsupported.result.status,'unsupported');assert.equal(unsupported.result.reason,'archive_format_unsupported');assert.equal(unsupported.request.archive.manifestVersion,2);
 const oom=actual.cases.find(c=>c.name==='oom');assert(oom,'real same-run OOM control is required');
 assert.equal(oom.error,'backup.verifier_resource');assert.equal(oom.result,null);assert.equal(oom.receipt,null);
 assert.deepEqual(oom.runtime,{oomKilled:true,memoryBytes:1073741824,memorySwapBytes:1073741824,exitCode:137});
 assert.deepEqual(actual.cases.map(c=>c.name),['wrong-key','archive-integrity','malformed-output','timeout','scratch','cancel','crash','uncertain-cleanup','oom','unsupported-format','later-valid']);
 assert.equal(actual.runId,runId);assert.equal(actual.archiveSha256,object.receipt.digest);assert.equal(actual.archiveBytes,object.receipt.size);
 assert.equal(actual.cases[0].result.status,'unavailable');assert.equal(actual.cases[0].result.reason,'decryption_unavailable');
 assert.equal(actual.cases[1].result.status,'invalid');assert.equal(actual.cases[1].result.reason,'archive_digest_mismatch');
 for(const [name,error] of [['malformed-output','backup.verifier_output'],['timeout','backup.verifier_timeout'],['scratch','backup.verifier_resource'],['cancel','backup.verifier_cancelled'],['crash','backup.verifier_container'],['uncertain-cleanup','backup.verifier_cleanup']])assert.equal(actual.cases.find(c=>c.name===name).error,error,name);
 assert(actual.cases.every(c=>c.terminated&&c.cleanupConfirmed));assert.equal(new Set(actual.cases.map(c=>c.childId)).size,actual.cases.length);
 assert.equal(new Set(actual.cases.map(c=>c.request.attempt.childToken)).size,actual.cases.length);
 assert(actual.cases.every(c=>c.request.archive.sha256===object.receipt.digest&&c.request.archive.bytes===object.receipt.size));
 assert.equal(actual.cases.at(-1).result.status,'passed');assert.equal(actual.cases.at(-1).result.modules.length,15);
 assert.equal(actual.cases.find(c=>c.name==='scratch').faultObserved,true);
 assert.equal(actual.cases.find(c=>c.name==='uncertain-cleanup').faultObserved,true);
 assert(!JSON.stringify(actual).includes(recoveryKey));assert(!JSON.stringify(actual).includes(captured.archive));
 assert.equal(await docker(['ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner='+owner]),'');
});
for(const field of ['digest','size'])test('same-run controls refuse a different source '+field+' before Docker',async()=>{
 const object=bufferObject(Buffer.from('genuine-fixture-source'));
 await assert.rejects(implementation.snapshotVerifierControls({archive:Buffer.from('genuine-fixture-source').toString('base64'),request:{archive:{sha256:field==='digest'?'0'.repeat(64):object.receipt.digest,bytes:object.receipt.size+(field==='size'?1:0)}}}),{code:'ERR_ASSERTION'});
});
