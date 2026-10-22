import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
// A mutable tag or unlabelled/wrong-revision image must never run untrusted restore code.
test('test verifier refuses mutable images and requires the pinned genuine Waitron revision',async t=>{
 const {openTestBackupVerifier}=await import('./backup-worker.mjs');
 const directory=await mkdtemp(join(tmpdir(),'cloud-verifier-config-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const image of ['', 'waitron-backup-verifier:local','sha256:bad'])await assert.rejects(openTestBackupVerifier({directory,image}),/test_cloud.verifier_configuration/);
});

// A second orchestration process must not race expired-journal reclamation or admit another child.
test('only one trusted test backup worker owns the controller at a time',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {database}=await import('../../packages/account-http/test/fixtures.ts'),db=await database();t.after(()=>db.close());
 const {claimTestBackupWorker}=await import('./backup-worker.mjs');assert.equal(typeof claimTestBackupWorker,'function');
 const first=await claimTestBackupWorker(db.pool);try{const second=claimTestBackupWorker(db.secondPool);void second.then(lease=>lease.release(),()=>{});await assert.rejects(second,/test_cloud.verifier_busy/);}finally{await first.release();}
 const later=await claimTestBackupWorker(db.secondPool);await later.release();
});

// Ordinary mode must stop before opening the database or acquiring Docker authority.
test('test backup worker requires explicit plan enforcement before any work',async()=>{const {runTestBackupWorker}=await import('./backup-worker.mjs');await assert.rejects(runTestBackupWorker({CLOUD_TEST_SERVICE_PLANS:'0'},[]),/test_cloud.plan_mode/);});

// The runtime must hand the worker the same durable scope used by its bound controller.
test('test worker opens the pinned bound verifier and preserves its scope across restart',{timeout:150000},async t=>{
 const {execFileSync}=await import('node:child_process'),{readFile}=await import('node:fs/promises'),{fileURLToPath}=await import('node:url'),{randomUUID}=await import('node:crypto');
 const {bufferObject}=await import('../../packages/backups/src/object-transfer.ts'),{readFileSync}=await import('node:fs');
 const {openTestBackupVerifier}=await import('./backup-worker.mjs');
 const vector=JSON.parse(await readFile(new URL('../../packages/backups/test/fixtures/verification-vector.json',import.meta.url),'utf8'));
 const revision='5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa';
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim(),root=fileURLToPath(new URL('../../',import.meta.url));
 const directory=await mkdtemp(join(tmpdir(),'worker-bound-runtime-')),tag='cloud-worker-bound:'+randomUUID();t.after(()=>rm(directory,{recursive:true,force:true}));
 const image=docker('build','-q','--label','cloud.waitron-revision='+revision,'-t',tag,'-f',join(root,'packages/backups/test/container-fixture/Bound.Dockerfile'),root);t.after(()=>docker('image','rm',tag));
 const wrongTag=tag+'-wrong',wrongImage=docker('build','-q','--label','cloud.waitron-revision=e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee','-t',wrongTag,'-f',join(root,'packages/backups/test/container-fixture/Bound.Dockerfile'),root);t.after(()=>docker('image','rm',wrongTag));
 await assert.rejects(openTestBackupVerifier({directory,image:wrongImage}),/test_cloud.verifier_configuration/);
 for(const extra of [{owner:''},{memoryMiB:0},{scratchMiB:0}])await assert.rejects(openTestBackupVerifier({directory:join(directory,randomUUID()),image,...extra}),/verifier_configuration/);
 const settings={directory,image,owner:'runtime-'+randomUUID(),memoryMiB:192,scratchMiB:16};
 const opened=await openTestBackupVerifier(settings);assert.equal(typeof opened.verify,'function','runtime still opens the callback verifier');
 const identity=JSON.parse(await readFile(join(directory,'verifier-controller','identity.json'),'utf8'));assert.equal(opened.controllerScope,identity.scope);assert.equal(identity.owner,settings.owner);
 const request={...vector,verifierImage:'local.waitron-verifier@'+image,attempt:{...vector.attempt,controllerScope:opened.controllerScope,childToken:randomUUID(),deadline:new Date(Date.now()+25000).toISOString()}};
 const source=bufferObject(Buffer.from([0,255,1,2]));
 const output=await opened.verify({...source,open(){const journal=JSON.parse(readFileSync(join(directory,'verifier-controller','child.json'),'utf8'));const [child]=JSON.parse(docker('inspect',journal.id));assert.equal(child.HostConfig.Memory,201326592);assert.match(child.HostConfig.Tmpfs['/scratch'],/size=16m/);return source.open();}},{version:1,reference:'key-1',secret:'private-fixture-key'},request,new AbortController().signal);
 assert.equal(output.result.status,'passed');assert.equal(output.receipt.controllerScope,identity.scope);assert.equal(output.receipt.cleanupConfirmed,true);
 assert.equal((await openTestBackupVerifier(settings)).controllerScope,identity.scope);
});
