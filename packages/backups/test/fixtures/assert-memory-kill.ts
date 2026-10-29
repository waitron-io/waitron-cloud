import assert from 'node:assert/strict';

export function assertMemoryKillEvidence(cause:any):void {
 if(cause?.oomKilled===true)return;
 const detail=cause?.resourceDetail;
 assert.equal(cause?.exitCode,73);
 assert.equal(detail?.entryReason,'child_resource');
 const {entryPid,child,memoryBefore,memoryAfter}=detail;
 assert(Number.isSafeInteger(entryPid)&&entryPid>0);
 assert(Number.isSafeInteger(child?.childPid)&&child.childPid>0&&child.childPid!==entryPid);
 assert.equal(child.childSignal,'SIGKILL');
 assert.equal(child.childExitCode,null);
 const before=memoryBefore?.oom_kill,after=memoryAfter?.oom_kill;
 assert(Number.isSafeInteger(before)&&before>=0);
 assert(Number.isSafeInteger(after)&&after>=0);
 assert(after>before,'memory exhaustion needs a fresh cgroup OOM kill');
}
