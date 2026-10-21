import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const command = new URL('./conformance.mjs', import.meta.url);
test('integration discovery includes every nested conformance file', () => {
  const result = spawnSync(process.execPath, [command.pathname, '--list'], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    'cadence','day','fiscal','foreground','isolated-replay','mail','paced-replay','private-replay',
    'remote-browser','remote','remote-waitron','replay','service-receipt','source-bills','source-clock',
    'source-days','stack','worker-storage',
  ].map(name => name + '-conformance.test.mjs').sort());
});

// Ignoring a nested test's nonzero exit would silently admit a broken rehearsal.
test('integration runner propagates a real nested test failure', async () => {
  const {runTests} = await import('./conformance.mjs');
  const root=mkdtempSync(join(tmpdir(),'cloud-conformance-runner-'));
  try {
    mkdirSync(join(root,'fixtures'));
    const file=join(root,'fixtures/failure-conformance.test.mjs');
    writeFileSync(file,"import {test} from 'node:test'; import assert from 'node:assert/strict'; test('generated failure',()=>assert.equal(1,2));");
    const result=await runTests([file], {stdio:'pipe'});
    assert.equal(result.code,1);
    assert.match(result.output,/generated failure/);
    writeFileSync(file,"import {test} from 'node:test'; test('generated pass',()=>{});");
    assert.equal((await runTests([file],{stdio:'pipe'})).code,0);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('CI stack groups select every current and future case exactly once', () => {
  const result=spawnSync(process.execPath,[command.pathname,'--matrix'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const rows=JSON.parse(result.stdout),stack=rows.filter(row=>row.file==='stack-conformance.test.mjs');
  assert.equal(stack.length,3);
  for(const name of [
    'completeSyntheticStackRunsRealServicesAndCleansOnlyItsOwnedResources',
    'genuineLitestreamRequestLogsIndependentlyMatchReplicationRetryAndRestore',
    'genuineLitestreamTransportBodyBytesAgreeWithSeparateStorageObserver',
    'genuineNativeStreamHistoriesPairBinaryRetriesWithIndependentStorageBounds',
    'genuineNativeMultipartHistoriesKeepUnfinishedCompletedAndAbortedStorage',
    'genuineAmbiguousMultipartRepliesReconcileEveryCommittedStage_true',
    'generatedArchiveStoragePublishesACompleteAnonymousReceiptAfterCleanup','futureStackCheck',
  ]) assert.equal(stack.filter(row=>new RegExp(row.pattern).test(name)).length,1,name);
  assert.equal(new Set(rows.map(row=>row.file)).size,18);
});

test('a CI group executes only its selected cases in the real test runner', async () => {
  const {runTests}=await import('./conformance.mjs');
  const root=mkdtempSync(join(tmpdir(),'cloud-conformance-selection-'));
  try {
    const file=join(root,'cases.mjs');
    writeFileSync(file,"import {test} from 'node:test'; test('selected',()=>{}); test('other group',()=>{throw Error('other group');});");
    const result=await runTests([file],{pattern:'^selected$',stdio:'pipe'});
    assert.equal(result.code,0,result.output);
    assert.match(result.output,/selected/);
    assert.doesNotMatch(result.output,/✖ other group/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

// Matching a parent name must not admit cases assigned to another group.
test('the final stack group excludes earlier groups in the real runner', async () => {
  const {runTests, conformanceMatrix}=await import('./conformance.mjs');
  const root=mkdtempSync(join(tmpdir(),'cloud-conformance-final-group-'));
  try {
    const file=join(root,'cases.mjs');
    writeFileSync(file,"import {test} from 'node:test'; test('completeSyntheticStackRunsRealServicesAndCleansOnlyItsOwnedResources',()=>{throw Error('first group ran');}); test('genuineLitestreamTransportBodyBytesAgreeWithSeparateStorageObserver',()=>{throw Error('second group ran');}); test('futureStackCheck',()=>{});");
    const {pattern,skipPattern}=conformanceMatrix().filter(row=>row.file==='stack-conformance.test.mjs')[2];
    const result=await runTests([file],{pattern,skipPattern,stdio:'pipe'});
    assert.equal(result.code,0,result.output);
    assert.match(result.output,/futureStackCheck/);
    assert.doesNotMatch(result.output,/first group ran|second group ran/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
