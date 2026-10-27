import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runNodeVerifier} from '../src/verify-process.ts';
import childProcess from 'node:child_process';

for(const [name,code,expected] of [
 ['child SIGKILL',"process.kill(process.pid,'SIGKILL')",{childExitCode:null,childSignal:'SIGKILL',fatalHeap:false,scratchFull:false,fileLimit:false}],
 ['heap refusal',"process.stderr.write('FATAL ERROR: Reached heap limit\\nprivate-recovery-key');setInterval(()=>{},1000)",{childExitCode:null,childSignal:'SIGKILL',fatalHeap:true,scratchFull:false,fileLimit:false}],
 ['scratch refusal',"process.stderr.write('ENOSPC private-recovery-key');process.exit(3)",{childExitCode:3,childSignal:null,fatalHeap:false,scratchFull:true,fileLimit:false}],
 ['file limit',"process.stderr.write('EFBIG private-recovery-key');process.exit(3)",{childExitCode:3,childSignal:null,fatalHeap:false,scratchFull:false,fileLimit:true}],
] as const)test(`resource reporting distinguishes ${name} without echoing child text`,async t=>{
 const spawn=childProcess.spawn;let expectedPid:number|undefined;
 t.mock.method(childProcess,'spawn',(...args:Parameters<typeof spawn>)=>{const child=spawn(...args);expectedPid=child.pid;return child;});syncBuiltinESMExports();
 try{await assert.rejects(runNodeVerifier(['-e',code],{input:{},timeoutMs:5000}),(error:any)=>{
  assert.equal(error.message,'backup.verifier_resource');
  assert.equal(error.cause?.childPid,expectedPid);assert(expectedPid);
  const {childPid,...detail}=error.cause;assert.deepEqual(detail,expected);
  assert(!JSON.stringify(error).includes('private-recovery-key'));return true;
 });}finally{t.mock.restoreAll();syncBuiltinESMExports();}
});

import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import * as processVerifier from '../src/verify-process.ts';

test('memory reporting reads only this container’s fixed cgroup counters',t=>{
 assert.equal(typeof processVerifier.readVerifierMemoryEvents,'function');
 t.mock.method(fs,'readFileSync',(path:any,encoding:any)=>{
  assert.equal(path,'/sys/fs/cgroup/memory.events');assert.equal(encoding,'utf8');
  return 'low 0\nhigh 2\nmax 19\noom 3\noom_kill 1\noom_group_kill 0\nprivate_key 999\n';
 });syncBuiltinESMExports();
 try{assert.deepEqual(processVerifier.readVerifierMemoryEvents(),{low:0,high:2,max:19,oom:3,oom_kill:1,oom_group_kill:0});}
 finally{t.mock.restoreAll();syncBuiltinESMExports();}
});

for(const value of [null,'oom_kill -1\n','oom_kill 1.5\n','oom_kill 9007199254740992\n','oom_kill 1\noom_kill 2\n'])test(`unavailable or invalid memory counters stay unknown: ${JSON.stringify(value)}`,t=>{
 assert.equal(typeof processVerifier.readVerifierMemoryEvents,'function');
 t.mock.method(fs,'readFileSync',()=>{if(value===null)throw Error('private host path');return value;});syncBuiltinESMExports();
 try{assert.equal(processVerifier.readVerifierMemoryEvents(),null);}
 finally{t.mock.restoreAll();syncBuiltinESMExports();}
});

test('container resource detail keeps fixed process and counter fields and omits raw text',()=>{
 assert.equal(typeof processVerifier.readVerifierResourceDiagnostic,'function');
 const raw={entryPid:1,entryReason:'child_resource',child:{childPid:9,childExitCode:null,childSignal:'SIGKILL',fatalHeap:false,scratchFull:false,fileLimit:false,stderr:'private-child-secret'},memoryBefore:{oom:0,oom_kill:0},memoryAfter:{oom:1,oom_kill:1},private:'private-entry-secret'};
 const result=processVerifier.readVerifierResourceDiagnostic('private-prefix\nbackup.verifier_resource_detail '+JSON.stringify(raw)+'\n');
 assert.deepEqual(result,{entryPid:1,entryReason:'child_resource',child:{childPid:9,childExitCode:null,childSignal:'SIGKILL',fatalHeap:false,scratchFull:false,fileLimit:false},memoryBefore:{oom:0,oom_kill:0},memoryAfter:{oom:1,oom_kill:1}});
 assert(!JSON.stringify(result).includes('private'));
});

for(const raw of ['', 'backup.verifier_resource_detail invalid\n','backup.verifier_resource_detail null\n','backup.verifier_resource_detail '+JSON.stringify({entryPid:'private',child:{childPid:'private',childSignal:'private'},memoryAfter:{oom_kill:'private'}})+'\n'])test(`malformed resource detail is absent or contains only unknown fields: ${raw.slice(0,45)}`,()=>{
 assert.equal(typeof processVerifier.readVerifierResourceDiagnostic,'function');
 const value=processVerifier.readVerifierResourceDiagnostic(raw);
 if(raw.includes('"entryPid"'))assert.deepEqual(value,{entryPid:null,entryReason:null,child:null,memoryBefore:null,memoryAfter:null});
 else assert.equal(value,null);
});

const validChild={childPid:9,childExitCode:null,childSignal:'SIGKILL',fatalHeap:false,scratchFull:false,fileLimit:false};
for(const [field,value] of [['childSignal','private-signal'],['childExitCode',256],['childExitCode','private-exit'],['fatalHeap','private-flag']] as const)test(`valid child identity cannot bypass the ${field} filter with ${value}`,()=>{
 const result=processVerifier.readVerifierResourceDiagnostic('backup.verifier_resource_detail '+JSON.stringify({entryPid:1,entryReason:'child_resource',child:{...validChild,[field]:value}}));
 assert.deepEqual(result,{entryPid:1,entryReason:'child_resource',child:null,memoryBefore:null,memoryAfter:null});
});
test('an unrecognised entry reason cannot echo container text',()=>{
 const result=processVerifier.readVerifierResourceDiagnostic('backup.verifier_resource_detail '+JSON.stringify({entryPid:1,entryReason:'private-reason',child:validChild}));
 assert.deepEqual(result,{entryPid:1,entryReason:null,child:validChild,memoryBefore:null,memoryAfter:null});
});
test('the final resource report supersedes an earlier advisory line',()=>{
 const result=processVerifier.readVerifierResourceDiagnostic('backup.verifier_resource_detail {"entryPid":1}\nbackup.verifier_resource_detail {"entryPid":2}\n');
 assert.deepEqual(result,{entryPid:2,entryReason:null,child:null,memoryBefore:null,memoryAfter:null});
});
