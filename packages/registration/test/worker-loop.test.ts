import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

test('schedules at startup and on its cadence while idle polling continues',async()=>{
  const stop=new AbortController();let now=0,claims=0;
  const schedules:number[]=[],waits:number[]=[];
  await runWorkerLoop({
    signal:stop.signal,concurrency:1,scheduleIntervalMs:60,pollIntervalMs:10,
    now:()=>now,
    async schedule(){schedules.push(now);},
    async runOnce(){claims++;return false;},
    async wait(ms){waits.push(ms);now+=ms;if(now>=70)stop.abort();},
  });
  assert.deepEqual(schedules,[0,60]);
  assert.equal(claims,7);
  assert.deepEqual(waits,[10,10,10,10,10,10,10]);
});

test('bounds concurrent claims and finishes the active batch without claiming after shutdown',async()=>{
  const stop=new AbortController();let active=0,maximumActive=0,started=0,finished=0;
  let release!:()=>void,allStarted!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const entered=new Promise<void>(resolve=>{allStarted=resolve;});
  const running=runWorkerLoop({
    signal:stop.signal,concurrency:4,scheduleIntervalMs:60,pollIntervalMs:10,
    async runOnce(){
      started++;active++;maximumActive=Math.max(maximumActive,active);if(started===4)allStarted();
      await gate;active--;finished++;return true;
    },
    async wait(){throw new Error('busy work must not idle');},
  });
  await entered;stop.abort();release();await running;
  assert.equal(maximumActive,4);
  assert.equal(started,4);
  assert.equal(finished,4);
});

test('propagates a claim failure only after the rest of its active batch settles',async()=>{
  const stop=new AbortController();let settled=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});let claim=0;
  const running=runWorkerLoop({
    signal:stop.signal,concurrency:2,scheduleIntervalMs:60,pollIntervalMs:10,
    async runOnce(){claim++;if(claim===1)throw new Error('claim failed');await gate;settled=true;return true;},
    async wait(){throw new Error('failed work must not idle');},
  });
  await new Promise(resolve=>setImmediate(resolve));
  let rejected=false;void running.catch(()=>{rejected=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(rejected,false);
  release();await assert.rejects(running,/claim failed/);assert.equal(settled,true);
});
