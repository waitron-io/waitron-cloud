import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

const failures=[['undefined',undefined],['null',null],['false',false],['zero',0],['empty string','']] as const;

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

for(const [label,failure] of failures){
  for(const phase of ['schedule','poll'] as const)for(const reported of [false,true]){
    test(`${phase} rejection with ${label} ${reported?'reaches reporting':'remains a rejection'}`,{timeout:2000},async()=>{
      const stop=new AbortController(),reports:unknown[]=[];
      let schedules=0,claims=0,waits=0;
      const result=await runWorkerLoop({
        signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,
        async schedule(){schedules++;if(phase==='schedule')throw failure;},
        async runOnce(){if(++claims>1)stop.abort();return false;},
        async wait(milliseconds,signal){
          assert.equal(milliseconds,10);assert.equal(signal,stop.signal);
          waits++;stop.abort();throw failure;
        },
        onError:reported?async error=>{reports.push(error);stop.abort();}:undefined,
      }).then(()=>({status:'fulfilled' as const}),(reason:unknown)=>({status:'rejected' as const,reason}));
      assert.deepEqual(result,reported?{status:'fulfilled'}:{status:'rejected',reason:failure});
      assert.deepEqual(reports,reported?[failure]:[]);
      assert.equal(schedules,1);
      assert.equal(claims,phase==='schedule'?0:1);
      assert.equal(waits,phase==='schedule'?0:1);
    });
  }

  for(const reported of [false,true]){
    test(`claim rejection with ${label} awaits sibling cleanup before ${reported?'reporting':'propagation'}`,{timeout:2000},async()=>{
      const stop=new AbortController(),entered=gate(),failed=gate(),sibling=gate(),reportEntered=gate(),reportDone=gate();
      const reports:unknown[]=[],completed:number[]=[];
      let claims=0,schedules=0,waits=0,finished=false;
      const running=runWorkerLoop({
        signal:stop.signal,concurrency:2,scheduleIntervalMs:60,pollIntervalMs:10,
        async schedule(){schedules++;assert.equal(schedules,1);},
        async runOnce(signal){
          assert.equal(signal,stop.signal);
          const index=claims++;
          if(index>=2){stop.abort();assert.fail('a rejected batch must not refill');}
          if(index===1)entered.release();
          await (index===0?failed:sibling).pending;
          completed.push(index);
          if(index===0)throw failure;
          return true;
        },
        async wait(){waits++;assert.fail('a failed batch must not enter idle polling');},
        onError:reported?async error=>{
          reports.push(error);reportEntered.release();await reportDone.pending;
        }:undefined,
      }).then(()=>({status:'fulfilled' as const}),(reason:unknown)=>({status:'rejected' as const,reason})).finally(()=>{finished=true;});
      const reach=async(pending:Promise<void>)=>Promise.race([pending,running.then(result=>{
        assert.fail(`worker returned before the pending operation: ${result.status}`);
      })]);
      try{
        await reach(entered.pending);
        failed.release();await turn();
        assert.deepEqual(completed,[0]);
        assert.equal(finished,false,'the successful sibling still owns unfinished cleanup');
        assert.deepEqual(reports,[]);assert.equal(waits,0);assert.equal(claims,2);
        sibling.release();
        if(reported){
          await reach(reportEntered.pending);stop.abort();await turn();
          assert.equal(finished,false,'shutdown must await the pending report');
          assert.deepEqual(completed,[0,1]);assert.deepEqual(reports,[failure]);
          assert.equal(claims,2);assert.equal(waits,0);
          reportDone.release();
        }
        assert.deepEqual(await running,reported?{status:'fulfilled'}:{status:'rejected',reason:failure});
        assert.deepEqual(completed,[0,1]);assert.deepEqual(reports,reported?[failure]:[]);
        assert.equal(claims,2);assert.equal(schedules,1);assert.equal(waits,0);
      }finally{
        stop.abort();failed.release();sibling.release();reportDone.release();await running;
      }
    });
  }

  test(`reporter rejection with ${label} remains a rejection`,{timeout:2000},async()=>{
    const stop=new AbortController(),sourceFailure=new Error('scheduling refused'),reports:unknown[]=[];
    let schedules=0,claims=0,waits=0;
    const result=await runWorkerLoop({
      signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,
      async schedule(){schedules++;throw sourceFailure;},
      async runOnce(){claims++;stop.abort();return false;},
      async wait(){waits++;stop.abort();},
      async onError(error){reports.push(error);stop.abort();throw failure;},
    }).then(()=>({status:'fulfilled' as const}),(reason:unknown)=>({status:'rejected' as const,reason}));
    assert.deepEqual(result,{status:'rejected',reason:failure});
    assert.deepEqual(reports,[sourceFailure]);
    assert.equal(schedules,1);assert.equal(claims,0);assert.equal(waits,0);
  });
}
