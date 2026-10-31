import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runWorkerLoop} from '../src/worker-loop.ts';

for(const slots of [2,32])for(const busy of [true,false])for(const jump of [-3_600_000,3_600_000]){
  test(`${slots}-slot ${busy?'busy':'idle'} scheduling keeps its interval after a ${jump<0?'backward':'forward'} system-clock change`,async t=>{
    const stop=new AbortController();let elapsed=100,wall=1_800_000_000_000,completed=0;
    const schedules:number[]=[],claims:number[]=[],waits:number[]=[];
    t.mock.method(performance,'now',()=>elapsed);
    t.mock.method(Date,'now',()=>wall+elapsed);
    await runWorkerLoop({
      signal:stop.signal,concurrency:slots,scheduleIntervalMs:60,pollIntervalMs:25,
      async schedule(){
        schedules.push(elapsed);
        if(schedules.length===1)elapsed+=50;
        else stop.abort();
      },
      async runOnce(signal){
        assert.equal(signal,stop.signal);
        claims.push(elapsed);completed++;
        if(completed%slots===0){
          if(completed===slots)wall+=jump;
          if(busy)elapsed+=20;
          // A broken clock choice must fail an assertion instead of spinning forever.
          if(completed===slots*4)stop.abort();
        }
        return busy;
      },
      async wait(milliseconds,signal){
        assert.equal(signal,stop.signal);waits.push(milliseconds);elapsed+=milliseconds;
      },
    });
    assert.deepEqual(schedules,[100,210],'the next pass is due 60ms after scheduling completes');
    assert.deepEqual(claims,busy?[...Array<number>(slots).fill(150),...Array<number>(slots).fill(170),...Array<number>(slots).fill(190)]
      :[...Array<number>(slots).fill(150),...Array<number>(slots).fill(175),...Array<number>(slots).fill(200)]);
    assert.deepEqual(waits,busy?[]:[25,25,10]);
  });
}
