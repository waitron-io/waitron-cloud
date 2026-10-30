import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

for(const slots of [2,32])for(const phase of ['idle','claim','startup','recurring']){
  test(`${slots}-slot ${phase} worker resumes after its native timer expires`,async()=>{
    const source=`
      import assert from 'node:assert/strict';
      import {createHook} from 'node:async_hooks';
      import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
      const stop=new AbortController(),failure=new Error('worker refused');
      const phase=${JSON.stringify(phase)},slots=${slots};
      const timers=new Set();
      let created=0,fired=0,claims=0,schedules=0,reports=0,now=0;
      const hook=createHook({
        init(id,type){if(type==='Timeout'){timers.add(id);created++;}},
        before(id){if(timers.has(id))fired++;},
        destroy(id){timers.delete(id);},
      });
      const hasSchedule=phase==='startup'||phase==='recurring';
      const expectedClaims=phase==='startup'?slots:slots*2;
      hook.enable();
      try {
        await runWorkerLoop({
          signal:stop.signal,concurrency:slots,scheduleIntervalMs:10,pollIntervalMs:40,
          now:()=>now,
          schedule:hasSchedule?async()=>{
            schedules++;
            const refused=phase==='startup'?1:2;
            assert.ok(schedules<=refused+1,'recovery must establish the next scheduling interval');
            if(schedules===refused)throw failure;
            if(schedules===refused+1){
              assert.equal(fired,1,'schedule recovery must follow native retry timer expiry');
              assert.equal(reports,1,'schedule recovery must report the original refusal once');
            }
          }:undefined,
          async runOnce(signal){
            assert.equal(signal,stop.signal);
            assert.equal(signal.aborted,false,'shutdown must not admit another batch');
            claims++;
            assert.ok(claims<=expectedClaims,'recovery must finish without extra claims');
            const recovered=phase==='startup'||claims>slots;
            assert.equal(fired,recovered?1:0,'claims must resume only after native timer expiry');
            if(recovered){
              assert.equal(created,1,'one native timer must carry the idle or retry wait');
              assert.equal(reports,phase==='idle'?0:1);
            }
            if(claims===expectedClaims)stop.abort();
            if(phase==='claim'&&claims<=slots)throw failure;
            if(phase==='recurring'&&claims===slots)now=10;
            return phase==='recurring';
          },
          onError(error){
            assert.equal(error,failure,'reporting must retain the original refusal');
            reports++;
            assert.equal(reports,1,'recovery must not repeat failure reporting');
            assert.equal(created,0,'reporting must precede retry timer creation');
            assert.equal(fired,0);
            assert.equal(claims,phase==='startup'?0:slots);
          },
        });
      } finally {hook.disable();stop.abort();}
      console.log(JSON.stringify({created,fired,claims,schedules,reports}));
    `;
    const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
    assert.equal(stderr,'');
    assert.deepEqual(JSON.parse(stdout),{
      created:1,fired:1,claims:phase==='startup'?slots:slots*2,
      schedules:phase==='startup'?2:phase==='recurring'?3:0,
      reports:phase==='idle'?0:1,
    });
  });
}
