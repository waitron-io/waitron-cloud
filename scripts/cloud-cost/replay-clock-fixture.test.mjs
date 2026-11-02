import {test} from 'node:test';
import assert from 'node:assert/strict';

test('synthetic clock advances both readings and refuses invalid moves without changing them', async()=>{
 const {createReplayClock}=await import('./replay-clock-fixture.mjs');
 const clock=createReplayClock(1793628000000);
 assert.equal(clock.wall(),1793628000000);
 assert.equal(clock.monotonic(),0);
 clock.advance(60001);
 assert.equal(clock.wall(),1793628060001);
 assert.equal(clock.monotonic(),60001);
 for(const amount of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER]){
  assert.throws(()=>clock.advance(amount),RangeError);
  assert.equal(clock.wall(),1793628060001);
  assert.equal(clock.monotonic(),60001);
 }
 for(const start of [NaN,Infinity,-1,'1793628000000'])
  assert.throws(()=>createReplayClock(start),RangeError);
});
