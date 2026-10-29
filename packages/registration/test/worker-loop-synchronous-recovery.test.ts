import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

for(const slots of [2,32])for(const throwSlot of [0,slots-1]){
  for(const outcome of ['retry','shutdown','sync-report-failure'] as const){
    test(`${slots} claims contain synchronous slot ${throwSlot} failure before ${outcome}`,{timeout:3000},async()=>{
      const stop=new AbortController(),entered=gate(),reporting=gate(),reportDone=gate(),retrying=gate(),retryDone=gate();
      const releases=Array.from({length:slots},gate);
      const failure=new Error('synchronous claim refused'),reportFailure=new Error('synchronous reporter refused');
      const started:number[]=[],completed:number[]=[],reported:unknown[]=[],waits:number[]=[],schedules:number[]=[];
      let now=0,finished=false;
      const running=runWorkerLoop({
        signal:stop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
        async schedule(){schedules.push(now);assert.equal(schedules.length,1);},
        runOnce(signal){
          assert.equal(signal,stop.signal);
          const index=started.length;started.push(index);
          assert.ok(index<slots*2,'a recovered batch must not refill again');
          if(index>=slots){
            if(started.length===slots*2)stop.abort();
            return Promise.resolve(false);
          }
          if(started.length===slots)entered.release();
          if(index===throwSlot){completed.push(index);throw failure;}
          return releases[index]!.pending.then(()=>{completed.push(index);return true;});
        },
        onError(error){
          reported.push(error);
          assert.equal(error,failure,'report the original synchronous error');
          assert.equal(reported.length,1);
          assert.equal(completed.length,slots,'all active claims must finish before reporting');
          reporting.release();
          if(outcome==='sync-report-failure')throw reportFailure;
          return reportDone.pending;
        },
        async wait(milliseconds,signal){
          assert.equal(outcome,'retry','shutdown or a failed reporter must not retry');
          assert.equal(signal,stop.signal);
          waits.push(milliseconds);assert.equal(waits.length,1);
          retrying.release();await retryDone.pending;now+=milliseconds;
        },
      }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{finished=true;});
      const reach=async(pending:Promise<void>)=>Promise.race([pending,running.then(result=>{
        if('error' in result)throw result.error;
        assert.fail('worker returned before its active operation finished');
      })]);
      try{
        await reach(entered.pending);await turn();
        assert.deepEqual(started,Array.from({length:slots},(_,index)=>index));
        assert.deepEqual(completed,[throwSlot]);
        assert.equal(finished,false);
        assert.deepEqual(reported,[]);assert.deepEqual(waits,[]);

        const held=throwSlot===0?slots-1:0;
        for(let index=0;index<slots;index++)if(index!==held)releases[index]!.release();
        await turn();
        assert.equal(completed.length,slots-1);
        assert.equal(finished,false,'the final claim still owns its slot');
        assert.equal(started.length,slots);
        assert.deepEqual(reported,[]);assert.deepEqual(waits,[]);

        releases[held]!.release();
        if(outcome!=='sync-report-failure'){
          await reach(reporting.pending);
          if(outcome==='shutdown')stop.abort();
          await turn();
          assert.equal(finished,false,'the pending report must finish before returning');
          assert.equal(started.length,slots,'the pending report must prevent new claims');
          assert.deepEqual(waits,[],'the pending report must prevent retry waiting');
          reportDone.release();
          if(outcome==='retry'){
            await reach(retrying.pending);await turn();
            assert.equal(finished,false);
            assert.equal(started.length,slots,'the retry delay must finish before refilling');
            assert.deepEqual(waits,[10]);retryDone.release();
          }
        }
        const result=await running;
        if(outcome==='sync-report-failure'){
          assert.ok('error' in result);assert.equal(result.error,reportFailure);
        }else assert.deepEqual(result,{ok:true});
        assert.equal(started.length,outcome==='retry'?slots*2:slots);
        assert.equal(completed.length,slots);assert.equal(new Set(completed).size,slots);
        assert.deepEqual(reported,[failure]);
        assert.deepEqual(waits,outcome==='retry'?[10]:[]);
        assert.deepEqual(schedules,[0]);
      }finally{
        stop.abort();for(const release of releases)release.release();reportDone.release();retryDone.release();await running;
      }
    });
  }
}
