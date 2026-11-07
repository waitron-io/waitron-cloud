import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('the immutable Python entry selects the named canary controller with literal inputs',t=>{
 const root=mkdtempSync(join(tmpdir(),'ci-entry-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const node=join(root,'node');writeFileSync(node,'#!/usr/bin/env python3\nimport sys,json\nprint(json.dumps(sys.argv[1:]))\n',{mode:0o700});
 const entry=new URL('../../deploy/disposable-tests/mac-controller.py',import.meta.url).pathname;
 const result=spawnSync('python3',['-I','-B',entry,node,join(root,'config.json'),'canary','I','3'.repeat(40)],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const args=JSON.parse(result.stdout);
 assert.equal(args[0],new URL('./ci-canary.mjs',import.meta.url).pathname);assert.deepEqual(args.slice(1),[join(root,'config.json'),'I','3'.repeat(40)]);
});
test('automatic manual reconciliation retries orphan removal after freeing a CI guest',async t=>{
 const {LocalLeases}=await import('./leases.mjs'),{withKernelLock}=await import('./kernel-lock.mjs');
 const {ciRequest}=await import('./ci-identity.mjs'),{reconcileManual}=await import('./manual.mjs');
 const root=mkdtempSync(join(tmpdir(),'ci-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const state=join(root,'state');let leases;
 await withKernelLock(state,async()=>{leases=new LocalLeases(join(state,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
 const ci={repositoryId:123,workflowId:456,workflowPath:'.github/workflows/disposable-ci-canary.yml',workflowSha:'1'.repeat(40),workflowDigest:'2'.repeat(64),
 event:'workflow_dispatch',sourceSha:'3'.repeat(40),sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'typecheck'};
 const lease=leases.reserveLocal(ciRequest('I',ci)).lease;leases.start(lease);let gone=false,registered=true;
 const api={get:async()=>({total_count:registered?1:0,runners:registered?[{id:1001,name:'dt-123-789-1-901'}]:[]}),
 delete:async()=>{assert.equal(gone,true);registered=false;}};
 const result=await reconcileManual({state,hostGeneration:'test',ci:{repository:'fixture/cloud'},api,
 transport:{destroy:async()=>{gone=true;},inspect:async()=>({resourceId:lease.resourceId,absent:true})}});
 assert.equal(result.code,0);assert.equal(registered,false);assert.deepEqual(leases.inspect().orphanRunners,[]);
});
