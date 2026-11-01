import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess, {spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertSummary} from './ci-summary.mjs';
import * as summary from './ci-summary.mjs';
const plan = {packages:[1,2,3,4,5,6].map(shard=>({package:'@waitron-cloud/portal',shard,shards:6})),receipts:[],typecheck:true,reuse:null};
const results = {changes:'success',typecheck:'success',root:'success',receipts:'skipped',packages:'success'};
const jobs = ['changes','typecheck','root (1/4)','root (2/4)','root (3/4)','root (4/4)', ...[1,2,3,4,5,6].map(i=>`package (@waitron-cloud/portal, shard ${i}/6)`)].map(name=>({name,status:'completed',conclusion:'success'}));
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
    assert.match(run.stdout, /Passed 6 package jobs/);
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
  await assert.rejects(() => summary.waitForSummary(plan, results, clock), /Timed out.*package \(@waitron-cloud\/portal, shard 6\/6\)/);
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


test('publication wait names the unfinished job when its next API read times out', async () => {
  let elapsed = 0;
  let reads = 0;
  await assert.rejects(() => summary.waitForSummary(plan, results, {
    timeoutMs: 50, pollMs: 20, now: () => elapsed,
    sleep: async ms => { elapsed += ms; },
    readJobs: () => {
      if (reads++ === 0) return unfinishedJobs();
      elapsed = 50;
      throw new Error('spawnSync gh ETIMEDOUT');
    },
  }), /package \(@waitron-cloud\/portal, shard 6\/6\).*spawnSync gh ETIMEDOUT/);
});

test('publication wait keeps unfinished unplanned jobs pending and requires their skipped result', async () => {
  const pending = [...jobs, {name: 'documentation', status: 'queued', conclusion: null}];
  const stuck = publication([pending]);
  await assert.rejects(() => summary.waitForSummary(plan, results, stuck), /Timed out.*documentation/);
  for (const conclusion of ['success', 'failure', 'cancelled', null]) {
    const clock = publication([pending, [...jobs, {name: 'documentation', status: 'completed', conclusion}]]);
    await assert.rejects(() => summary.waitForSummary(plan, results, clock), /Unexpected executed job: documentation/);
  }
  const skipped = publication([pending, [...jobs, {name: 'documentation', status: 'completed', conclusion: 'skipped'}]]);
  await summary.waitForSummary(plan, results, skipped);
  assert.equal(skipped.elapsed(), 20);
});

