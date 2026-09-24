import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runNodeVerifier} from '../src/verify-process.ts';
test('verifier process receives private input without inheriting application secrets',async()=>{
 process.env.CLOUD_PROCESS_TEST_SECRET='private-test-value';
 try{const value=await runNodeVerifier(['-e',"let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.stringify({input:JSON.parse(s),secret:process.env.CLOUD_PROCESS_TEST_SECRET??null})))"],{input:{key:'private-stdin-value'}});assert.deepEqual(value,{input:{key:'private-stdin-value'},secret:null});}finally{delete process.env.CLOUD_PROCESS_TEST_SECRET;}
});
test('verifier process bounds time, output and cancellation without echoing child errors',async()=>{
 await assert.rejects(runNodeVerifier(['-e','setInterval(()=>{},1000)'],{input:{},timeoutMs:100}),/^Error: backup.verifier_timeout$/);
 await assert.rejects(runNodeVerifier(['-e',"console.log('private-output'.repeat(10000))"],{input:{}}),/^Error: backup.verifier_output$/);
 await assert.rejects(runNodeVerifier(['-e',"console.error('private-error');process.exit(3)"],{input:{}}),/^Error: backup.verifier_failed$/);
 const stop=new AbortController();const pending=runNodeVerifier(['-e','setInterval(()=>{},1000)'],{input:{},signal:stop.signal});stop.abort();await assert.rejects(pending,/backup.verifier_cancelled/);
 await assert.rejects(runNodeVerifier(['-e',"console.log('invalid JSON')"],{input:{}}),/backup.verifier_output/);
});

test('a successful verifier cannot leave its background child running',async()=>{
 const code="const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.unref();console.log(JSON.stringify({pid:c.pid}));";
 const result=await runNodeVerifier(['-e',code],{input:{}}) as {pid:number};
 try{await new Promise(r=>setTimeout(r,100));assert.throws(()=>process.kill(result.pid,0));}
 finally{try{process.kill(result.pid,'SIGKILL');}catch{/* Already reaped. */}}
});
