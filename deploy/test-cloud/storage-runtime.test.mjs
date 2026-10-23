import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {bootstrapStorageIssuer} from './storage-issuer.mjs';
import {loadRuntime} from '../local-stack/runtime.mjs';
// Restarting with yesterday's IAM file would expose old writers before policy reconciliation.
test('storage boot withholds durable writer keys until current policy reconciliation and refuses lost state',async t=>{
 const root=await mkdtemp(join(tmpdir(),'test-storage-boot-'));t.after(()=>rm(root,{recursive:true,force:true}));await bootstrapStorageIssuer(root);
 const {prepareStorageBoot}=await import('./storage-worker.mjs');const directory=join(root,'storage-authority'),file=join(directory,'iam.json'),state=join(directory,'managed/state.json');
 await mkdir(join(directory,'managed'),{mode:0o700});
 await writeFile(file,JSON.stringify({identities:[{name:'managed-writer-old',credentials:[{accessKey:'old-writer',secretKey:'not-exported'}],actions:['Write:venue/*']}]}),{mode:0o600});
 await assert.rejects(prepareStorageBoot(root),/test_cloud.storage_state/);
 const saved='{"version":1,"venues":{}}';await writeFile(state,saved,{mode:0o600});
 await prepareStorageBoot(root);
 const config=await loadRuntime(root),iam=JSON.parse(await readFile(file,'utf8'));
 assert.equal(iam.identities.length,1);assert.equal(iam.identities[0].credentials[0].accessKey,config.storage.accessKeyId);assert.equal(JSON.stringify(iam).includes('old-writer'),false);
 assert.equal(await readFile(state,'utf8'),saved,'boot must preserve recovery identity for reconciliation');
});

// Account provisioning and restart publication share IAM; neither may overwrite a held transaction.
test('storage boot waits for the shared authority lease before replacing IAM',async t=>{
 const root=await mkdtemp(join(tmpdir(),'test-storage-lease-'));t.after(()=>rm(root,{recursive:true,force:true}));await bootstrapStorageIssuer(root);
 const {claimLease}=await import('../local-stack/lease.mjs'),{prepareStorageBoot}=await import('./storage-worker.mjs');
 const directory=join(root,'storage-authority/managed');await mkdir(directory,{mode:0o700});
 const lease=await claimLease(join(directory,'.authority.lock'));t.after(()=>lease.release());
 const pending=prepareStorageBoot(root);let finished=false;void pending.then(()=>finished=true,()=>{});
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(finished,false,'boot cannot publish while an account provider operation owns IAM');
 await lease.release();await pending;assert.ok(JSON.parse(await readFile(join(root,'storage-authority/iam.json'),'utf8')).identities.length);
});
