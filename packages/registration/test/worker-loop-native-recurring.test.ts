import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test} from 'node:test';

const execute=promisify(execFile);

for(const slots of [2,32])for(const busy of [true,false]){
  test(`${slots}-slot native ${busy?'busy':'idle'} recurring recovery keeps reporting and scheduling deadlines`,async()=>{
    const source=`
      import assert from 'node:assert/strict';
      import {createHook} from 'node:async_hooks';
      import {setImmediate as turn} from 'node:timers/promises';
      import {runWorkerLoop} from ${JSON.stringify(new URL('../src/worker-loop.ts',import.meta.url).href)};
      const stop=new AbortController(),failure=new Error('recurring schedule refused');
      const slots=${slots},busy=${busy};
      const schedules=[],claims=[],waits=[],fired=[],reports=[],timers=new Map();
      let now=0,completed=0,finished=false,enterReport,releaseReport;
      const reportEntered=new Promise(resolve=>{enterReport=resolve;});
      const reportDone=new Promise(resolve=>{releaseReport=resolve;});
      // Logical time advances on actual timer callbacks, so a delayed host
      // cannot turn this scheduling check into a wall-clock speed requirement.
      const hook=createHook({
        init(id,type,trigger,resource){
          if(type!=='Timeout')return;
          timers.set(id,resource._idleTimeout);
          waits.push({milliseconds:resource._idleTimeout,now,completed});
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
          assert.ok(schedules.length<=4,'recovery must establish a new scheduling interval');
          assert.equal(completed,claims.length,'scheduling must await the complete claim batch');
          if(schedules.length===1)now+=5;
          if(schedules.length===2){now+=7;throw failure;}
          if(schedules.length===3){
            assert.deepEqual(fired,busy?[10]:[1,10],'recovery must await native retry expiry');
            now+=13;
          }
          if(schedules.length===4)stop.abort();
        },
        async runOnce(signal){
          assert.equal(signal,stop.signal);
          assert.equal(signal.aborted,false,'shutdown must prevent another claim batch');
          claims.push(now);
          assert.ok(claims.length<=slots*2,'recurring scheduling must precede another claim batch');
          await Promise.resolve();completed++;
          if(completed===slots)now=65;
          if(completed===slots*2)now+=busy?60:57;
          return busy;
        },
        async onError(error){
          assert.equal(error,failure,'reporting must retain the original scheduling failure');
          reports.push(error);
          assert.equal(reports.length,1,'recovery must not repeat failure reporting');
          enterReport();await reportDone;now+=11;
        },
      }).then(()=>({ok:true}),error=>({error})).finally(()=>{finished=true;});
      try{
        await Promise.race([reportEntered,running.then(result=>{
          if('error' in result)throw result.error;
          assert.fail('worker returned before recurring failure reporting');
        })]);
        await turn();
        assert.equal(finished,false,'pending reporting must retain the worker');
        assert.equal(completed,slots,'pending reporting must prevent new claims');
        assert.deepEqual(schedules,busy?[0,65]:[0,66]);
        assert.deepEqual(waits,busy?[]:[{milliseconds:1,now:65,completed:slots}],
          'pending reporting must prevent retry timer creation');
        assert.deepEqual(fired,busy?[]:[1]);
        releaseReport();
        const result=await running;
        if('error' in result)throw result.error;
        assert.deepEqual(schedules,busy?[0,65,93,166]:[0,66,94,167]);
        assert.deepEqual(claims,[...Array(slots).fill(5),...Array(slots).fill(busy?106:107)]);
        assert.deepEqual(waits,busy?[{milliseconds:10,now:83,completed:slots}]:[
          {milliseconds:1,now:65,completed:slots},
          {milliseconds:10,now:84,completed:slots},
          {milliseconds:3,now:164,completed:slots*2},
        ]);
        assert.deepEqual(fired,busy?[10]:[1,10,3]);
        assert.deepEqual(reports,[failure]);
        assert.equal(completed,slots*2);
        console.log(JSON.stringify({schedules,claims,waits,fired,completed,reports:reports.length}));
      }finally{
        stop.abort();releaseReport();await running;hook.disable();
      }
    `;
    const {stdout,stderr}=await execute(process.execPath,['--input-type=module','-e',source],{timeout:4000});
    assert.equal(stderr,'');
    assert.deepEqual(JSON.parse(stdout),{
      schedules:busy?[0,65,93,166]:[0,66,94,167],
      claims:[...Array<number>(slots).fill(5),...Array<number>(slots).fill(busy?106:107)],
      waits:busy?[{milliseconds:10,now:83,completed:slots}]:[
        {milliseconds:1,now:65,completed:slots},
        {milliseconds:10,now:84,completed:slots},
        {milliseconds:3,now:164,completed:slots*2},
      ],
      fired:busy?[10]:[1,10,3],completed:slots*2,reports:1,
    });
  });
}
