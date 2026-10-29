import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

// Cancellation ends intake; active claims and their error report still own cleanup.
for(const slots of [2,32])for(const outcome of ['success','unreported','reported','report-fails'] as const){
  test(`${slots} cancellation-aware claims finish cleanup before ${outcome} shutdown`,{timeout:3000},async()=>{
    const stop=new AbortController(),entered=gate(),cleanup=gate(),reporting=gate(),reportDone=gate();
    const reason=new Error('worker shutdown requested'),reportFailure=new Error('shutdown report refused');
    const started:number[]=[],cancelled:number[]=[],completed:number[]=[],reports:unknown[]=[],schedules:number[]=[];
    let now=0,finished=false,waits=0;
    const running=runWorkerLoop({
      signal:stop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
      async schedule(){schedules.push(now);},
      async runOnce(signal){
        assert.equal(signal,stop.signal,'every active claim receives the caller cancellation signal');
        assert.equal(signal.aborted,false,'shutdown must not start another claim');
        const index=started.length;started.push(index);
        assert.ok(index<slots,'shutdown must not refill active slots');
        const aborted=new Promise<void>(resolve=>signal.addEventListener('abort',()=>{
          assert.equal(signal.reason,reason);cancelled.push(index);resolve();
        },{once:true}));
        if(started.length===slots)entered.release();
        await aborted;
        if(index===slots-1)await cleanup.pending;
        completed.push(index);
        if(index===0&&outcome!=='success')throw signal.reason;
        return false;
      },
      onError:outcome==='reported'||outcome==='report-fails'?async error=>{
        reports.push(error);
        assert.equal(error,reason,'retain the original cancellation rejection');
        assert.equal(completed.length,slots,'all claims must finish cleanup before reporting');
        reporting.release();await reportDone.pending;
        if(outcome==='report-fails')throw reportFailure;
      }:undefined,
      async wait(){waits++;assert.fail('shutdown must not poll or retry');},
    }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{finished=true;});
    const reach=async(pending:Promise<void>)=>Promise.race([pending,running.then(result=>{
      if('error' in result)throw result.error;
      assert.fail('worker returned before its active operation finished');
    })]);
    try{
      await reach(entered.pending);
      assert.equal(started.length,slots);
      now=100;stop.abort(reason);
      await turn();
      assert.deepEqual(cancelled,Array.from({length:slots},(_,index)=>index));
      assert.deepEqual(completed,Array.from({length:slots-1},(_,index)=>index));
      assert.equal(finished,false,'shutdown must await the last claim cleanup');
      assert.deepEqual(reports,[],'a rejected claim must not bypass another claim cleanup');
      assert.equal(started.length,slots);assert.equal(waits,0);assert.deepEqual(schedules,[0]);

      cleanup.release();
      if(outcome==='reported'||outcome==='report-fails'){
        await reach(reporting.pending);await turn();
        assert.equal(finished,false,'shutdown must await the cancellation error report');
        assert.deepEqual(reports,[reason]);
        assert.equal(started.length,slots);assert.equal(waits,0);assert.deepEqual(schedules,[0]);
        reportDone.release();
      }
      const result=await running;
      if(outcome==='unreported'||outcome==='report-fails'){
        assert.ok('error' in result);assert.equal(result.error,outcome==='unreported'?reason:reportFailure);
      }else assert.deepEqual(result,{ok:true});
      assert.equal(finished,true);
      assert.deepEqual(completed,Array.from({length:slots},(_,index)=>index));
      assert.equal(started.length,slots);assert.equal(waits,0);assert.deepEqual(schedules,[0]);
      assert.deepEqual(reports,outcome==='reported'||outcome==='report-fails'?[reason]:[]);
    }finally{
      stop.abort(reason);cleanup.release();reportDone.release();await running;
    }
  });
}