test('default publication allowance caps API calls, each read and the total wait', async t => {
  let elapsed = 0;
  const timeouts = [];
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    timeouts.push(options.timeout);
    assert.ok(timeouts.length <= 30, 'Too many API reads within one minute');
    return JSON.stringify([{jobs: unfinishedJobs()}]);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => summary.waitForSummary(plan, results, {
      now: () => elapsed, sleep: async ms => { elapsed += ms; },
    }), /Timed out.*package \(@waitron-cloud\/portal, shard 6\/6\)/);
    assert.equal(elapsed, 60_000);
    assert.equal(timeouts.length, 30);
    assert.equal(timeouts[0], 10_000);
    assert.equal(timeouts.at(-1), 2_000);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('publication wait refuses records without a usable job name', async () => {
  for (const record of [null, {}, {name: ''}, {name: 42}]) {
    assert.throws(() => assertSummary(plan, results, [...jobs, record]), /Invalid job record/);
    assert.throws(() => assertSummary(plan, results, [...jobs, {...record, status: 'completed', conclusion: 'skipped'}]), /Invalid job record/);
    const clock = publication([[...jobs, record]]);
    await assert.rejects(() => summary.waitForSummary(plan, results, clock), /Invalid job record/);
    assert.equal(clock.reads(), 1);
  }
});

const identity = {runId: 42, runAttempt: 2, headSha: 'a'.repeat(40)};
function finishedSteps() {
  return [
    {name: 'Set up job', number: 1, status: 'completed', conclusion: 'success'},
    {name: 'Unused platform command', number: 2, status: 'completed', conclusion: 'skipped'},
    {name: 'Run tests', number: 3, status: 'completed', conclusion: 'success'},
    {name: 'Post checkout', number: 7, status: 'completed', conclusion: 'success'},
    {name: 'Complete job', number: 8, status: 'completed', conclusion: 'success'},
  ];
}
function finishedShard() {
  return {...jobs.at(-1), status: 'in_progress', conclusion: null,
    run_id: 42, run_attempt: 2, head_sha: identity.headSha, steps: finishedSteps()};
}
const withShard = shard => [...jobs.slice(0, -1), shard];

test('deadline explains the unmet step evidence without disclosing arbitrary record data', async () => {
  const cases = [
    [{run_id: 41}, 'run identity'],
    [{run_attempt: 1}, 'run attempt'],
    [{head_sha: 'private-commit-data'}, 'source commit'],
    [{status: 'queued'}, 'job status'],
    [{conclusion: 'private-result'}, 'job result'],
    [{steps: null}, 'step list'],
    [{steps: finishedSteps().map((step, i) => i === 0 ? {...step, name: 'private-setup'} : step)}, 'successful setup'],
    [{steps: finishedSteps().slice(0, -1)}, 'successful final step'],
    [{steps: finishedSteps().map((step, i) => i === 2 ? {...step, name: ''} : step)}, 'step names'],
    [{steps: finishedSteps().map((step, i) => i === 2 ? {...step, status: 'private-status'} : step)}, 'completed steps'],
    [{steps: finishedSteps().map((step, i) => i === 2 ? {...step, conclusion: 'private-result'} : step)}, 'step results'],
    [{steps: finishedSteps().map((step, i) => i === 0 ? {...step, number: 0} : step)}, 'step number order'],
    [{steps: finishedSteps().map((step, i) => i === 0 ? {...step, number: -1} : step)}, 'step number order'],
    [{steps: finishedSteps().map((step, i) => i === 0 ? {...step, number: 1.5} : step)}, 'step number order'],
    [{steps: finishedSteps().map((step, i) => i === 0 ? {...step, number: '1'} : step)}, 'step number order'],
    [{steps: finishedSteps().map((step, i) => i === 2 ? {...step, number: 1} : step)}, 'step number order'],
  ];
  for (const [change, reason] of cases) {
    const clock = publication([withShard({...finishedShard(), ...change, privateField: 'private-field'})]);
    await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), error => {
      assert.ok(error.message.startsWith('Timed out waiting for job records:'));
      assert.ok(error.message.includes(`; last observed unmet step evidence: ${jobs.at(-1).name} [${reason}]`), error.message);
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
    assert.equal(clock.elapsed(), 50);
    assert.equal(clock.reads(), 3);
  }
});

test('deadline identifies invalid current identity and simultaneous unmet checks', async () => {
  for (const invalid of [null, {...identity, runId: 0}, {...identity, runAttempt: 0}, {...identity, headSha: 'private-sha'}]) {
    await assert.rejects(() => summary.waitForSummary(plan, results, {
      ...publication([withShard(finishedShard())]), identity: invalid,
    }), /last observed unmet step evidence: .*\[current run identity\]/);
  }
  await assert.rejects(() => summary.waitForSummary(plan, results, {
    ...publication([withShard({...finishedShard(), run_id: 41, run_attempt: 1, steps: []})]), identity,
  }), /\[run identity, run attempt, step list\]/);
});

test('deadline describes only the latest unresolved evidence and no resolved or unplanned step data', async () => {
  const earlier = {...finishedShard(), run_id: 41};
  const latest = {...finishedShard(), steps: finishedSteps().slice(0, -1)};
  const unplanned = {name: 'documentation', status: 'queued', conclusion: null, steps: [{name: 'private-step'}]};
  const clock = publication([withShard(earlier), [...withShard(latest), unplanned]]);
  await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), error => {
    assert.ok(error.message.includes(`${jobs.at(-1).name} [successful final step]`), error.message);
    assert.doesNotMatch(error.message, /\[run identity\]|private-step|documentation \[/);
    return true;
  });
  const resolved = publication([[...withShard(finishedShard()), unplanned]]);
  await assert.rejects(() => summary.waitForSummary(plan, results, {...resolved, identity, report: () => {}}), error => {
    assert.match(error.message, /Timed out.*documentation/);
    assert.doesNotMatch(error.message, /unmet step evidence/);
    return true;
  });
});

