import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

for(const phase of ['startup','recurring'] as const){
  for(const outcome of ['success','unreported','reported','report-fails'] as const){
    test(`${phase} schedule ${outcome} after shutdown finishes before worker return`,{timeout:3000},async()=>{
      const stop=new AbortController(),scheduling=gate(),scheduleDone=gate(),reporting=gate(),reportDone=gate();
      const scheduleFailure=new Error('schedule refused'),reportFailure=new Error('report refused');
      const shutdownReason=new Error('shutdown requested');
      const events:string[]=[],reports:unknown[]=[];
      const scheduled=phase==='startup'?1:2,previousClaims=phase==='startup'?0:2;
      const prefix=phase==='startup'?[]:['schedule','claim','claim'];
      let schedules=0,claims=0,waits=0,now=0,finished=false;
      const running=runWorkerLoop({
        signal:stop.signal,concurrency:2,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>now,
        async schedule(){
          events.push('schedule');schedules++;
          assert.ok(schedules<=scheduled,'shutdown must not schedule again');
          if(schedules<scheduled)return;
          scheduling.release();await scheduleDone.pending;
          events.push('schedule-finish');
          if(outcome!=='success')throw scheduleFailure;
        },
        async runOnce(signal){
          assert.equal(signal,stop.signal);assert.equal(signal.aborted,false,'shutdown must prevent new claims');
          events.push('claim');claims++;
          assert.ok(claims<=previousClaims,'pending scheduling must prevent claims');
          now=100;return true;
        },
        onError:outcome==='reported'||outcome==='report-fails'?async error=>{
          reports.push(error);events.push('report');
          assert.equal(error,scheduleFailure,'shutdown must preserve the schedule failure');
          assert.equal(events.at(-2),'schedule-finish','schedule cleanup precedes reporting');
          reporting.release();await reportDone.pending;events.push('report-finish');
          if(outcome==='report-fails')throw reportFailure;
        }:undefined,
        async wait(){waits++;assert.fail('busy work and shutdown must not poll or retry');},
      }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{finished=true;});
      const reach=async(pending:Promise<void>)=>Promise.race([pending,running.then(result=>{
        if('error' in result)throw result.error;
        assert.fail('worker returned before its pending operation finished');
      })]);
      try{
        await reach(scheduling.pending);await turn();
        assert.equal(finished,false,'pending scheduling still owns work');
        assert.deepEqual(events,[...prefix,'schedule']);
        assert.equal(claims,previousClaims);assert.equal(waits,0);

        stop.abort(shutdownReason);await turn();
        assert.equal(finished,false,'shutdown must await schedule cleanup');
        assert.deepEqual(events,[...prefix,'schedule']);assert.deepEqual(reports,[]);
        assert.equal(claims,previousClaims);assert.equal(waits,0);

        scheduleDone.release();
        if(outcome==='reported'||outcome==='report-fails'){
          await reach(reporting.pending);await turn();
          assert.equal(finished,false,'shutdown must await the schedule error report');
          assert.deepEqual(events,[...prefix,'schedule','schedule-finish','report']);
          assert.deepEqual(reports,[scheduleFailure]);
          assert.equal(claims,previousClaims);assert.equal(waits,0);
          reportDone.release();
        }
        const result=await running;
        if(outcome==='unreported'||outcome==='report-fails'){
          assert.ok('error' in result);assert.equal(result.error,outcome==='unreported'?scheduleFailure:reportFailure);
        }else assert.deepEqual(result,{ok:true});
        assert.equal(finished,true);assert.equal(schedules,scheduled);
        assert.equal(claims,previousClaims);assert.equal(waits,0);
        assert.deepEqual(reports,outcome==='reported'||outcome==='report-fails'?[scheduleFailure]:[]);
        assert.deepEqual(events,[...prefix,'schedule','schedule-finish',
          ...(outcome==='reported'||outcome==='report-fails'?['report','report-finish']:[])]);
      }finally{
        stop.abort(shutdownReason);scheduleDone.release();reportDone.release();await running;
      }
    });
  }
}
