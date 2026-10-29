import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

test('failed schedules retry after the polling delay before any claims start',{timeout:2000},async()=>{
  const stop=new AbortController(),failure=new Error('schedule unavailable');
  let now=0;
  const schedules:number[]=[],claims:number[]=[],waits:number[]=[],reports:unknown[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
    async schedule(){schedules.push(now);if(schedules.length<=2)throw failure;},
    async runOnce(){claims.push(now);if(claims.length===3)stop.abort();return false;},
    async onError(error){reports.push(error);},
    async wait(milliseconds){
      waits.push(milliseconds);now+=milliseconds;
      assert.ok(waits.length<=5,'a successful schedule must allow claims to resume');
    },
  });
  assert.deepEqual(schedules,[0,10,20]);
  assert.deepEqual(claims,[20,30,40]);
  assert.deepEqual(waits,[10,10,10,10]);
  assert.deepEqual(reports,[failure,failure]);
});

test('busy claims still run scheduling on its cadence without idle waits',{timeout:2000},async()=>{
  const stop=new AbortController();let now=0,claims=0;
  const schedules:number[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:20,pollIntervalMs:10,now:()=>now,
    async schedule(){schedules.push(now);},
    async runOnce(){claims++;now+=7;if(claims===8)stop.abort();return true;},
    async wait(){assert.fail('busy claims must not incur an idle wait');},
  });
  assert.equal(claims,8);
  assert.deepEqual(schedules,[0,21,42]);
});

test('claim errors reach the reporter only after every active claim settles',{timeout:2000},async()=>{
  const stop=new AbortController(),failure=new Error('claim refused');
  let entered!:()=>void,release!:()=>void,claims=0,finished=false;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const events:string[]=[];
  const running=runWorkerLoop({
    signal:stop.signal,concurrency:2,scheduleIntervalMs:60,pollIntervalMs:10,
    async runOnce(){
      claims++;
      if(claims===1){events.push('claim-failure');throw failure;}
      events.push('claim-enter');entered();
      await gate;events.push('claim-exit');return true;
    },
    async onError(error){assert.equal(error,failure);events.push('report');stop.abort();},
    async wait(){assert.fail('shutdown must not start a retry wait');},
  }).finally(()=>{finished=true;});
  try{
    await started;await turn();
    assert.equal(finished,false);
    assert.deepEqual(events,['claim-failure','claim-enter']);
  }finally{
    stop.abort();release();await running;
  }
  assert.equal(claims,2);
  assert.equal(finished,true);
  assert.deepEqual(events,['claim-failure','claim-enter','claim-exit','report']);
});

for(const phase of ['schedule','claim'] as const){
  test(`a rejected ${phase} error report propagates without retrying work`,{timeout:2000},async()=>{
    const stop=new AbortController(),failure=new Error(`${phase} refused`),reportFailure=new Error('report refused');
    let claims=0,reports=0;
    const events:string[]=[];
    const running=runWorkerLoop({
      signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,
      schedule:phase==='schedule'?async()=>{events.push('schedule');throw failure;}:undefined,
      async runOnce(){claims++;events.push('claim');throw failure;},
      async onError(error){
        assert.equal(error,failure);reports++;events.push('report');
        stop.abort();throw reportFailure;
      },
      async wait(){assert.fail('a rejected reporter must terminate the worker');},
    });
    await assert.rejects(running,error=>error===reportFailure);
    assert.equal(claims,phase==='claim'?1:0);
    assert.equal(reports,1);
    assert.deepEqual(events,[phase,'report']);
  });
}
