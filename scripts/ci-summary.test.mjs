import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertSummary} from './ci-summary.mjs';
import * as summary from './ci-summary.mjs';
const plan = {packages:[{package:'@waitron-cloud/portal',shard:1,shards:3},{package:'@waitron-cloud/portal',shard:2,shards:3},{package:'@waitron-cloud/portal',shard:3,shards:3}],receipts:[],typecheck:true,reuse:null};
const results = {changes:'success',typecheck:'success',root:'success',receipts:'skipped',packages:'success'};
const jobs = ['changes','typecheck','root (1/4)','root (2/4)','root (3/4)','root (4/4)', ...[1,2,3].map(i=>`package (@waitron-cloud/portal, shard ${i}/3)`)].map(name=>({name,status:'completed',conclusion:'success'}));
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


test('executed summary waits for a stale job record to publish its final result', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-summary-publication-'));
  try {
    const first = [...jobs.slice(0, -1), {...jobs.at(-1), status: 'in_progress', conclusion: null}];
    writeFileSync(join(root, 'first.json'), JSON.stringify([{jobs: first}]));
    writeFileSync(join(root, 'settled.json'), JSON.stringify([{jobs}]));
    writeFileSync(join(root, 'gh'), `#!/bin/sh
case "$*" in
  'api --paginate --slurp repos/waitron-io/waitron-cloud/actions/runs/42/jobs?filter=latest&per_page=100') ;;
  *) exit 2 ;;
esac
if [ -f "$CI_PUBLICATION_FIXTURE/read" ]; then
  cat "$CI_PUBLICATION_FIXTURE/settled.json"
else
  touch "$CI_PUBLICATION_FIXTURE/read"
  cat "$CI_PUBLICATION_FIXTURE/first.json"
fi
`, {mode: 0o700});
    const run = spawnSync(process.execPath, ['scripts/ci-summary.mjs'], {
      env: {...process.env, PATH: `${root}:${process.env.PATH}`, CI_PUBLICATION_FIXTURE: root,
        CI_PLAN: JSON.stringify(plan),
        CI_RESULTS: JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, result]) => [name, {result}]))),
        GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_RUN_ID: '42'},
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Passed 3 package jobs/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});


function publication(records) {
  let elapsed = 0;
  let reads = 0;
  return {
    readJobs: () => records[Math.min(reads++, records.length - 1)],
    now: () => elapsed,
    sleep: async ms => { elapsed += ms; },
    timeoutMs: 50,
    pollMs: 20,
    reads: () => reads,
    elapsed: () => elapsed,
  };
}

const unfinishedJobs = () => [...jobs.slice(0, -1), {...jobs.at(-1), status: 'in_progress', conclusion: null}];

test('publication wait accepts only after every planned record settles successfully', async () => {
  const clock = publication([unfinishedJobs(), unfinishedJobs(), jobs]);
  await summary.waitForSummary(plan, results, clock);
  assert.equal(clock.elapsed(), 40);
  assert.equal(clock.reads(), 3);
});

test('publication wait refuses a failed needs group before reading jobs', async () => {
  const clock = publication([unfinishedJobs(), jobs]);
  await assert.rejects(() => summary.waitForSummary(plan, {...results, packages: 'failure'}, clock), /packages did not match/);
  assert.equal(clock.reads(), 0);
});

test('publication wait never turns absent or duplicate partitions into success', async () => {
  for (const records of [jobs.slice(0, -1), [...jobs, jobs.at(-1)]]) {
    const clock = publication([records, jobs]);
    await assert.rejects(() => summary.waitForSummary(plan, results, clock), /Missing or duplicate job/);
    assert.equal(clock.reads(), 1);
  }
});

test('publication wait names the unfinished partition and stops at its deadline', async () => {
  const clock = publication([unfinishedJobs()]);
  await assert.rejects(() => summary.waitForSummary(plan, results, clock), /Timed out.*package \(@waitron-cloud\/portal, shard 3\/3\)/);
  assert.equal(clock.elapsed(), 50);
  assert.equal(clock.reads(), 3);
});

test('publication wait still refuses final failed, cancelled, skipped and unknown results', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', null, 'unknown']) {
    const clock = publication([unfinishedJobs(), [...jobs.slice(0, -1), {...jobs.at(-1), conclusion}]]);
    await assert.rejects(() => summary.waitForSummary(plan, results, clock), /did not pass/);
  }
});

test('publication wait refuses lookup errors and an API read that exhausts the deadline', async () => {
  const clock = publication([jobs]);
  await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, readJobs: () => { throw new Error('jobs lookup failed'); }}), /jobs lookup failed/);
  let elapsed = 0;
  await assert.rejects(() => summary.waitForSummary(plan, results, {
    ...clock, now: () => elapsed, readJobs: () => { elapsed = 51; return jobs; },
  }), /Timed out/);
});
