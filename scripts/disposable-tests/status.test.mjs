import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SSHTransport} from './transport.mjs';
const lease = {resourceId:'dt-status-0-1'};
const options = {host:'unreachable.invalid',recipe:'/opt/waitron-disposable-test'};

for (const code of [1,125,255]) test(`an execution channel failure ${code} is not a verified command status`, async () => {
  class Provider extends SSHTransport { async remote() {return {code,stdout:''};} }
  await assert.rejects(new Provider(options).execute(lease, {signal:AbortSignal.timeout(1000)}), /execution|channel|completion/i);
});
for (const code of [0,3,125,255]) test(`a verified guest completion preserves command status ${code}`, async () => {
  class Provider extends SSHTransport {
    async remote(mode) {return mode==='execute-v2' ? {code:0,stdout:''} : {code:0,stdout:JSON.stringify({resourceId:lease.resourceId,code})};}
  }
  assert.equal(await new Provider(options).execute(lease, {signal:AbortSignal.timeout(1000)}),code);
});
test('missing or foreign completion evidence cannot become a command result', async () => {
  for (const receipt of [{resourceId:'dt-peer-0-1',code:0},{resourceId:lease.resourceId,code:true},{resourceId:lease.resourceId,code:256}]) {
    class Provider extends SSHTransport {async remote(mode) {return {code:0,stdout:mode==='result' ? JSON.stringify(receipt) : ''};}}
    await assert.rejects(new Provider(options).execute(lease,{signal:AbortSignal.timeout(1000)}));
  }
});

test('a competing cleanup can finish before the controller releases verified absence', async () => {
  let attempts=0;
  class Provider extends SSHTransport {
    async remote(mode) {
      if(mode==='destroy') {attempts++;return attempts===1 ? {code:75,stdout:''} : {code:0,stdout:JSON.stringify({resourceId:lease.resourceId,absent:true})};}
      return {code:0,stdout:JSON.stringify({resourceId:lease.resourceId,absent:false})};
    }
  }
  await new Provider(options).destroy(lease,{signal:AbortSignal.timeout(2000)});
  assert.ok(attempts>=2);
});

test('cleanup observes an already completed competing destruction instead of quarantining', async () => {
  class Provider extends SSHTransport {async remote(mode) {return mode==='destroy' ? {code:75,stdout:''} : {code:0,stdout:JSON.stringify({resourceId:lease.resourceId,absent:true})};}}
  await new Provider(options).destroy(lease,{signal:AbortSignal.timeout(1000)});
});

test('cleanup retries stop at the existing caller deadline', async () => {
  class Provider extends SSHTransport {async remote(mode) {return mode==='destroy' ? {code:75,stdout:''} : {code:0,stdout:JSON.stringify({resourceId:lease.resourceId,absent:false})};}}
  await assert.rejects(new Provider(options).destroy(lease,{signal:AbortSignal.timeout(50)}), /abort|timeout/i);
});
