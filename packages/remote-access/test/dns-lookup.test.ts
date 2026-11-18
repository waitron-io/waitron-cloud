import assert from 'node:assert/strict';
import {test} from 'node:test';
import {boundedResolveCname} from '../src/dns-lookup.ts';

test('a resolver that never answers is cut off at three seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let timedOut=false;
 const result=boundedResolveCname('staff.cafe.example.test',()=>new Promise(()=>{}));
 const rejected=assert.rejects(result,/dns_not_verified/).then(()=>{timedOut=true;});
 t.mock.timers.tick(2999);
 await Promise.resolve();
 assert.equal(timedOut,false);
 t.mock.timers.tick(1);
 await rejected;
});
