import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {runWorkerLoop} from '../src/worker-loop.ts';

const execute=promisify(execFile);

for(const pollIntervalMs of [2147483648,Number.MAX_SAFE_INTEGER]){
  for(const aborted of [false,true]){
    test(`worker rejects overflowing poll interval ${pollIntervalMs} with startup ${aborted?'aborted':'active'}`,async()=>{
      const stop=new AbortController();
      if(aborted)stop.abort();
      const callbacks:string[]=[];
      await assert.rejects(runWorkerLoop({
        signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs,
        now(){callbacks.push('clock');return 0;},
        async schedule(){callbacks.push('schedule');stop.abort();},
        async runOnce(){callbacks.push('claim');stop.abort();return false;},
        async wait(){callbacks.push('wait');stop.abort();},
        onError(){callbacks.push('report');stop.abort();},
      }),{message:'invalid_worker_loop_config'});
      assert.deepEqual(callbacks,[],'overflow must refuse before work or recovery starts');
    });
  }
}

test('the maximum native polling delay reaches the wait unchanged',async()=>{
  const stop=new AbortController();
  let claims=0;
  const waits:number[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:2147483647,
    async runOnce(){claims++;return false;},
    async wait(milliseconds,signal){
      assert.equal(signal,stop.signal);waits.push(milliseconds);stop.abort();
    },
  });
  assert.equal(claims,1);
  assert.deepEqual(waits,[2147483647]);
});

test('a scheduling cadence above the native timer limit retains bounded polling',async()=>{
  const stop=new AbortController();
  let schedules=0,claims=0;
  const waits:number[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:2147483648,pollIntervalMs:10,
    now:()=>0,
    async schedule(){schedules++;},
    async runOnce(){claims++;return false;},
    async wait(milliseconds){waits.push(milliseconds);stop.abort();},
  });
  assert.equal(schedules,1);
  assert.equal(claims,1);
  assert.deepEqual(waits,[10]);
});

for(const failure of [false,true]){
  test(`shutdown interrupts the maximum native ${failure?'retry':'idle'} delay without overflow`,async()=>{
    const source=`
      import assert from 'node:assert/strict';
      import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
      const stop=new AbortController(),failure=new Error('claim refused');
      let claims=0,reports=0,finished=false;
      const shutdown=()=>setImmediate(()=>{assert.equal(finished,false);stop.abort();});
      await runWorkerLoop({
        signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:2147483647,
        async runOnce(){claims++;if(${failure})throw failure;shutdown();return false;},
        onError(error){assert.equal(error,failure);reports++;shutdown();},
      });
      finished=true;
      console.log(JSON.stringify({claims,reports}));
    `;
    const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
    assert.equal(stderr,'');
    assert.deepEqual(JSON.parse(stdout),{claims:1,reports:failure?1:0});
  });
}
