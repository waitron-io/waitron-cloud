import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void,reject!:(error:unknown)=>void;
  const pending=new Promise<void>((yes,no)=>{release=yes;reject=no;});
  return {pending,release,reject};
}

for(const slots of [2,32])for(const phase of ['schedule','poll'] as const){
  for(const outcome of ['recover','report-fails'] as const){
    test(`${slots}-slot immediate ${phase} refusal awaits a live reporter before ${outcome}`,{timeout:3000},async()=>{
      const stop=new AbortController(),reportEntered=gate(),reportDone=gate(),retryEntered=gate(),retryDone=gate();
      const failure=new Error(`${phase} refused immediately`),reportFailure=new Error('report refused later');
      const reports:unknown[]=[],waits:number[]=[],schedules:number[]=[];
      let now=0,claims=0,finished=false;
      const previousClaims=phase==='schedule'?0:slots;
      const running=runWorkerLoop({
        signal:stop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
        schedule(){
          schedules.push(now);
          assert.ok(schedules.length<3,'reporting must not lose the scheduling deadline');
          if(phase==='schedule'&&schedules.length===1)throw failure;
          return Promise.resolve();
        },
        async runOnce(signal){
          assert.equal(signal,stop.signal);
          claims++;
          assert.ok(claims<=previousClaims+slots,'recovery must not start another batch');
          if(claims===previousClaims+slots)stop.abort();
          return false;
        },
        wait(milliseconds,signal){
          assert.equal(signal,stop.signal);assert.equal(signal.aborted,false);
          assert.equal(milliseconds,10);
          waits.push(milliseconds);
          if(phase==='poll'&&waits.length===1)throw failure;
          assert.equal(waits.length,phase==='poll'?2:1,'only one retry delay may start');
          retryEntered.release();
          return retryDone.pending.then(()=>{now+=milliseconds;});
        },
        async onError(error){
          reports.push(error);assert.equal(error,failure);assert.equal(reports.length,1);
          reportEntered.release();await reportDone.pending;
        },
      }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{finished=true;});
      const reach=async(pending:Promise<void>)=>Promise.race([pending,running.then(result=>{
        if('error' in result)throw result.error;
        assert.fail('worker returned before reaching the pending operation');
      })]);
      try{
        await reach(reportEntered.pending);await turn();
        assert.equal(stop.signal.aborted,false,'reporting must be qualified before cancellation');
        assert.equal(finished,false,'the live worker must await its reporter');
        assert.equal(claims,previousClaims,'pending reporting must prevent claims');
        assert.deepEqual(waits,phase==='poll'?[10]:[],'pending reporting must prevent retry waiting');
        assert.deepEqual(schedules,[0]);assert.deepEqual(reports,[failure]);
        if(outcome==='report-fails'){
          reportDone.reject(reportFailure);
          await turn();
          assert.equal(finished,true,'reporter rejection must terminate the live worker');
          const result=await running;
          assert.ok('error' in result);assert.equal(result.error,reportFailure);
          assert.equal(stop.signal.aborted,false,'reporter rejection must terminate without cancellation');
          assert.equal(claims,previousClaims);
          assert.deepEqual(waits,phase==='poll'?[10]:[]);
          assert.deepEqual(schedules,[0]);
        }else{
          reportDone.release();await reach(retryEntered.pending);await turn();
          assert.equal(finished,false,'the retry delay must finish before claims resume');
          assert.equal(claims,previousClaims);assert.deepEqual(schedules,[0]);
          assert.deepEqual(waits,phase==='poll'?[10,10]:[10]);
          retryDone.release();
          assert.deepEqual(await running,{ok:true});
          assert.equal(claims,previousClaims+slots);
          assert.deepEqual(schedules,phase==='schedule'?[0,10]:[0]);
        }
        assert.equal(finished,true);assert.deepEqual(reports,[failure]);
      }finally{
        stop.abort();reportDone.release();retryDone.release();await running;
      }
    });
  }
}

for(const phase of ['schedule','poll'] as const){
  test(`an immediate ${phase} refusal without a reporter preserves its error before cancellation`,{timeout:3000},async()=>{
    const stop=new AbortController(),failure=new Error(`${phase} refused immediately`);
    let claims=0,schedules=0,waits=0;
    try{
      await assert.rejects(runWorkerLoop({
        signal:stop.signal,concurrency:2,scheduleIntervalMs:60,pollIntervalMs:10,
        schedule(){schedules++;if(phase==='schedule')throw failure;return Promise.resolve();},
        async runOnce(){claims++;assert.ok(claims<=2);return false;},
        wait(){waits++;throw failure;},
      }),error=>error===failure);
      assert.equal(stop.signal.aborted,false);
      assert.equal(schedules,1);assert.equal(claims,phase==='schedule'?0:2);assert.equal(waits,phase==='schedule'?0:1);
    }finally{stop.abort();}
  });
}
