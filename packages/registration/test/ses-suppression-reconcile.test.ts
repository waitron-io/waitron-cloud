import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSesSuppressionReconciler} from '../src/ses-suppression-reconcile.ts';
const binding={operationId:'synthetic-operation',scope:{country:'ES',providerAccountId:'123456789012',region:'eu-north-1' as const},revision:3};
test('regional reconciliation removes each reported reason and independently queries the final state',async()=>{
 let queries=0;const removed:string[]=[];
 const reconciler=createSesSuppressionReconciler({async query(scope,recipient,signal){assert.deepEqual(scope,binding.scope);assert.equal(recipient,'owner@example.test');assert.equal(signal.aborted,false);return queries++===0?['COMPLAINT','BOUNCE']:[];},async remove(scope,recipient,reason){assert.deepEqual(scope,binding.scope);assert.equal(recipient,'owner@example.test');removed.push(reason);}});
 const observation=await reconciler.reconcile(binding,'owner@example.test',new AbortController().signal);
 assert.equal(queries,2);assert.deepEqual(removed,['BOUNCE','COMPLAINT']);
 assert.deepEqual(reconciler.evidence(observation,binding),{status:'confirmed',before:['BOUNCE','COMPLAINT'],after:[]});
 assert.equal(reconciler.evidence({...observation},binding),null);assert.equal(reconciler.evidence(observation,{...binding,revision:4}),null);
 assert.equal(reconciler.evidence(observation,{...binding,operationId:'other'}),null);assert.equal(reconciler.evidence(observation,{...binding,scope:{...binding.scope,country:'FR'}}),null);
});
for(const mode of ['malformed','duplicate','unknown','throw','timeout','aborted'] as const)test(`provider ${mode} never yields confirmation`,async()=>{
 const controller=new AbortController();if(mode==='aborted')controller.abort();let writes=0;
 const reconciler=createSesSuppressionReconciler({async query(){if(mode==='throw')throw Error('secret provider response');if(mode==='timeout')return new Promise(()=>{});return mode==='malformed'?null as any:mode==='duplicate'?['BOUNCE','BOUNCE']:mode==='unknown'?['OTHER']:[];},async remove(){writes++;}},300000,20);
 const start=performance.now(),observation=await reconciler.reconcile(binding,'owner@example.test',controller.signal);
 assert.equal(reconciler.evidence(observation,binding)?.status,'failed');assert.equal(writes,0);assert.ok(performance.now()-start<1000,'provider refusal remains bounded');
 assert.equal(JSON.stringify(observation).includes('secret'),false);
});
