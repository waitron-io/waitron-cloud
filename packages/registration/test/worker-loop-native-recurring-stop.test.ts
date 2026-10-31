import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

for(const slots of [2,32])for(const busy of [true,false]){
  for(const outcome of ['shutdown','report-refusal','shutdown-report-refusal']){
    test(`${slots}-slot native ${busy?'busy':'idle'} recurring reporting retains cleanup at ${outcome}`,async()=>{
      const source=`
        import assert from 'node:assert/strict';
        import {createHook} from 'node:async_hooks';
        import {setImmediate as turn} from 'node:timers/promises';
        import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
        const stop=new AbortController(),failure=new Error('recurring schedule refused');
        const reportFailure=new Error('recurring report refused');
        const slots=${slots},busy=${busy},outcome=${JSON.stringify(outcome)};
        const schedules=[],waits=[],fired=[],reports=[],timers=new Map();
        let now=0,claims=0,completed=0,finished=false,reportCompleted=false;
        let enterReport,releaseReport;
        const reportEntered=new Promise(resolve=>{enterReport=resolve;});
        const reportDone=new Promise(resolve=>{releaseReport=resolve;});
        // Advance logical time only on real timer callbacks, so host load
        // cannot turn the scheduling check into a wall-clock speed requirement.
        const hook=createHook({
          init(id,type,trigger,resource){
            if(type!=='Timeout')return;
            timers.set(id,resource._idleTimeout);waits.push(resource._idleTimeout);
          },
          before(id){
            if(!timers.has(id))return;
            const milliseconds=timers.get(id);now+=milliseconds;fired.push(milliseconds);
          },
          destroy(id){timers.delete(id);},
        });
        hook.enable();
        const running=runWorkerLoop({
          signal:stop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
          async schedule(){
            schedules.push(now);
            assert.equal(completed,claims,'scheduling must wait for the complete claim batch');
            assert.ok(schedules.length<=2,'a terminal report must prevent schedule recovery');
            if(schedules.length===1){now=5;return;}
            assert.equal(completed,slots,'the recurring failure must follow one complete batch');
            throw failure;
          },
          async runOnce(signal){
            assert.equal(signal,stop.signal);
            assert.equal(signal.aborted,false,'shutdown must prevent new claims');
            claims++;
            assert.ok(claims<=slots,'pending or terminal reporting must prevent another claim batch');
            await Promise.resolve();completed++;
            if(completed===slots)now=65;
            return busy;
          },
          async onError(error){
            assert.equal(error,failure,'reporting must retain the original recurring failure');
            reports.push(error);
            assert.equal(reports.length,1,'the recurring failure must be reported only once');
            enterReport();await reportDone;reportCompleted=true;
            if(outcome!=='shutdown')throw reportFailure;
          },
        }).then(()=>({ok:true}),error=>({error})).finally(()=>{finished=true;});
        try{
          await Promise.race([reportEntered,running.then(result=>{
            if('error' in result)throw result.error;
            assert.fail('worker returned before recurring error reporting');
          })]);
          await turn();
          assert.equal(finished,false,'pending reporting must retain the worker');
          assert.equal(reportCompleted,false);
          assert.equal(claims,slots);
          assert.equal(completed,slots);
          assert.deepEqual(schedules,busy?[0,65]:[0,66]);
          assert.deepEqual(waits,busy?[]:[1],'pending reporting must prevent retry timer creation');
          assert.deepEqual(fired,busy?[]:[1]);
          if(outcome!=='report-refusal'){
            stop.abort(new Error('shutdown during recurring reporting'));
            await turn();
            assert.equal(finished,false,'shutdown must await recurring report cleanup');
            assert.equal(reportCompleted,false);
            assert.equal(claims,slots);
            assert.deepEqual(schedules,busy?[0,65]:[0,66]);
            assert.deepEqual(waits,busy?[]:[1],'shutdown must not start a retry timer');
          }
          releaseReport();
          const result=await running;
          if(outcome==='shutdown')assert.deepEqual(result,{ok:true});
          else{
            assert.ok('error' in result,'report refusal must reject the worker');
            assert.equal(result.error,reportFailure,'report refusal must keep its original error');
          }
          assert.equal(stop.signal.aborted,outcome!=='report-refusal');
          assert.equal(reportCompleted,true,'return must follow report cleanup');
          assert.equal(claims,slots);
          assert.equal(completed,slots);
          assert.deepEqual(schedules,busy?[0,65]:[0,66]);
          assert.deepEqual(waits,busy?[]:[1],'terminal reporting must not start a retry timer');
          assert.deepEqual(fired,busy?[]:[1]);
          assert.deepEqual(reports,[failure]);
          console.log(JSON.stringify({claims,completed,schedules,waits,fired,reports:reports.length,reportCompleted}));
        }finally{
          stop.abort();releaseReport();await running;hook.disable();
        }
      `;
      const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
      assert.equal(stderr,'');
      assert.deepEqual(JSON.parse(stdout),{
        claims:slots,completed:slots,schedules:busy?[0,65]:[0,66],
        waits:busy?[]:[1],fired:busy?[]:[1],reports:1,reportCompleted:true,
      });
    });
  }
}
