import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';

test('the trusted host transfer binds the lease and refuses altered, escaping or credential payloads', () => {
  const result = spawnSync('python3', ['-B', new URL('../../deploy/disposable-tests/session.test.py', import.meta.url).pathname], {encoding: 'utf8', timeout: 15000});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 7 tests/);
});

// Omitting cancellation fencing would let a late stage recreate retired work.
test('host operations serialize competing processes and permanently fence closed generations', () => {
  const result = spawnSync('python3', ['-B', new URL('../../deploy/disposable-tests/operations.test.py', import.meta.url).pathname], {encoding: 'utf8', timeout: 15000});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 4 tests/);
});

for (const [file,count] of [['capacity.test.py',8],['completion.test.py',6],['guards.test.py',16],['image.test.py',11],['startup.test.py',20]]) test(`trusted host ${file} policy executes all ${count} portable cases`,()=>{
  const result=spawnSync('python3',['-B',new URL('../../deploy/disposable-tests/'+file,import.meta.url).pathname],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stderr,new RegExp('Ran '+count+' tests'));
});

test('CI host preparation and memory-only credentials execute all fifteen portable cases',()=>{
 const result=spawnSync('python3',['-B',new URL('../../deploy/disposable-tests/ci-session.test.py',import.meta.url).pathname],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stderr,/Ran 15 tests/);
});