test('a timed-out read retains the last observed reason within the same deadline', async () => {
  let elapsed = 0, reads = 0;
  await assert.rejects(() => summary.waitForSummary(plan, results, {
    identity, timeoutMs: 50, pollMs: 20, now: () => elapsed,
    sleep: async ms => { elapsed += ms; },
    readJobs: () => {
      if (reads++ === 0) return withShard({...finishedShard(), run_attempt: 1});
      elapsed = 50;
      throw Object.assign(new Error('lookup deadline'), {code: 'ETIMEDOUT'});
    },
  }), error => {
    assert.match(error.message, /last lookup: lookup deadline/);
    assert.match(error.message, /last observed unmet step evidence: .*\[run attempt\]/);
    return true;
  });
  assert.equal(elapsed, 50);
  assert.equal(reads, 2);
});

test('a late successful API read preserves the prior snapshot explanation and still refuses', async () => {
  let elapsed = 0, reads = 0;
  await assert.rejects(() => summary.waitForSummary(plan, results, {
    identity, timeoutMs: 50, pollMs: 20, now: () => elapsed,
    sleep: async ms => { elapsed += ms; },
    readJobs: () => {
      if (reads++ === 0) return withShard({...finishedShard(), run_id: 41});
      elapsed = 51;
      return jobs;
    },
  }), /Timed out reading job records: .*last observed unmet step evidence: .*\[run identity\]/);
  assert.equal(reads, 2);
});

test('final successful needs plus same-attempt finished steps resolve a permanently stale shard', async () => {
  const clock = publication([withShard(finishedShard())]);
  await summary.waitForSummary(plan, results, {...clock, identity});
  assert.equal(clock.reads(), 1);
  assert.equal(clock.elapsed(), 0);
  // The synchronous final-record check remains the stricter landing contract.
  assert.throws(() => assertSummary(plan, results, withShard(finishedShard())), /unfinished/);
});

test('step evidence cannot override cancelled, timed out, skipped or failed final results', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'unknown']) {
    const clock = publication([withShard({...finishedShard(), status: 'completed', conclusion})]);
    await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /did not pass/);
  }
  for (const result of ['failure', 'cancelled', 'skipped', 'timed_out', undefined]) {
    const clock = publication([withShard(finishedShard())]);
    await assert.rejects(() => summary.waitForSummary(plan, {...results, packages: result}, {...clock, identity}), /packages did not match/);
    assert.equal(clock.reads(), 0);
  }
});

test('stale step evidence refuses another run, commit or attempt and missing identity', async () => {
  for (const change of [{run_id: 41}, {run_attempt: 1}, {run_attempt: 3}, {head_sha: 'b'.repeat(40)}, {run_id: undefined}, {run_attempt: undefined}, {head_sha: undefined}]) {
    const clock = publication([withShard({...finishedShard(), ...change})]);
    await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /Timed out.*shard 6\/6/);
  }
  const clock = publication([withShard(finishedShard())]);
  await assert.rejects(() => summary.waitForSummary(plan, results, clock), /Timed out.*shard 6\/6/);
  for (const badIdentity of [
    {...identity, runId: 0}, {...identity, runId: 1.5},
    {...identity, runAttempt: 0}, {...identity, runAttempt: 1.5},
    {...identity, headSha: 'bad'},
  ]) {
    const shard = {...finishedShard(), run_id: badIdentity.runId, run_attempt: badIdentity.runAttempt, head_sha: badIdentity.headSha};
    await assert.rejects(() => summary.waitForSummary(plan, results, {...publication([withShard(shard)]), identity: badIdentity}), /Timed out.*shard 6\/6/);
  }
});

