import assert from 'node:assert/strict';
import test from 'node:test';
import {startLocalStack} from './local-stack-lifecycle.mjs';

test('local stack start builds, starts, gates jobs and waits for health',async()=>{
 const calls=[];
 await startLocalStack('up',{run:(args,options)=>{calls.push({args,options});return'';},waitForReady:async read=>{await read();calls.push({ready:true});}});
 assert.deepEqual(calls,[
  {args:['build','bootstrap'],options:undefined},
  {args:['up','-d','--no-build'],options:undefined},
  {args:['ps','-a','--format','json'],options:{capture:true}},
  {ready:true},
  {args:['ps','-a'],options:undefined}
 ]);
});

test('local stack upgrade force-recreates services after rebuilding',async()=>{
 const calls=[];
 await startLocalStack('upgrade',{run:(args,options)=>{calls.push({args,options});return'';},waitForReady:async()=>{}});
 assert.deepEqual(calls[1].args,['up','-d','--no-build','--force-recreate']);
 await assert.rejects(startLocalStack('reset',{run:()=>'',waitForReady:async()=>{}}),/local_stack\.lifecycle_mode/);
});
