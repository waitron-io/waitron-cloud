import assert from 'node:assert/strict';
import {setImmediate as turn} from 'node:timers/promises';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

function gate(){
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  return {pending,release};
}

for(const slots of [2,32])for(const stopFirst of ['reporting','polling'] as const){
  test(`${slots}-slot workers keep reporting, polling and ${stopFirst}-first shutdown independent`,{timeout:3000},async()=>{
    const reportingStop=new AbortController(),pollingStop=new AbortController();
    const reportEntered=gate(),reportDone=gate();
    const pollEntered=[gate(),gate()],pollDone=[gate(),gate()];
    const failure=new Error('mail claim refused');
    const reports:unknown[]=[],retryWaits:number[]=[],pollWaits:number[]=[],schedules:number[]=[];
    let reportingClaims=0,pollingClaims=0,pollingNow=0;
    let reportingFinished=false,pollingFinished=false;
    const reporting=runWorkerLoop({
      signal:reportingStop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,
      async runOnce(signal){
        assert.equal(signal,reportingStop.signal);
        const index=reportingClaims++;
        assert.ok(index<slots*2,'reporting worker must not start a third batch');
        if(index===0)throw failure;
        if(reportingClaims===slots*2)reportingStop.abort();
        return false;
      },
      async onError(error){
        assert.equal(error,failure,'only the reporting worker receives its claim refusal');
        reports.push(error);assert.equal(reports.length,1);
        reportEntered.release();
        await reportDone.pending;
      },
      async wait(milliseconds,signal){
        assert.equal(signal,reportingStop.signal);
        assert.equal(stopFirst,'polling','a stopped reporting worker must not wait to retry');
        retryWaits.push(milliseconds);assert.equal(retryWaits.length,1);
      },
    }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{reportingFinished=true;});
    let polling:typeof reporting|undefined;
    const reach=async(pending:Promise<void>,running:typeof reporting)=>Promise.race([
      pending,running.then(result=>{
        if('error' in result)throw result.error;
        assert.fail('worker returned before reaching its pending operation');
      }),
    ]);
    const succeeded=async(running:typeof reporting)=>assert.deepEqual(await running,{ok:true});
    try{
      await reach(reportEntered.pending,reporting);
      polling=runWorkerLoop({
        signal:pollingStop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:10,now:()=>pollingNow,
        async schedule(){schedules.push(pollingNow);assert.ok(schedules.length<=2);},
        async runOnce(signal){
          assert.equal(signal,pollingStop.signal);
          pollingClaims++;assert.ok(pollingClaims<=slots*2,'polling worker must not start a third batch');
          if(pollingClaims===slots)pollingNow=60;
          return false;
        },
        async wait(milliseconds,signal){
          assert.equal(signal,pollingStop.signal);
          const index=pollWaits.length;
          assert.ok(index<2,'polling worker must wait only for its two owned batches');
          pollWaits.push(milliseconds);pollingNow+=milliseconds;
          pollEntered[index]!.release();
          await pollDone[index]!.pending;
        },
        onError(error){assert.fail(`polling worker must not receive another worker's failure: ${String(error)}`);},
      }).then(()=>({ok:true as const}),(error:unknown)=>({error})).finally(()=>{pollingFinished=true;});
      await reach(pollEntered[0]!.pending,polling);
      assert.equal(reportingFinished,false,'one worker must retain its pending reporter');
      assert.equal(reportingClaims,slots,'another worker must not release the pending reporter');
      assert.deepEqual(retryWaits,[]);
      assert.deepEqual(schedules,[0]);
      assert.equal(pollingClaims,slots);
      assert.deepEqual(pollWaits,[1]);

      pollDone[0]!.release();
      await reach(pollEntered[1]!.pending,polling);
      assert.equal(reportingFinished,false,'pending reporting must permit another worker to reschedule');
      assert.equal(reportingClaims,slots);
      assert.deepEqual(schedules,[0,61]);
      assert.equal(pollingClaims,slots*2);
      assert.deepEqual(pollWaits,[1,10]);

      if(stopFirst==='reporting'){
        reportingStop.abort();
        await turn();
        assert.equal(reportingFinished,false,'shutdown must wait for its own reporter');
        assert.equal(pollingStop.signal.aborted,false,'reporting shutdown must not cancel polling');
        reportDone.release();
        await succeeded(reporting);
        assert.equal(pollingFinished,false,'reporting shutdown must not release the other wait');
        pollingStop.abort();pollDone[1]!.release();
        await succeeded(polling);
      }else{
        pollingStop.abort();pollDone[1]!.release();
        await succeeded(polling);
        assert.equal(reportingStop.signal.aborted,false,'polling shutdown must not cancel reporting');
        assert.equal(reportingFinished,false,'polling shutdown must not release the other reporter');
        reportDone.release();
        await succeeded(reporting);
      }
      assert.equal(reportingClaims,stopFirst==='reporting'?slots:slots*2);
      assert.deepEqual(reports,[failure]);
      assert.deepEqual(retryWaits,stopFirst==='reporting'?[]:[10]);
      assert.equal(pollingClaims,slots*2);
      assert.deepEqual(schedules,[0,61]);
      assert.deepEqual(pollWaits,[1,10]);
      assert.equal(reportingFinished,true);
      assert.equal(pollingFinished,true);
    }finally{
      reportingStop.abort();pollingStop.abort();reportDone.release();
      for(const done of pollDone)done.release();
      await reporting;if(polling)await polling;
    }
  });
}
