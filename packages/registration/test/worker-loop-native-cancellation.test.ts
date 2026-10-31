import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

// Returning on the first rejection or before reporting finishes abandons active cleanup.
for(const slots of [2,32])for(const outcome of ['success','unreported','reported','report-fails']){
  test(`${slots}-slot native claim cancellation retains cleanup before ${outcome} shutdown`,async()=>{
    const source=`
      import assert from 'node:assert/strict';
      import {createHook} from 'node:async_hooks';
      import {setTimeout as delay,setImmediate as turn} from 'node:timers/promises';
      import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
      const slots=${slots},outcome=${JSON.stringify(outcome)};
      const stop=new AbortController(),reason=new Error('native claims stopped');
      const reportFailure=new Error('native cancellation report refused');
      const timers=[],started=[],cancelled=[],completed=[],errors=[],reports=[];
      let schedules=0,finished=false,reportFinished=false;
      const gate=()=>{let release;const pending=new Promise(resolve=>{release=resolve;});return {pending,release};};
      const entered=gate(),cleanup=gate(),reporting=gate(),reportDone=gate();
      const hook=createHook({init(id,type,trigger,resource){if(type==='Timeout')timers.push(resource._idleTimeout);}});
      hook.enable();
      const running=runWorkerLoop({
        signal:stop.signal,concurrency:slots,scheduleIntervalMs:60000,pollIntervalMs:60000,
        async schedule(){schedules++;assert.equal(schedules,1,'shutdown cannot schedule another pass');},
        async runOnce(signal){
          assert.equal(signal,stop.signal,'claims must receive their own worker cancellation signal');
          assert.equal(signal.aborted,false,'shutdown must prevent another claim');
          const index=started.length;started.push(index);
          assert.ok(index<slots,'shutdown must not refill slots');
          const waiting=delay(60000,undefined,{signal});
          if(started.length===slots)entered.release();
          try{await waiting;assert.fail('the long native claim timer must be cancelled');}
          catch(error){
            assert.equal(error.name,'AbortError');assert.equal(error.cause,reason);
            cancelled.push(index);errors[index]=error;
          }
          if(index===slots-1)await cleanup.pending;
          completed.push(index);
          if(index===0&&outcome!=='success')throw errors[index];
          return false;
        },
        onError:outcome==='reported'||outcome==='report-fails'?async error=>{
          assert.equal(error,errors[0],'reporting must keep the original native timer rejection');
          assert.equal(completed.length,slots,'reporting must await every claim cleanup');
          reports.push(error);reporting.release();await reportDone.pending;reportFinished=true;
          if(outcome==='report-fails')throw reportFailure;
        }:undefined,
      }).then(()=>({ok:true}),error=>({error})).finally(()=>{finished=true;});
      const reach=pending=>Promise.race([pending,running.then(result=>{
        if('error' in result)throw result.error;
        assert.fail('worker returned before active cleanup completed');
      })]);
      try{
        await reach(entered.pending);
        assert.equal(started.length,slots);assert.deepEqual(timers,Array(slots).fill(60000));
        stop.abort(reason);await turn();
        assert.deepEqual(cancelled,Array.from({length:slots},(_,index)=>index));
        assert.deepEqual(completed,Array.from({length:slots-1},(_,index)=>index));
        assert.equal(finished,false,'shutdown must await the last native claim cleanup');
        assert.deepEqual(reports,[],'reporting must not overtake active cleanup');
        cleanup.release();
        if(outcome==='reported'||outcome==='report-fails'){
          await reach(reporting.pending);await turn();
          assert.equal(finished,false,'shutdown must await cancellation reporting');
          assert.equal(reportFinished,false);assert.deepEqual(reports,[errors[0]]);
          assert.deepEqual(timers,Array(slots).fill(60000),'pending reporting must not start a retry timer');
          reportDone.release();
        }
        const result=await running;
        if(outcome==='unreported'||outcome==='report-fails'){
          assert.ok('error' in result);assert.equal(result.error,outcome==='unreported'?errors[0]:reportFailure);
        }else assert.deepEqual(result,{ok:true});
        assert.deepEqual(completed,Array.from({length:slots},(_,index)=>index));
        assert.equal(started.length,slots);assert.equal(schedules,1);
        assert.equal(reportFinished,outcome==='reported'||outcome==='report-fails');
        assert.deepEqual(reports,outcome==='reported'||outcome==='report-fails'?[errors[0]]:[]);
        assert.deepEqual(timers,Array(slots).fill(60000),'shutdown must create no polling or retry timer');
        console.log(JSON.stringify({started:started.length,cancelled:cancelled.length,completed:completed.length,
          schedules,timers:timers.length,reports:reports.length,reportFinished}));
      }finally{
        stop.abort(reason);cleanup.release();reportDone.release();await running;hook.disable();
      }
    `;
    const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
    assert.equal(stderr,'');
    assert.deepEqual(JSON.parse(stdout),{started:slots,cancelled:slots,completed:slots,schedules:1,
      timers:slots,reports:outcome==='reported'||outcome==='report-fails'?1:0,
      reportFinished:outcome==='reported'||outcome==='report-fails'});
  });
}