test('step evidence must include successful final cleanup and no failed, unknown or incomplete step', async () => {
  const variants = [
    [], finishedSteps().slice(0, -1),
    [{name: 'Complete job', number: 1, status: 'completed', conclusion: 'success'}],
    [null, ...finishedSteps().slice(1)],
    finishedSteps().map((step, i) => i === 0 ? {...step, name: 'Other setup'} : step),
    finishedSteps().map((step, i) => i === 2 ? {...step, name: 'Complete job'} : step),
    finishedSteps().map((step, i) => i === 2 ? {...step, name: 'Complete job'} : i === 4 ? {...step, name: 'Other last step'} : step),
    finishedSteps().map((step, i) => i === 2 ? {...step, name: undefined} : step),
    [...finishedSteps(), {name: 'Late work', number: 9, status: 'completed', conclusion: 'success'}],
    [...finishedSteps().slice(0, -1), {...finishedSteps().at(-1), name: 'Other final step'}],
  ];
  for (const index of [0, 2, 3, 4]) {
    const changes = [{conclusion: 'failure'}, {conclusion: 'cancelled'}, {conclusion: null}, {conclusion: 'unknown'}, {status: 'in_progress'}, {number: 0}, {number: 1.5}];
    if (index === 0 || index === 4) changes.push({conclusion: 'skipped'});
    if (index > 0) changes.push({number: 1});
    for (const change of changes) {
      variants.push(finishedSteps().map((step, i) => i === index ? {...step, ...change} : step));
    }
  }
  for (const steps of variants) {
    const clock = publication([withShard({...finishedShard(), steps})]);
    await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /Timed out.*shard 6\/6/);
  }
  for (const change of [{status: 'queued'}, {conclusion: 'failure'}, {conclusion: 'unknown'}]) {
    const clock = publication([withShard({...finishedShard(), ...change})]);
    await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /Timed out.*shard 6\/6/);
  }
});

test('a rerun can reuse a completed successful earlier attempt but never unfinished earlier steps', async () => {
  const earlier = {...finishedShard(), run_attempt: 1, status: 'completed', conclusion: 'success'};
  await summary.waitForSummary(plan, results, {...publication([withShard(earlier)]), identity});
  const clock = publication([withShard({...earlier, status: 'in_progress', conclusion: null})]);
  await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /Timed out.*shard 6\/6/);
});

test('executed summary binds completed shard steps to the workflow run, attempt and source commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-summary-steps-'));
  try {
    writeFileSync(join(root, 'jobs.json'), JSON.stringify([{jobs: withShard(finishedShard())}]));
    writeFileSync(join(root, 'gh'), '#!/bin/sh\ncat "$CI_PUBLICATION_FIXTURE/jobs.json"\n', {mode: 0o700});
    const run = spawnSync(process.execPath, ['scripts/ci-summary.mjs'], {
      env: {...process.env, PATH: `${root}:${process.env.PATH}`, CI_PUBLICATION_FIXTURE: root,
        CI_PLAN: JSON.stringify(plan),
        CI_RESULTS: JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, result]) => [name, {result}]))),
        GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', CI_HEAD_SHA: identity.headSha},
      encoding: 'utf8', timeout: 5_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Final needs and completed steps:.*shard 6\/6/);
    assert.match(run.stdout, /run 42, attempt 2, a{40}/);
    assert.match(run.stdout, /Passed 6 package jobs/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('step evidence never supplies an omitted or duplicated partition or unplanned executed job', async () => {
  for (const records of [jobs.slice(0, -1), [...withShard(finishedShard()), finishedShard()]]) {
    const clock = publication([records]);
    await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /Missing or duplicate job/);
  }
  const clock = publication([[...jobs, {...finishedShard(), name: 'legacy'}]]);
  await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /Timed out.*legacy/);
});

test('transient API timeouts retry within the existing total allowance then require real records', async () => {
  const clock = publication([jobs]);
  let calls = 0;
  await summary.waitForSummary(plan, results, {...clock, readJobs: () => {
    if (calls++ < 2) throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), {code: 'ETIMEDOUT'});
    return jobs;
  }});
  assert.equal(calls, 3);
  assert.equal(clock.elapsed(), 40);
});

test('persistent transient reads stop at the deadline and retain the pending name and last error', async () => {
  const clock = publication([jobs]);
  let calls = 0;
  await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, readJobs: () => {
    if (calls++ === 0) return unfinishedJobs();
    throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), {code: 'ETIMEDOUT'});
  }}), /shard 6\/6.*ETIMEDOUT/);
  assert.equal(clock.elapsed(), 50);
  assert.equal(calls, 3);
});

