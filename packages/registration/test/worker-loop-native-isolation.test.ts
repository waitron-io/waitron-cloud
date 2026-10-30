import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

for(const slots of [2,32])for(const failurePhase of ['claim','schedule']){
  for(const stopFirst of ['retry','idle']){
    test(`${slots}-slot ${failurePhase} failure keeps native timers independent with ${stopFirst}-first shutdown`,async()=>{
      const source=`
        import assert from 'node:assert/strict';
        import {setImmediate as turn} from 'node:timers/promises';
        import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
        const stops=[new AbortController(),new AbortController()];
        const failure=new Error('worker refused');
        const claims=[0,0],reports=[0,0],finished=[false,false],completed=[];
        let schedules=0;
        const entered=[];
        const ready=[0,1].map(index=>new Promise(resolve=>{entered[index]=resolve;}));
        const running=stops.map((stop,index)=>runWorkerLoop({
          signal:stop.signal,concurrency:${slots},scheduleIntervalMs:60000,pollIntervalMs:60000,
          schedule:index===0&&${JSON.stringify(failurePhase)}==='schedule'?async()=>{
            schedules++;
            assert.equal(schedules,1,'the failed schedule must wait before retrying');
            throw failure;
          }:undefined,
          async runOnce(signal){
            assert.equal(signal,stop.signal,'each worker must retain its own cancellation signal');
            assert.equal(signal.aborted,false,'stopped workers must not claim again');
            claims[index]++;
            assert.ok(claims[index]<=${slots},'pending native timers must prevent another claim batch');
            if(index===0)throw failure;
            if(claims[index]===${slots})entered[index]();
            return false;
          },
          onError(error){
            assert.equal(index,0,'idle timer cancellation must not report a worker failure');
            assert.equal(error,failure,'retry reporting must keep the original worker failure');
            reports[index]++;
            assert.equal(reports[index],1,'the failed worker must wait before reporting again');
            entered[index]();
          },
        }).then(()=>({ok:true}),error=>({error})).then(result=>{
          finished[index]=true;completed.push(index);return result;
        }));
        const first=${stopFirst==='retry'?0:1},second=1-first;
        try {
          await Promise.race([
            Promise.all(ready),
            Promise.race(running).then(result=>assert.fail('worker returned before both native timers entered: '+JSON.stringify(result))),
          ]);
          await turn();
          assert.deepEqual(finished,[false,false],'both native timers must retain their workers before shutdown');
          assert.deepEqual(claims,[${failurePhase==='claim'?slots:0},${slots}]);
          assert.deepEqual(reports,[1,0]);
          stops[first].abort(new Error('first worker shutdown'));
          assert.deepEqual(await running[first],{ok:true},'the first native timer must cancel cleanly');
          await turn();
          assert.equal(finished[second],false,'stopping one worker must leave the other native timer pending');
          assert.equal(stops[second].signal.aborted,false,'shutdown must not abort the surviving worker signal');
          assert.deepEqual(completed,[first]);
          assert.deepEqual(claims,[${failurePhase==='claim'?slots:0},${slots}]);
          assert.deepEqual(reports,[1,0]);
          stops[second].abort(new Error('second worker shutdown'));
          assert.deepEqual(await running[second],{ok:true},'the surviving native timer must cancel on its own shutdown');
          assert.notEqual(stops[0].signal.reason,stops[1].signal.reason);
          assert.deepEqual(finished,[true,true]);
          console.log(JSON.stringify({claims,reports,schedules,completed}));
        } finally {
          for(const stop of stops)stop.abort();
          await Promise.all(running);
        }
      `;
      const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000})
        .catch((error:unknown)=>{
          if(error&&typeof error==='object'&&'killed' in error&&error.killed){
            assert.fail('each shutdown must release its own native timer and let the process exit');
          }
          throw error;
        });
      assert.equal(stderr,'');
      assert.deepEqual(JSON.parse(stdout),{
        claims:[failurePhase==='claim'?slots:0,slots],reports:[1,0],
        schedules:failurePhase==='schedule'?1:0,
        completed:stopFirst==='retry'?[0,1]:[1,0],
      });
    });
  }
}
