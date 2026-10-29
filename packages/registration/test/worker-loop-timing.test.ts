import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

test('the next schedule is due one interval after scheduling completes',{timeout:2000},async()=>{
  const stop=new AbortController();let now=0;
  const schedules:number[]=[],claims:number[]=[],waits:number[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:100,now:()=>now,
    async schedule(){schedules.push(now);now+=50;if(schedules.length===2)stop.abort();},
    async runOnce(){claims.push(now);return false;},
    async wait(milliseconds){waits.push(milliseconds);now+=milliseconds;},
  });
  assert.deepEqual(schedules,[0,110]);
  assert.deepEqual(claims,[50]);
  assert.deepEqual(waits,[60]);
});

test('idle polling shortens its final wait to meet the scheduling deadline',{timeout:2000},async()=>{
  const stop=new AbortController();let now=0;
  const schedules:number[]=[],claims:number[]=[],waits:number[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:25,pollIntervalMs:10,now:()=>now,
    async schedule(){schedules.push(now);if(schedules.length===2)stop.abort();},
    async runOnce(){claims.push(now);return false;},
    async wait(milliseconds){waits.push(milliseconds);now+=milliseconds;},
  });
  assert.deepEqual(schedules,[0,25]);
  assert.deepEqual(claims,[0,10,20]);
  assert.deepEqual(waits,[10,10,5]);
});

test('an idle wait failure is reported before a polling delay resumes claims',{timeout:2000},async()=>{
  const stop=new AbortController(),failure=new Error('polling timer refused');
  let waits=0,now=0;
  const events:string[]=[],claims:number[]=[],reports:unknown[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
    async schedule(){events.push('schedule');},
    async runOnce(){
      events.push('claim');claims.push(now);
      if(claims.length===2)stop.abort();return false;
    },
    async wait(milliseconds,signal){
      assert.equal(signal,stop.signal);assert.equal(milliseconds,10);
      events.push('wait');waits++;
      if(waits===1)throw failure;
      now+=milliseconds;
      assert.ok(waits<=2,'recovery must resume claims');
    },
    async onError(error){events.push('report');reports.push(error);},
  });
  assert.deepEqual(events,['schedule','claim','wait','report','wait','claim']);
  assert.deepEqual(claims,[0,10]);
  assert.deepEqual(reports,[failure]);
});

for(const phase of ['schedule','claim','idle wait'] as const){
  test(`a retry wait failure after a ${phase} failure terminates without repeated reporting`,{timeout:2000},async()=>{
    const stop=new AbortController(),failure=new Error(`${phase} refused`),retryFailure=new Error('retry timer refused');
    let claims=0,waits=0;
    const reports:unknown[]=[];
    const running=runWorkerLoop({
      signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,
      schedule:phase==='schedule'?async()=>{throw failure;}:undefined,
      async runOnce(){claims++;if(phase==='claim')throw failure;return false;},
      async wait(milliseconds,signal){
        assert.equal(signal,stop.signal);assert.equal(milliseconds,10);waits++;
        if(phase==='idle wait'&&waits===1)throw failure;
        throw retryFailure;
      },
      async onError(error){reports.push(error);assert.equal(reports.length,1);},
    });
    await assert.rejects(running,error=>error===retryFailure);
    assert.deepEqual(reports,[failure]);
    assert.equal(claims,phase==='schedule'?0:1);
    assert.equal(waits,phase==='idle wait'?2:1);
  });
}

test('an idle wait failure without a reporter preserves the original error',{timeout:2000},async()=>{
  const stop=new AbortController(),failure=new Error('polling timer refused');
  let claims=0,waits=0;
  const running=runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,
    async runOnce(){claims++;return false;},
    async wait(){waits++;throw failure;},
  });
  await assert.rejects(running,error=>error===failure);
  assert.equal(claims,1);
  assert.equal(waits,1);
});
