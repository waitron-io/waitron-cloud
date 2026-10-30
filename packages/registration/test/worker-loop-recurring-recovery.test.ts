import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

for(const slots of [2,32])for(const busy of [true,false]){
  test(`${slots} ${busy?'busy':'idle'} claims recover a recurring schedule before starting its next interval`,{timeout:3000},async()=>{
    const stop=new AbortController(),reportEntered=gate(),reportDone=gate();
    const failure=new Error('recurring schedule refused');
    const schedules:number[]=[],claims:number[]=[],waits:number[]=[],reports:unknown[]=[];
    let now=0,started=0,finished=false;
    const running=runWorkerLoop({
      signal:stop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
      async schedule(){
        schedules.push(now);
        assert.ok(schedules.length<=4,'recovery must establish a new scheduling interval');
        if(schedules.length===1)now+=5;
        if(schedules.length===2){now+=7;throw failure;}
        if(schedules.length===3)now+=13;
        if(schedules.length===4)stop.abort();
      },
      async runOnce(signal){
        assert.equal(signal,stop.signal);
        const index=started++;
        assert.ok(index<slots*2,'recurring scheduling must run before another batch');
        claims.push(now);
        if(started===slots)now=65;
        if(started===slots*2)now+=busy?60:57;
        return busy;
      },
      async onError(error){
        reports.push(error);
        assert.equal(error,failure);
        assert.equal(reports.length,1);
        reportEntered.release();
        await reportDone.pending;
        now+=11;
      },
      async wait(milliseconds,signal){
        assert.equal(signal,stop.signal);
        waits.push(milliseconds);
        assert.ok(waits.length<=3,'recovery must reach the next schedule');
        now+=milliseconds;
      },
    }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{finished=true;});
    try{
      await Promise.race([reportEntered.pending,running.then(result=>{
        if('error' in result)throw result.error;
        assert.fail('worker returned before recurring failure reporting');
      })]);
      await turn();
      assert.equal(finished,false,'pending reporting must keep the worker active');
      assert.equal(started,slots,'pending reporting must prevent new claims');
      assert.deepEqual(schedules,busy?[0,65]:[0,66]);
      assert.deepEqual(waits,busy?[]:[1],'pending reporting must prevent retry waiting');
      reportDone.release();
      const result=await running;
      if('error' in result)throw result.error;
      assert.deepEqual(schedules,busy?[0,65,93,166]:[0,66,94,167]);
      assert.deepEqual(claims,[...Array<number>(slots).fill(5),...Array<number>(slots).fill(busy?106:107)]);
      assert.deepEqual(waits,busy?[10]:[1,10,3]);
      assert.deepEqual(reports,[failure]);
      assert.equal(started,slots*2);
      assert.equal(finished,true);
    }finally{
      stop.abort();reportDone.release();await running;
    }
  });
}
