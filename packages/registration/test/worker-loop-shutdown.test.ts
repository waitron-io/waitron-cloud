import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {setImmediate as turn} from 'node:timers/promises';
import {promisify} from 'node:util';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

const execute=promisify(execFile);

for(const failure of [false,true]){
  test(`shutdown releases the real ${failure?'error-retry':'idle polling'} timer and lets the process exit`,async()=>{
    const source=`
      import assert from 'node:assert/strict';
      import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
      const stop=new AbortController();
      const failure=new Error('claim refused');
      let claims=0,reports=0,finished=false;
      const shutdown=()=>setImmediate(()=>{
        assert.equal(finished,false,'the worker must still be waiting before shutdown');
        stop.abort();
      });
      const running=runWorkerLoop({
        signal:stop.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:60000,
        async runOnce(){
          claims++;
          if(${failure})throw failure;
          shutdown();return false;
        },
        async onError(error){assert.equal(error,failure);reports++;shutdown();},
      });
      await running;finished=true;
      console.log(JSON.stringify({claims,reports}));
    `;
    const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
    assert.equal(stderr,'');
    assert.deepEqual(JSON.parse(stdout),{claims:1,reports:failure?1:0});
  });
}

for(const phase of ['schedule','claim'] as const){
  test(`shutdown waits for a pending ${phase} error report without starting further work`,{timeout:2000},async()=>{
    const stop=new AbortController();
    const failure=new Error(`${phase} refused`);
    let entered!:()=>void,release!:()=>void,finished=false;
    const reporting=new Promise<void>(resolve=>{entered=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const events:string[]=[];
    const running=runWorkerLoop({
      signal:stop.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:60000,
      schedule:phase==='schedule'?async()=>{events.push('schedule');throw failure;}:undefined,
      async runOnce(){events.push('claim');throw failure;},
      async onError(error){
        assert.equal(error,failure);
        events.push('report-enter');entered();
        await gate;events.push('report-exit');
      },
      async wait(){events.push('wait');},
    }).finally(()=>{finished=true;});
    try{
      await reporting;
      stop.abort();
      await turn();
      assert.equal(finished,false,'the error reporter still owns unfinished work');
      assert.deepEqual(events,[phase,'report-enter']);
    }finally{
      stop.abort();release();await running;
    }
    assert.equal(finished,true);
    assert.deepEqual(events,[phase,'report-enter','report-exit']);
  });
}
