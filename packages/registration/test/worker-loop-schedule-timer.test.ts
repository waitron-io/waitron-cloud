import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

for(const slots of [2,32])for(const phase of ['startup','recurring']){
  test(`${slots}-slot ${phase} schedule refusal enters a real retry timer before shutdown`,async()=>{
    const source=`
      import assert from 'node:assert/strict';
      import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
      const stop=new AbortController(),failure=new Error('schedule refused');
      const events=[];
      let schedules=0,claims=0,reports=0,finished=false;
      try {
        await runWorkerLoop({
          signal:stop.signal,concurrency:${slots},scheduleIntervalMs:10,pollIntervalMs:60000,
          now:()=>claims===0?0:10,
          async schedule(){
            schedules++;
            events.push('schedule');
            if(${JSON.stringify(phase)}==='startup'||schedules===2)throw failure;
            assert.equal(schedules,1,'no schedule may retry before the real timer finishes');
          },
          async runOnce(signal){
            assert.equal(signal,stop.signal);
            claims++;
            assert.ok(claims<=${slots},'a failed recurring schedule must not admit another batch');
            return true;
          },
          onError(error){
            assert.equal(error,failure,'the original scheduling failure must reach reporting');
            reports++;
            assert.equal(reports,1,'a scheduling failure must wait before retrying');
            events.push('report');
            setImmediate(()=>{
              assert.equal(finished,false,'the native retry timer must retain the worker until shutdown');
              assert.equal(claims,${phase==='startup'?0:slots},'no extra claims may start before shutdown');
              events.push('shutdown');
              stop.abort();
            });
          },
        });
        finished=true;
        events.push('finished');
      } finally {stop.abort();}
      console.log(JSON.stringify({schedules,claims,reports,events}));
    `;
    const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000})
      .catch((error:unknown)=>{
        if(error&&typeof error==='object'&&'killed' in error&&error.killed){
          assert.fail('shutdown must release the native retry timer and let its process exit');
        }
        throw error;
      });
    assert.equal(stderr,'');
    assert.deepEqual(JSON.parse(stdout),{
      schedules:phase==='startup'?1:2,
      claims:phase==='startup'?0:slots,
      reports:1,
      events:phase==='startup'
        ?['schedule','report','shutdown','finished']
        :['schedule','schedule','report','shutdown','finished'],
    });
  });
}
