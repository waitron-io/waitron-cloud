import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertMemoryKillEvidence} from './fixtures/assert-memory-kill.ts';

const childKill={oomKilled:false,exitCode:73,resourceDetail:{entryPid:1,entryReason:'child_resource',child:{childPid:16,childExitCode:null,childSignal:'SIGKILL'},memoryBefore:{oom:0,oom_kill:0},memoryAfter:{oom:1,oom_kill:1}}};
const change=(patch:Record<string,unknown>)=>({...childKill,resourceDetail:{...childKill.resourceDetail,...patch}});

test('memory exhaustion accepts Docker reporting its own OOM kill',()=>{
 assert.doesNotThrow(()=>assertMemoryKillEvidence({oomKilled:true}));
});
test('memory exhaustion accepts a cgroup-killed child while the entry survives',()=>{
 assert.doesNotThrow(()=>assertMemoryKillEvidence(childKill));
});
for(const [name,cause] of [
 ['exit 73 without any kill witness',{oomKilled:false,exitCode:73}],
 ['an ordinary externally killed container',{oomKilled:false,exitCode:137}],
 ['valid-looking diagnostics on another exit',{...childKill,exitCode:1}],
 ['a watchdog child kill without a cgroup kill',change({memoryAfter:{oom:0,oom_kill:0}})],
 ['memory pressure without a kill',change({memoryAfter:{oom:1,oom_kill:0}})],
 ['an earlier kill before this restore',change({memoryBefore:{oom_kill:1},memoryAfter:{oom_kill:1}})],
 ['decreasing counters',change({memoryBefore:{oom_kill:2},memoryAfter:{oom_kill:1}})],
 ['missing before counters',change({memoryBefore:null})],
 ['missing after counters',change({memoryAfter:null})],
 ['an absent child',change({child:null})],
 ['a successful child',change({child:{childPid:16,childExitCode:0,childSignal:null}})],
 ['a child abort without a kill signal',change({child:{childPid:16,childExitCode:null,childSignal:'SIGABRT'}})],
 ['a scratch refusal',change({entryReason:'scratch_full'})],
 ['the entry reported as its own child',change({child:{childPid:1,childExitCode:null,childSignal:'SIGKILL'}})],
 ['a missing entry pid',change({entryPid:null})],
 ['an invalid child pid',change({child:{childPid:0,childExitCode:null,childSignal:'SIGKILL'}})],
 ['a child with both an exit code and signal',change({child:{childPid:16,childExitCode:0,childSignal:'SIGKILL'}})],
 ['negative counters',change({memoryBefore:{oom_kill:-1}})],
 ['fractional counters',change({memoryAfter:{oom_kill:0.5}})],
 ['non-numeric counters',change({memoryAfter:{oom_kill:'1'}})],
 ['unsafe counters',change({memoryAfter:{oom_kill:Number.MAX_SAFE_INTEGER+1}})],
] as const)test(`memory exhaustion rejects ${name}`,()=>{
 assert.throws(()=>assertMemoryKillEvidence(cause),assert.AssertionError);
});
