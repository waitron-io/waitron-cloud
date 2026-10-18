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
