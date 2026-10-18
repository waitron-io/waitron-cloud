import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {test} from 'node:test';
import {runNodeVerifier} from '../src/verify-process.ts';

test('heap exhaustion stops and reaps a verifier even when fatal exit is delayed',async t=>{
 const spawn=childProcess.spawn;
 let pid:number|undefined,stopped=false,errors='';
 t.mock.method(childProcess,'spawn',(...args:Parameters<typeof spawn>)=>{
  const child=spawn(...args);pid=child.pid;
  child.stderr?.on('data',(bytes:Buffer)=>{
   errors+=bytes.toString('utf8');
   // A real heap failure precedes the kernel's potentially slow crash-dump collection.
   if(!stopped&&/FATAL ERROR:.*(?:heap out of memory|heap limit)/i.test(errors)){
    process.kill(-child.pid!,'SIGSTOP');stopped=true;
   }
  });
  return child;
 });
 syncBuiltinESMExports();
 const start=Date.now();
 try{
  await assert.rejects(runNodeVerifier(['-e',"const values=[];for(let i=0;i<5_000_000;i++)values.push(i);console.log('{}')"],{input:{},timeoutMs:5000,limits:{heapMiB:16}}),/^Error: backup.verifier_resource$/);
  assert.equal(stopped,true);
  assert(Date.now()-start<4000);
  assert.throws(()=>process.kill(pid!,0));
 }finally{
  t.mock.restoreAll();syncBuiltinESMExports();
  if(pid)try{process.kill(-pid,'SIGKILL');}catch{/* Already reaped. */}
 }
});

test('a split fatal heap report stops the child without exposing its diagnostics',async()=>{
 const code="process.stderr.write('private-prefix\\nFATAL ERROR: Reached heap ');setTimeout(()=>process.stderr.write('limit Allocation failed - JavaScript heap out of memory\\nprivate-secret'),100);setInterval(()=>{},1000)";
 await assert.rejects(runNodeVerifier(['-e',code],{input:{},timeoutMs:5000}),/^Error: backup.verifier_resource$/);
});

test('ordinary heap words and non-heap fatal reports do not become early resource refusals',async()=>{
 const value=await runNodeVerifier(['-e',"console.error('heap out of memory');console.log('{}')"],{input:{}});
 assert.deepEqual(value,{});
 const quoted=await runNodeVerifier(['-e',"console.error('x FATAL ERROR: heap limit');console.log('{}')"],{input:{}});
 assert.deepEqual(quoted,{});
 await assert.rejects(runNodeVerifier(['-e',"console.error('FATAL ERROR: private unrelated failure');process.exit(3)"],{input:{}}),/^Error: backup.verifier_failed$/);
});
