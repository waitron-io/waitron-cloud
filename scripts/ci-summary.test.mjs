import assert from 'node:assert/strict';
import test from 'node:test';
import {assertSummary} from './ci-summary.mjs';
const plan = {packages:[{package:'@waitron-cloud/portal',shard:1,shards:3},{package:'@waitron-cloud/portal',shard:2,shards:3},{package:'@waitron-cloud/portal',shard:3,shards:3}],receipts:[],typecheck:true,reuse:null};
const results = {changes:'success',typecheck:'success',receipts:'skipped',packages:'success'};
const jobs = ['changes','typecheck', ...[1,2,3].map(i=>`package (@waitron-cloud/portal, shard ${i}/3)`)].map(name=>({name,status:'completed',conclusion:'success'}));
test('summary accepts precisely the planned work and skips only unnecessary receipts', () => {
  assert.doesNotThrow(()=>assertSummary(plan,results,jobs));
});
test('summary refuses missing, cancelled, skipped, unfinished and duplicated needed shards', () => {
  for (const conclusion of ['failure','cancelled','skipped','queued','in_progress',undefined]) {
    assert.throws(()=>assertSummary(plan,results,[...jobs.slice(0,-1),{...jobs.at(-1),conclusion}]));
    assert.throws(()=>assertSummary(plan,{...results,packages:conclusion},jobs));
  }
  assert.throws(()=>assertSummary(plan,results,jobs.slice(0,-1)));
  assert.throws(()=>assertSummary(plan,results,[...jobs,jobs.at(-1)]));
  assert.throws(()=>assertSummary(plan,{...results,changes:'failure'},jobs));
  assert.throws(()=>assertSummary(plan,{...results,typecheck:'skipped'},jobs));
  assert.throws(()=>assertSummary(plan,{...results,receipts:'success'},jobs));
});
test('summary accepts skipped work only with concrete reuse evidence and rejects empty plans', () => {
  const empty={packages:[],receipts:[],typecheck:false,reuse:null};
  const skipped={changes:'success',typecheck:'skipped',receipts:'skipped',packages:'skipped'};
  assert.throws(()=>assertSummary(empty,skipped,jobs));
  assert.doesNotThrow(()=>assertSummary({...empty,reuse:{sha:'a'.repeat(40),runId:42}},skipped,[jobs[0]]));
  for (const reuse of [{}, {sha:'bad',runId:42},{sha:'a'.repeat(40),runId:null}]) assert.throws(()=>assertSummary({...empty,reuse},skipped,jobs));
  assert.throws(()=>assertSummary({...plan,reuse:{sha:'a'.repeat(40),runId:42}},results,jobs));
});

test('non-reuse cannot skip types and duplicate planned rows cannot pass',()=>{
  assert.throws(()=>assertSummary({...plan,typecheck:false},{...results,typecheck:'skipped'},jobs));
  assert.throws(()=>assertSummary({...plan,packages:[...plan.packages,plan.packages[0]]},results,jobs));
});

test('selected receipts require exactly one successful grouped job', () => {
  const grouped = {...plan, receipts: ['test:backup-capacity', 'test:local-stack']};
  const required = {...results, receipts: 'success'};
  const receiptJob = {name: 'receipts', status: 'completed', conclusion: 'success'};
  assert.doesNotThrow(() => assertSummary(grouped, required, [...jobs, receiptJob]));
  assert.throws(() => assertSummary(grouped, required, jobs));
  assert.throws(() => assertSummary(grouped, required, [...jobs, receiptJob, receiptJob]));
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'queued', 'in_progress', undefined]) {
    assert.throws(() => assertSummary(grouped, required, [...jobs, {...receiptJob, conclusion}]));
    assert.throws(() => assertSummary(grouped, {...required, receipts: conclusion}, [...jobs, receiptJob]));
  }
  assert.throws(() => assertSummary(grouped, required, [...jobs, {...receiptJob, status: 'in_progress'}]));
  for (const receipts of [['test:local-stack', 'test:local-stack'], ['proof:local-stack'], [1]]) {
    assert.throws(() => assertSummary({...grouped, receipts}, required, [...jobs, receiptJob]));
  }
});

test('summary rejects unexpected executed jobs while allowing unused skipped families and itself', () => {
  const self = {name: 'summary', status: 'in_progress', conclusion: null};
  const unused = {name: 'documentation', status: 'completed', conclusion: 'skipped'};
  assert.doesNotThrow(() => assertSummary(plan, results, [...jobs, unused, self]));
  for (const extra of [
    {name: 'legacy', status: 'completed', conclusion: 'success'},
    {name: 'legacy', status: 'completed', conclusion: 'failure'},
    {name: 'legacy', status: 'completed', conclusion: 'cancelled'},
    {name: 'legacy', status: 'queued', conclusion: null},
    {name: 'legacy', status: 'in_progress', conclusion: null},
    {name: 'documentation', status: 'queued', conclusion: 'skipped'},
  ]) assert.throws(() => assertSummary(plan, results, [...jobs, self, extra]), /Unexpected executed job/);
});
