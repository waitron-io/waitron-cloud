import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

for(const slots of [2,32])for(const phase of ['schedule','claim']){
  for(const outcome of ['retry','shutdown','report-refusal']){
    test(`${slots}-slot native ${phase} reporting waits before ${outcome}`,async()=>{
      const source=`
        import assert from 'node:assert/strict';
        import {createHook} from 'node:async_hooks';
        import {setImmediate as turn} from 'node:timers/promises';
        import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
        const stop=new AbortController(),failure=new Error('work refused'),reportFailure=new Error('report refused');
        const timers=new Set();
        let created=0,fired=0,claims=0,schedules=0,reports=0,finished=false;
        let enterReport,releaseReport,enterTimer;
        const reporting=new Promise(resolve=>{enterReport=resolve;});
        const reportGate=new Promise(resolve=>{releaseReport=resolve;});
        const timerEntered=new Promise(resolve=>{enterTimer=resolve;});
        const hook=createHook({
          init(id,type){if(type==='Timeout'){timers.add(id);created++;enterTimer();}},
          before(id){if(timers.has(id))fired++;},
          destroy(id){timers.delete(id);},
        });
        const phase=${JSON.stringify(phase)},outcome=${JSON.stringify(outcome)},slots=${slots};
        hook.enable();
        const running=runWorkerLoop({
          signal:stop.signal,concurrency:slots,scheduleIntervalMs:60000,pollIntervalMs:40,
          schedule:phase==='schedule'?async()=>{
            schedules++;
            if(schedules===1)throw failure;
            assert.equal(schedules,2,'recovery must schedule only once');
            assert.equal(fired,1,'scheduling recovery must follow native timer expiry');
          }:undefined,
          async runOnce(signal){
            assert.equal(signal,stop.signal);
            assert.equal(signal.aborted,false,'shutdown must prevent new claims');
            claims++;
            if(phase==='claim'&&claims<=slots)throw failure;
            assert.equal(outcome,'retry','only successful reporting may resume work');
            assert.equal(fired,1,'claims must wait for native retry timer expiry');
            assert.equal(reports,1,'recovery must retain one original report');
            assert.ok(claims<=${phase==='claim'?slots*2:slots},'recovery must stop after one batch');
            if(claims===${phase==='claim'?slots*2:slots})stop.abort();
            return false;
          },
          async onError(error){
            assert.equal(error,failure,'reporting must keep the original work failure');
            reports++;
            assert.equal(reports,1,'pending reporting must prevent another work attempt');
            assert.equal(claims,phase==='claim'?slots:0,'all active claims must finish before reporting');
            enterReport();await reportGate;
            if(outcome==='report-refusal')throw reportFailure;
          },
        }).then(()=>({ok:true}),error=>({error})).finally(()=>{finished=true;});
        const reach=pending=>Promise.race([pending,running.then(result=>{
          if('error' in result)throw result.error;
          assert.fail('worker returned while its error report or retry timer was pending');
        })]);
        try {
          await reach(reporting);await turn();
          assert.equal(finished,false,'the pending report must retain the worker');
          assert.equal(created,0,'the retry timer must not start before reporting finishes');
          assert.equal(fired,0);
          assert.equal(claims,phase==='claim'?slots:0);
          if(outcome==='shutdown'){
            stop.abort();await turn();
            assert.equal(finished,false,'shutdown must wait for reporting cleanup');
            assert.equal(created,0,'shutdown must not allocate a retry timer during reporting');
          }
          releaseReport();
          if(outcome==='retry'){
            await reach(timerEntered);
            assert.equal(finished,false,'native retry waiting must retain the worker');
            assert.equal(created,1);
            assert.equal(fired,0,'creating a timer must not count as its expiry');
          }
          const result=await running;
          if(outcome==='report-refusal'){
            assert.ok('error' in result);assert.equal(result.error,reportFailure);
            assert.equal(stop.signal.aborted,false,'reporting refusal must stop a live worker');
          }else assert.deepEqual(result,{ok:true});
          assert.equal(created,outcome==='retry'?1:0);
          assert.equal(fired,outcome==='retry'?1:0);
          console.log(JSON.stringify({created,fired,claims,schedules,reports}));
        } finally {
          stop.abort();releaseReport();await running;hook.disable();
        }
      `;
      const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
      assert.equal(stderr,'');
      assert.deepEqual(JSON.parse(stdout),{
        created:outcome==='retry'?1:0,fired:outcome==='retry'?1:0,
        claims:(phase==='claim'?slots:0)+(outcome==='retry'?slots:0),
        schedules:phase==='schedule'?(outcome==='retry'?2:1):0,reports:1,
      });
    });
  }
}
