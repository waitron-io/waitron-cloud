import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

// One busy claim keeps work moving, but every active claim still owns its slot.
for(const slots of [2,32])for(const busyFirst of [true,false]){
  test(`${slots} mixed claims finish the busy claim ${busyFirst?'first':'last'} before refilling a complete batch`,{timeout:3000},async()=>{
    const stop=new AbortController(),firstEntered=gate(),secondEntered=gate();
    const releases=Array.from({length:slots*2},gate);
    const busySlot=busyFirst?0:slots-1;
    let started=0,active=0,maximum=0,finished=false;
    const completed:number[]=[],waits:number[]=[];
    const running=runWorkerLoop({
      signal:stop.signal,concurrency:slots,scheduleIntervalMs:60000,pollIntervalMs:60000,
      runOnce:async signal=>{
        assert.equal(signal,stop.signal);
        const index=started++;
        assert.ok(index<slots*2,'worker refilled after shutdown');
        active++;maximum=Math.max(maximum,active);
        if(started===slots)firstEntered.release();
        if(started===slots*2)secondEntered.release();
        await releases[index]!.pending;
        active--;completed.push(index);
        return index%slots===busySlot;
      },
      async wait(milliseconds){waits.push(milliseconds);assert.fail('one busy claim must prevent an idle polling delay');},
    }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{finished=true;});
    const entered=async(pending:Promise<void>)=>Promise.race([pending,running.then(result=>{
      if('error' in result)throw result.error;
      assert.fail('worker returned before the expected batch started');
    })]);
    try{
      await entered(firstEntered.pending);
      assert.equal(active,slots);
      releases[0]!.release();
      await turn();
      assert.deepEqual(completed,[0]);
      assert.equal(started,slots,'a partial batch must not refill claims');
      assert.equal(finished,false);
      assert.deepEqual(waits,[]);

      for(let index=1;index<slots;index++)releases[index]!.release();
      await entered(secondEntered.pending);
      assert.equal(started,slots*2);
      assert.deepEqual(completed,Array.from({length:slots},(_,index)=>index));
      assert.equal(active,slots);
      assert.equal(maximum,slots,'new claims must not exceed the configured active slots');
      assert.deepEqual(waits,[]);

      stop.abort();
      for(let index=slots;index<slots*2-1;index++)releases[index]!.release();
      await turn();
      assert.equal(finished,false,'shutdown must await every active claim');
      assert.equal(active,1);
      assert.equal(started,slots*2);
    }finally{
      stop.abort();for(const release of releases)release.release();
      const result=await running;
      if('error' in result)throw result.error;
    }
    assert.equal(finished,true);
    assert.equal(active,0);
    assert.equal(started,slots*2);
    assert.deepEqual(completed,Array.from({length:slots*2},(_,index)=>index));
    assert.deepEqual(waits,[]);
  });
}
