import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

for(const slots of [2,32])for(const earlyFailure of [0,slots-1]){
  for(const outcome of ['retry','shutdown','unhandled','report-failure'] as const){
    test(`${slots} claims with failure ${earlyFailure} first await both failures before ${outcome}`,{timeout:3000},async()=>{
      const stop=new AbortController(),entered=gate(),reporting=gate(),reportDone=gate();
      const releases=Array.from({length:slots},gate);
      const failures=[new Error('first claim refused'),new Error('last claim refused')];
      const reportFailure=new Error('error reporting refused');
      const completed:number[]=[],reported:unknown[]=[],waits:number[]=[],schedules:number[]=[];
      let claims=0,now=0,finished=false;
      const lateFailure=earlyFailure===0?slots-1:0;
      const running=runWorkerLoop({
        signal:stop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
        async schedule(){schedules.push(now);assert.equal(schedules.length,1);},
        async runOnce(signal){
          assert.equal(signal,stop.signal);
          const index=claims++;
          assert.ok(index<slots*2,'a failed batch must not refill twice');
          if(index>=slots){
            if(claims===slots*2)stop.abort();
            return false;
          }
          if(claims===slots)entered.release();
          await releases[index]!.pending;
          completed.push(index);
          if(index===0)throw failures[0];
          if(index===slots-1)throw failures[1];
          return index%2===0;
        },
        onError:outcome==='unhandled'?undefined:async error=>{
          reported.push(error);
          assert.equal(reported.length,1,'one failed batch gets one report');
          assert.ok(failures.includes(error as Error),'report an original claim error');
          assert.equal(completed.length,slots,'all claims must finish before reporting');
          reporting.release();
          await reportDone.pending;
          if(outcome==='report-failure')throw reportFailure;
        },
        async wait(milliseconds,signal){
          assert.equal(outcome,'retry','only a completed report may admit retry waiting');
          assert.equal(signal,stop.signal);
          assert.equal(completed.length,slots);
          assert.equal(reported.length,1);
          waits.push(milliseconds);assert.equal(waits.length,1);
          now+=milliseconds;
        },
      }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{finished=true;});
      const reach=async(pending:Promise<void>)=>Promise.race([pending,running.then(result=>{
        if('error' in result)throw result.error;
        assert.fail('worker returned before its active work finished');
      })]);
      try{
        await reach(entered.pending);
        releases[earlyFailure]!.release();
        await turn();
        assert.deepEqual(completed,[earlyFailure]);
        assert.equal(finished,false,'the other failure is still pending');
        assert.deepEqual(reported,[]);
        assert.deepEqual(waits,[]);
        assert.equal(claims,slots);

        for(let index=1;index<slots-1;index++)releases[index]!.release();
        await turn();
        assert.equal(completed.length,slots-1);
        assert.equal(finished,false,'the final failing claim still owns its slot');
        assert.deepEqual(reported,[]);
        assert.deepEqual(waits,[]);
        assert.equal(claims,slots);

        releases[lateFailure]!.release();
        if(outcome!=='unhandled'){
          await reach(reporting.pending);
          if(outcome==='shutdown')stop.abort();
          await turn();
          assert.equal(finished,false,'a pending reporter must finish even during shutdown');
          assert.equal(claims,slots,'a pending reporter must prevent refilling');
          assert.deepEqual(waits,[],'a pending reporter must prevent retry waiting');
          assert.equal(reported.length,1);
          reportDone.release();
        }
        const result=await running;
        assert.equal(completed.length,slots);
        assert.equal(new Set(completed).size,slots);
        assert.deepEqual(schedules,[0]);
        if(outcome==='unhandled'){
          assert.ok('error' in result);
          assert.ok(failures.includes(result.error as Error),'propagate an original claim error');
          assert.deepEqual(reported,[]);
        }else if(outcome==='report-failure'){
          assert.ok('error' in result);
          assert.equal(result.error,reportFailure);
        }else assert.deepEqual(result,{ok:true});
        assert.equal(claims,outcome==='retry'?slots*2:slots);
        assert.deepEqual(waits,outcome==='retry'?[10]:[]);
      }finally{
        stop.abort();for(const release of releases)release.release();reportDone.release();await running;
      }
    });
  }
}
