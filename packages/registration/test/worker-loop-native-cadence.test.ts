import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

for(const slots of [2,32])for(const polling of ['single','several']){
  test(`${slots}-slot native ${polling} polling meets the completed schedule deadline`,async()=>{
    const source=`
      import assert from 'node:assert/strict';
      import {createHook} from 'node:async_hooks';
      import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
      const stop=new AbortController(),timers=new Map();
      const schedules=[],claims=[],waits=[],fired=[];
      let now=0,completed=0;
      // Logical time advances only when the real native timer fires. This keeps
      // cadence checks independent of how long a busy machine delays callbacks.
      const hook=createHook({
        init(id,type,trigger,resource){
          if(type!=='Timeout')return;
          timers.set(id,resource._idleTimeout);
          waits.push({milliseconds:resource._idleTimeout,now,completed});
        },
        before(id){
          if(!timers.has(id))return;
          const milliseconds=timers.get(id);
          now+=milliseconds;fired.push(milliseconds);
        },
        destroy(id){timers.delete(id);},
      });
      hook.enable();
      try {
        await runWorkerLoop({
          signal:stop.signal,concurrency:${slots},scheduleIntervalMs:25,
          pollIntervalMs:${polling==='single'?100:10},now:()=>now,
          async schedule(){
            schedules.push(now);
            assert.ok(schedules.length<=2,'shutdown must prevent further scheduling');
            assert.equal(completed,claims.length,'scheduling must await the whole claim batch');
            now+=50;
            if(schedules.length===2)stop.abort();
          },
          async runOnce(signal){
            assert.equal(signal,stop.signal);
            assert.equal(signal.aborted,false,'shutdown must prevent another claim batch');
            claims.push(now);
            assert.ok(claims.length<=${slots*(polling==='single'?1:3)},'polling must not admit a premature batch');
            await Promise.resolve();
            completed++;
            return false;
          },
        });
      } finally {hook.disable();stop.abort();}
      console.log(JSON.stringify({schedules,claims,waits,fired,completed}));
    `;
    const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
    assert.equal(stderr,'');
    assert.deepEqual(JSON.parse(stdout),{
      schedules:[0,75],
      claims:polling==='single'?Array(slots).fill(50):[...Array(slots).fill(50),...Array(slots).fill(60),...Array(slots).fill(70)],
      waits:polling==='single'
        ?[{milliseconds:25,now:50,completed:slots}]
        :[{milliseconds:10,now:50,completed:slots},{milliseconds:10,now:60,completed:slots*2},{milliseconds:5,now:70,completed:slots*3}],
      fired:polling==='single'?[25]:[10,10,5],
      completed:slots*(polling==='single'?1:3),
    });
  });
}
