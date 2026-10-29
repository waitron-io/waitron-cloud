import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

const invalidSettings = [
  ...[0,-1,1.5,33,NaN,Infinity,-Infinity].map(value=>({field:'concurrency' as const,value})),
  ...['scheduleIntervalMs','pollIntervalMs'].flatMap(field=>
    [0,-1,0.5,NaN,Infinity,-Infinity].map(value=>({field,value}))),
];

for(const {field,value} of invalidSettings){
  for(const aborted of [false,true]){
    test(`worker rejects ${field}=${value} before callbacks with startup ${aborted?'aborted':'active'}`,async()=>{
      const stop=new AbortController();
      if(aborted)stop.abort();
      const callbacks:string[]=[];
      await assert.rejects(runWorkerLoop({
        signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,
        [field]:value,
        now(){callbacks.push('clock');return 0;},
        async schedule(){callbacks.push('schedule');stop.abort();},
        async runOnce(){callbacks.push('claim');stop.abort();return false;},
        async wait(){callbacks.push('wait');stop.abort();},
        onError(){callbacks.push('report');stop.abort();},
      }),{message:'invalid_worker_loop_config'});
      assert.deepEqual(callbacks,[],'invalid settings must refuse before work or error recovery starts');
    });
  }
}

for(const concurrency of [1,32]){
  test(`worker accepts minimum timer intervals and finishes exactly ${concurrency} active claims`,async()=>{
    const stop=new AbortController();
    let schedules=0,claims=0;
    const signals:AbortSignal[]=[];
    await runWorkerLoop({
      signal:stop.signal,concurrency,scheduleIntervalMs:1,pollIntervalMs:1,
      now:()=>0,
      async schedule(){schedules++;},
      async runOnce(signal){
        claims++;signals.push(signal);
        if(claims===concurrency)stop.abort();
        return true;
      },
      async wait(){assert.fail('the final active batch finishes without polling after shutdown');},
      onError(error){assert.fail(`valid settings must not enter error recovery: ${String(error)}`);},
    });
    assert.equal(schedules,1);
    assert.equal(claims,concurrency);
    assert.deepEqual(signals,Array<AbortSignal>(concurrency).fill(stop.signal));
  });
}

test('an already stopped valid worker starts no callbacks',async()=>{
  const stop=new AbortController();stop.abort();
  await runWorkerLoop({
    signal:stop.signal,concurrency:32,scheduleIntervalMs:1,pollIntervalMs:1,
    now(){assert.fail('a stopped worker does not read the clock');},
    async schedule(){assert.fail('a stopped worker does not schedule');},
    async runOnce(){assert.fail('a stopped worker does not claim');},
    async wait(){assert.fail('a stopped worker does not wait');},
    onError(){assert.fail('a stopped worker does not report an error');},
  });
});