test('non-timeout lookup errors fail after exactly one read and no polling sleep', async () => {
  for (const error of [new Error('HTTP 502'), new SyntaxError('Invalid JSON'), Object.assign(new Error('permission denied'), {code: 'EACCES'})]) {
    const clock = publication([jobs]);
    let calls = 0;
    await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, readJobs: () => { calls++; throw error; }}), /Could not read job records/);
    assert.equal(calls, 1);
    assert.equal(clock.elapsed(), 0);
  }
});

test('default identity refuses a missing attempt or commit instead of guessing from another environment field', () => {
  for (const missing of ['attempt', 'commit', 'both-commits']) {
    const shard = {...finishedShard(), run_attempt: 1};
    const env = {...process.env, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', CI_HEAD_SHA: identity.headSha, GITHUB_SHA: identity.headSha};
    if (missing === 'attempt') delete env.GITHUB_RUN_ATTEMPT;
    else delete env.CI_HEAD_SHA;
    if (missing === 'both-commits') { delete env.GITHUB_SHA; delete shard.head_sha; }
    const program = `
      import assert from 'node:assert/strict';
      import {waitForSummary} from './scripts/ci-summary.mjs';
      let elapsed = 0;
      await assert.rejects(() => waitForSummary(${JSON.stringify(plan)}, ${JSON.stringify(results)}, {
        readJobs: () => ${JSON.stringify(withShard(shard))}, now: () => elapsed,
        sleep: async ms => { elapsed += ms; }, timeoutMs: 50, pollMs: 20,
      }), /Timed out.*shard 6\\/6/);
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], {env, encoding: 'utf8', timeout: 3_000});
    assert.equal(run.status, 0, `${missing}: ${run.stderr}`);
  }
});

test('polling never requests a negative sleep when processing crosses the deadline', async () => {
  let calls = 0;
  const sleeps = [];
  await assert.rejects(() => summary.waitForSummary(plan, results, {
    readJobs: unfinishedJobs, timeoutMs: 50, pollMs: 20,
    now: () => ++calls >= 4 ? 55 : 0,
    sleep: async ms => { assert.ok(ms >= 0, 'Negative polling sleep'); sleeps.push(ms); },
  }), /Timed out.*shard 6\/6/);
  assert.deepEqual(sleeps, [0]);
});

test('completed step evidence is reported once while another partition is still pending', async () => {
  const pending = withShard(finishedShard()).map((job, i) => i === 1 ? {...job, status: 'in_progress', conclusion: null} : job);
  const clock = publication([pending, pending, withShard(finishedShard())]);
  const reports = [];
  await summary.waitForSummary(plan, results, {...clock, identity, report: message => reports.push(message)});
  assert.equal(clock.reads(), 3);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /shard 6\/6/);
});

test('an API process ignoring termination cannot hold the read beyond its allowance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-summary-stubborn-api-'));
  const oldPath = process.env.PATH;
  try {
    writeFileSync(join(root, 'gh'), '#!/bin/sh\ntrap "" TERM\nexec /bin/sleep 3\n', {mode: 0o700});
    process.env.PATH = `${root}:${oldPath}`;
    const start = performance.now();
    await assert.rejects(() => summary.waitForSummary(plan, results, {timeoutMs: 500}), /Timed out.*ETIMEDOUT/);
    assert.ok(performance.now() - start < 2_000, 'The timed-out API process ignored its termination signal');
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, {recursive: true, force: true});
  }
});

test('live summary preserves every surviving package shard after registry retirement', () => {
  assert.deepEqual(summary.packageShards, {
    '@waitron-cloud/registration': 5, '@waitron-cloud/account-http': 3, '@waitron-cloud/backups': 2,
    '@waitron-cloud/portal': 6, '@waitron-cloud/identity': 1, '@waitron-cloud/operations': 1,
    '@waitron-cloud/remote-access': 4, '@waitron-cloud/translation': 1, '@waitron-cloud/ui-smoke': 1,
  });
});
