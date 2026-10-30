import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function deferred(){
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

const cases=[
  {phase:'idle',outcome:'success',report:'none'},
  {phase:'idle',outcome:'failure',report:'none'},
  {phase:'idle',outcome:'failure',report:'success'},
  {phase:'idle',outcome:'failure',report:'failure'},
  {phase:'retry',outcome:'success',report:'success'},
  {phase:'retry',outcome:'failure',report:'success'},
] as const;

for(const {phase,outcome,report} of cases){
  test(`shutdown awaits a pending ${phase} poll with ${outcome} and ${report} reporting`,{timeout:2000},async()=>{
    const stop=new AbortController();
    const claimFailure=new Error('claim refused'),waitFailure=new Error('poll refused'),reportFailure=new Error('report refused');
    const waiting=deferred(),waitGate=deferred();
    const reporting=deferred(),reportGate=deferred();
    const events:string[]=[];
    let finished=false,waits=0;
    const running=runWorkerLoop({
      signal:stop.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:100,
      async schedule(){events.push('schedule');},
      async runOnce(signal){
        assert.equal(signal,stop.signal);events.push('claim');
        if(phase==='retry')throw claimFailure;
        return false;
      },
      async wait(milliseconds,signal){
        assert.equal(milliseconds,100);assert.equal(signal,stop.signal);
        assert.equal(++waits,1,'shutdown must not start another polling wait');
        events.push('wait-enter');waiting.resolve();
        await waitGate.promise;events.push('wait-exit');
      },
      onError:report==='none'?undefined:async error=>{
        assert.equal(error,phase==='retry'?claimFailure:waitFailure);
        events.push('report-enter');
        if(phase==='idle'){
          reporting.resolve();await reportGate.promise;
        }
        events.push('report-exit');
      },
    }).then(()=>{finished=true;return undefined;},error=>{finished=true;return error as unknown;});
    const before=phase==='idle'
      ?['schedule','claim','wait-enter']
      :['schedule','claim','report-enter','report-exit','wait-enter'];
    try{
      await waiting.promise;
      assert.deepEqual(events,before);
      stop.abort();await turn();
      assert.equal(finished,false,'the pending poll still owns unfinished work after shutdown');
      assert.deepEqual(events,before);
      if(outcome==='failure')waitGate.reject(waitFailure);else waitGate.resolve();
      if(phase==='idle'&&report!=='none'){
        await reporting.promise;await turn();
        assert.equal(finished,false,'shutdown must await the late poll error report');
        assert.deepEqual(events,[...before,'report-enter']);
        if(report==='failure')reportGate.reject(reportFailure);else reportGate.resolve();
      }
      const error=await running;
      assert.equal(error,outcome==='success'?undefined:report==='failure'?reportFailure:phase==='idle'&&report==='success'?undefined:waitFailure);
      assert.equal(finished,true);
      const after=outcome==='success'?['wait-exit']:phase==='idle'&&report==='success'?['report-enter','report-exit']:phase==='idle'&&report==='failure'?['report-enter']:[];
      assert.deepEqual(events,[...before,...after]);
    }finally{
      stop.abort();waitGate.resolve();reportGate.resolve();await running;
    }
  });
}
