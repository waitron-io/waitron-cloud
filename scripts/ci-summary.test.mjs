import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess, {spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSummary} from './ci-summary.mjs';
import {reuseProof} from './fixtures/ci-evidence.mjs';
import * as summary from './ci-summary.mjs';
const plan = {packages:[1,2,3,4,5,6].map(shard=>({package:'@waitron-cloud/portal',shard,shards:6})),receipts:[],typecheck:true,reuse:null};
const results = {changes:'success',typecheck:'success',root:'success',receipts:'skipped',packages:'success'};
const jobs = ['changes','typecheck','root (1/8)','root (2/8)','root (3/8)','root (4/8)', 'root (5/8)', 'root (6/8)', 'root (7/8)', 'root (8/8)', ...[1,2,3,4,5,6].map(i=>`package (@waitron-cloud/portal, shard ${i}/6)`)].map(name=>({name,status:'completed',conclusion:'success'}));
const summaryProgram = fileURLToPath(new URL('./ci-summary.mjs', import.meta.url));
function isolatedSummaryContext(root) {
  const git = (...args) => childProcess.execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: 'pipe'}).trim();
  git('init', '-q'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
  writeFileSync(join(root, 'baseline'), 'Isolated summary job-contract fixture.\n');
  // The extensionless gh stub uses CommonJS even inside a module-typed TMPDIR.
  writeFileSync(join(root, 'package.json'), '{"type":"commonjs"}\n');
  git('add', 'baseline', 'package.json'); git('commit', '-s', '-qm', 'Save isolated summary history');
  const head = git('rev-parse', 'HEAD'), event = join(root, '.git', 'event.json');
  writeFileSync(event, '{}\n');
  return {head, env: {GITHUB_EVENT_PATH: event, GITHUB_SHA: head, CI_HEAD_SHA: head, CI_JOB_PREFIX: ''}};
}
const jobPages = records => [{total_count: records.length, jobs: records.map((job, index) => ({id: index + 1, ...job}))}];

test('ordinary reader refuses incomplete lists, changing totals and duplicate job identities', async t => {
  const records = [...jobs, {name: 'receipts', status: 'completed', conclusion: 'skipped'},
    {name: 'summary', status: 'in_progress', conclusion: null}].map((job, index) => ({...job, id: index + 1}));
  const page = (items, total = records.length) => ({total_count: total, jobs: items});
  let pages;
  let reads = 0;
  t.mock.method(childProcess, 'execFileSync', () => { reads++; return JSON.stringify(pages); });
  syncBuiltinESMExports();
  try {
    for (const [name, invalid] of [
      ['declared total exceeds delivered jobs', [page(records, records.length + 1)]],
      ['delivered jobs exceed declared total', [page(records, records.length - 1)]],
      ['total changes between pages', [page(records.slice(0, 7)), page(records.slice(7), records.length - 1)]],
      ['skipped jobs share an identity', [page([...records, {...records.at(-2), name: 'documentation'}], records.length + 1)]],
      ['a missing page contains only the summary', [page(records.slice(0, -1))]],
    ]) {
      await t.test(name, async () => {
        pages = invalid;
        reads = 0;
        await assert.rejects(() => summary.waitForSummary(plan, results), /Incomplete job list|Job list total changed|Duplicate job identity/);
        assert.equal(reads, 1, 'Contradictory evidence must refuse without another lookup');
      });
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('ordinary reader refuses malformed page totals and invalid job identities', async t => {
  let pages;
  t.mock.method(childProcess, 'execFileSync', () => JSON.stringify(pages));
  syncBuiltinESMExports();
  const records = jobs.map((job, index) => ({...job, id: index + 1}));
  try {
    for (const total of [undefined, null, -1, 1.5, '12', Number.MAX_SAFE_INTEGER + 1]) {
      await t.test(`invalid total ${total}`, async () => {
        pages = [{total_count: total, jobs: records}];
        await assert.rejects(() => summary.waitForSummary(plan, results), /Invalid job list total/);
      });
    }
    for (const id of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      await t.test(`invalid identity ${id}`, async () => {
        pages = [{total_count: records.length, jobs: records.map((job, index) => index ? job : {...job, id})}];
        await assert.rejects(() => summary.waitForSummary(plan, results), /Invalid job identity/);
      });
    }
    for (const invalid of [[], {}, null, [null], [{total_count: 12}], [{total_count: 12, jobs: {}}]]) {
      await t.test(`invalid page shape ${JSON.stringify(invalid)}`, async () => {
        pages = invalid;
        await assert.rejects(() => summary.waitForSummary(plan, results), /Invalid job list pages|Invalid job list page/);
      });
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('ordinary reader accepts complete single and multiple pages before checking job results', async t => {
  const skippedNames = [
    ...Array.from({length: 6}, (_, i) => `package (@waitron-cloud/registration, shard ${i + 1}/6)`),
    ...Array.from({length: 3}, (_, i) => `package (@waitron-cloud/account-http, shard ${i + 1}/3)`),
    ...Array.from({length: 7}, (_, i) => `package (@waitron-cloud/backups, shard ${i + 1}/7)`),
    ...Array.from({length: 4}, (_, i) => `package (@waitron-cloud/remote-access, shard ${i + 1}/4)`),
    'package (@waitron-cloud/translation)', 'package (@waitron-cloud/ui-smoke)',
  ];
  const records = [...jobs, ...skippedNames.map(name => ({name, status: 'completed', conclusion: 'skipped'}))]
    .map((job, index) => ({...job, id: index + 1}));
  let pages;
  t.mock.method(childProcess, 'execFileSync', () => JSON.stringify(pages));
  syncBuiltinESMExports();
  try {
    for (const items of [records.slice(0, jobs.length), records]) {
      pages = Array.from({length: Math.ceil(items.length / 30)}, (_, index) => ({total_count: items.length, jobs: items.slice(index * 30, (index + 1) * 30)}));
      await summary.waitForSummary(plan, results);
    }
    pages = [{total_count: records.length, jobs: records.map((job, index) => index === 0 ? {...job, conclusion: 'failure'} : job)}];
    await assert.rejects(() => summary.waitForSummary(plan, results), /changes did not pass/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('ordinary reader validates every page and sibling before selecting the standard workflow', async t => {
  const records = [...jobs.map(job => ({...job, name: `standard / ${job.name}`})),
    ...Array.from({length: 49}, (_, index) => ({name: `cost / unused ${index}`, status: 'queued', conclusion: null}))]
    .map((job, index) => ({...job, id: index + 1}));
  const paged = items => Array.from({length: Math.ceil(items.length / 30)}, (_, index) => ({total_count: records.length, jobs: items.slice(index * 30, (index + 1) * 30)}));
  let pages = paged(records);
  let reads = 0;
  const previousPrefix = process.env.CI_JOB_PREFIX;
  process.env.CI_JOB_PREFIX = 'standard / ';
  t.mock.method(childProcess, 'execFileSync', () => { reads++; return JSON.stringify(pages); });
  syncBuiltinESMExports();
  try {
    await summary.waitForSummary(plan, results);
    assert.equal(reads, 1);
    for (const [name, invalid, reason] of [
      ['duplicate sibling identity across pages', paged(records.map((job, index) => index === records.length - 1 ? {...job, id: records[15].id} : job)), /Duplicate job identity/],
      ['missing middle page containing only siblings', paged(records).filter((_, index) => index !== 1), /Incomplete job list/],
      ['missing final sibling page', paged(records).slice(0, -1), /Incomplete job list/],
      ['invalid sibling identity', paged(records.map((job, index) => index === records.length - 1 ? {...job, id: String(job.id)} : job)), /Invalid job identity/],
    ]) {
      await t.test(name, async () => {
        pages = invalid;
        reads = 0;
        await assert.rejects(() => summary.waitForSummary(plan, results), reason);
        assert.equal(reads, 1);
      });
    }
  } finally {
    if (previousPrefix === undefined) delete process.env.CI_JOB_PREFIX;
    else process.env.CI_JOB_PREFIX = previousPrefix;
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
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
  assert.doesNotThrow(()=>assertSummary({...empty,reuse:reuseProof()},skipped,[jobs[0]]));
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

test('summary rejects unknown skipped identities duplicate placeholders and duplicate self records', () => {
  for (const name of ['unknown', 'root (5/4)', 'package (unused)', 'package (@waitron-cloud/made-up)']) {
    assert.throws(() => assertSummary(plan, results, [...jobs, {name, status: 'completed', conclusion: 'skipped'}]), /Unexpected executed job/);
  }
  const skipped = {name: 'documentation', status: 'completed', conclusion: 'skipped'};
  assert.throws(() => assertSummary(plan, results, [...jobs, skipped, skipped]), /duplicate/i);
  const self = {name: 'summary', status: 'in_progress', conclusion: null};
  assert.throws(() => assertSummary(plan, results, [...jobs, self, self]), /duplicate/i);
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    assert.throws(() => assertSummary(plan, results, [...jobs, {...self, status: 'completed', conclusion}]), /summary/);
  }
});

test('summary accepts the exact skipped matrix names reported by hosted Actions', () => {
  for (const name of ['root (${{ matrix.shard }}/8)',
    "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})"]) {
    const placeholder = {name, status: 'completed', conclusion: 'skipped'};
    assert.doesNotThrow(() => assertSummary(plan, results, [...jobs, placeholder]));
    assert.throws(() => assertSummary(plan, results, [...jobs, placeholder, placeholder]), /duplicate/);
    assert.throws(() => assertSummary(plan, results, [...jobs, {...placeholder, conclusion: 'success'}]), /Unexpected executed job/);
  }
});


test('executed summary waits for a stale job record to publish its final result', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-summary-publication-'));
  try {
    const context = isolatedSummaryContext(root);
    const first = [...jobs.slice(0, -1), {...jobs.at(-1), status: 'in_progress', conclusion: null}];
    writeFileSync(join(root, 'first.json'), JSON.stringify(jobPages(first)));
    writeFileSync(join(root, 'settled.json'), JSON.stringify(jobPages(jobs)));
    writeFileSync(join(root, 'gh'), `#!/bin/sh
case "$*" in
  'api --paginate --slurp repos/waitron-io/waitron-cloud/actions/runs/42/jobs?filter=latest&per_page=30') ;;
  *) exit 2 ;;
esac
if [ -f "$CI_PUBLICATION_FIXTURE/read" ]; then
  cat "$CI_PUBLICATION_FIXTURE/settled.json"
else
  touch "$CI_PUBLICATION_FIXTURE/read"
  cat "$CI_PUBLICATION_FIXTURE/first.json"
fi
`, {mode: 0o700});
    const run = spawnSync(process.execPath, [summaryProgram], {
      cwd: root, env: {...process.env, ...context.env, PATH: `${root}:${process.env.PATH}`, CI_PUBLICATION_FIXTURE: root,
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
    return JSON.stringify(jobPages(unfinishedJobs()));
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

test('slow job evidence can finish after an initial timeout within the original minute', async t => {
  let elapsed = 0;
  const budgets = [];
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    budgets.push(options.timeout);
    elapsed += Math.min(options.timeout, 11_000);
    if (options.timeout < 11_000) throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), {code: 'ETIMEDOUT'});
    return JSON.stringify(jobPages(jobs));
  });
  syncBuiltinESMExports();
  try {
    await summary.waitForSummary(plan, results, {
      now: () => elapsed, sleep: async ms => { elapsed += ms; },
    });
    assert.equal(elapsed, 23_000);
    assert.deepEqual(budgets, [10_000, 20_000]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('persistent slow lookups retain the minute deadline and explain each timed-out attempt', async t => {
  let elapsed = 0;
  const budgets = [], sleeps = [], reports = [];
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    budgets.push(options.timeout);
    elapsed += options.timeout;
    throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), {code: 'ETIMEDOUT'});
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => summary.waitForSummary(plan, results, {
      now: () => elapsed, sleep: async ms => { sleeps.push(ms); elapsed += ms; },
      report: message => reports.push(message),
    }), /Timed out waiting for job records:.*ETIMEDOUT/);
    assert.equal(elapsed, 60_000);
    assert.deepEqual(budgets, [10_000, 20_000, 26_000]);
    assert.deepEqual(sleeps, [2_000, 2_000, 0]);
    assert.deepEqual(reports, [
      'Job records lookup 1 timed out after 10000 ms (budget 10000 ms; 50000 ms remaining)',
      'Job records lookup 2 timed out after 20000 ms (budget 20000 ms; 28000 ms remaining)',
      'Job records lookup 3 timed out after 26000 ms (budget 26000 ms; 0 ms remaining)',
    ]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('a recovered slow lookup resets the read budget and still refuses a failed shard', async t => {
  let elapsed = 0;
  const budgets = [];
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    budgets.push(options.timeout);
    elapsed += Math.min(options.timeout, 11_000);
    if (options.timeout < 11_000) throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), {code: 'ETIMEDOUT'});
    return JSON.stringify(jobPages(budgets.length === 2 ? unfinishedJobs()
      : [...jobs.slice(0, -1), {...jobs.at(-1), conclusion: 'failure'}]));
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => summary.waitForSummary(plan, results, {
      now: () => elapsed, sleep: async ms => { elapsed += ms; },
    }), /shard 6\/6\) did not pass/);
    assert.equal(elapsed, 48_000);
    assert.deepEqual(budgets, [10_000, 20_000, 10_000, 20_000]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('a lookup timeout past its budget reports zero remaining time and still refuses', async t => {
  let elapsed = 0;
  const reports = [];
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    elapsed += options.timeout + 7;
    throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), {code: 'ETIMEDOUT'});
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => summary.waitForSummary(plan, results, {
      timeoutMs: 50, now: () => elapsed,
      sleep: async ms => { elapsed += ms; }, report: message => reports.push(message),
    }), /Timed out waiting for job records:.*ETIMEDOUT/);
    assert.equal(elapsed, 57);
    assert.deepEqual(reports, [
      'Job records lookup 1 timed out after 57 ms (budget 50 ms; 0 ms remaining)',
    ]);
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
    const context = isolatedSummaryContext(root), {head} = context;
    writeFileSync(join(root, 'jobs.json'), JSON.stringify(jobPages(withShard({...finishedShard(), head_sha: head}))));
    writeFileSync(join(root, 'gh'), '#!/bin/sh\ncat "$CI_PUBLICATION_FIXTURE/jobs.json"\n', {mode: 0o700});
    const run = spawnSync(process.execPath, [summaryProgram], {
      cwd: root, env: {...process.env, ...context.env, PATH: `${root}:${process.env.PATH}`, CI_PUBLICATION_FIXTURE: root,
        CI_PLAN: JSON.stringify(plan),
        CI_RESULTS: JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, result]) => [name, {result}]))),
        GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', CI_HEAD_SHA: head},
      encoding: 'utf8', timeout: 5_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Final needs and completed steps:.*shard 6\/6/);
    assert.ok(run.stdout.includes(`run 42, attempt 2, ${head}`));
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
  await assert.rejects(() => summary.waitForSummary(plan, results, {...clock, identity}), /Unexpected executed job: legacy/);
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
    '@waitron-cloud/registration': 6, '@waitron-cloud/account-http': 3, '@waitron-cloud/backups': 7,
    '@waitron-cloud/portal': 6, '@waitron-cloud/identity': 1, '@waitron-cloud/operations': 1,
    '@waitron-cloud/remote-access': 4, '@waitron-cloud/translation': 1, '@waitron-cloud/ui-smoke': 1,
  });
});

test('reused standard workflow checks only its exact job family within the nightly run', async () => {
  const nested = jobs.map(job => ({...job, name: `standard / ${job.name}`}));
  const other = [{name: 'cost / discover', status: 'in_progress', conclusion: null}, {name: 'venue / changes', status: 'queued', conclusion: null}, {name: 'nightly-summary', status: 'queued', conclusion: null}];
  const run = records => summary.waitForSummary(plan, results, {jobPrefix: 'standard / ', readJobs: async () => records, timeoutMs: 100, pollMs: 0});
  await run([...nested, ...other]);
  for (const broken of [nested.slice(1), [...nested, nested[0]], nested.map((job, i) => i ? job : {...job, conclusion: 'failure'}), nested.map(job => ({...job, name: job.name.replace('standard / ', 'impostor / ')}))]) {
    await assert.rejects(run([...broken, ...other]));
  }
  await assert.rejects(summary.waitForSummary(plan, results, {jobPrefix: 'package', readJobs: async () => jobs}), /prefix/i);
});

test('nested summaries refuse malformed job names before selecting a workflow family', async () => {
  const nested = jobs.map(job => ({...job, name: `standard / ${job.name}`}));
  for (const name of [undefined, '', '   ', null, 5]) {
    await assert.rejects(summary.waitForSummary(plan, results, {jobPrefix: 'standard / ', readJobs: async () => [...nested, {name, status: 'completed', conclusion: 'failure'}]}), /Invalid job record: missing job name/);
  }
});

test('actual nested summary command receives the prefix configured by both workflow files', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-nested-summary-cli-'));
  try {
    const context = isolatedSummaryContext(root);
    const caller = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
    const callee = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const value = /job-prefix: '([^']+)'/.exec(caller)?.[1];
    const input = /CI_JOB_PREFIX: \$\{\{ inputs\.([\w-]+) \}\}/.exec(callee)?.[1];
    const prefix = {'job-prefix': value}[input];
    assert.equal(typeof prefix, 'string', 'Both workflows must deliver a prefix');
    const records = [...jobs.map(job => ({...job, name: `standard / ${job.name}`})), {name: 'cost / discover', status: 'in_progress', conclusion: null}];
    writeFileSync(join(root, 'jobs.json'), JSON.stringify(jobPages(records)));
    writeFileSync(join(root, 'gh.cjs'), `#!${process.execPath}\nconst fs=require('node:fs');const assert=require('node:assert/strict');assert.deepEqual(process.argv.slice(2),['api','--paginate','--slurp','repos/waitron-io/waitron-cloud/actions/runs/42/jobs?filter=latest&per_page=30']);process.stdout.write(fs.readFileSync(process.env.CI_JOB_FIXTURE,'utf8'));\n`, {mode: 0o700});
    symlinkSync('gh.cjs', join(root, 'gh'));
    const result = spawnSync(process.execPath, [summaryProgram], {cwd: root, encoding: 'utf8', timeout: 3_000, env: {...process.env, ...context.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: 'waitron-io/waitron-cloud', GITHUB_RUN_ID: '42', CI_JOB_FIXTURE: join(root, 'jobs.json'), CI_JOB_PREFIX: prefix, CI_PLAN: JSON.stringify(plan), CI_RESULTS: JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, result]) => [name, {result}])))} });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Passed 6 package jobs and 0 receipts/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
test('summary refuses legacy reuse tokens and requires a complete workflow-bound proof', () => {
  const skipped = {changes: 'success', typecheck: 'skipped', root: 'skipped', packages: 'skipped', receipts: 'skipped'};
  const proof = {version: 1, repository: 'waitron-io/waitron-cloud', repositoryId: 123, pr: 51,
    mergeSha: 'b'.repeat(40), sha: 'a'.repeat(40), tree: 'c'.repeat(40), workflowId: 17,
    workflowPath: '.github/workflows/ci.yml', runId: 42, attempt: 2,
    planDigest: 'd'.repeat(64), jobsDigest: 'e'.repeat(64)};
  const reused = {packages: [], receipts: [], typecheck: false, reuse: proof};
  assert.doesNotThrow(() => assertSummary(reused, skipped, [jobs[0]]));
  assert.throws(() => assertSummary({...reused, reuse: {sha: proof.sha, runId: proof.runId}}, skipped, [jobs[0]]));
  for (const field of Object.keys(proof)) {
    const incomplete = {...proof}; delete incomplete[field];
    assert.throws(() => assertSummary({...reused, reuse: incomplete}, skipped, [jobs[0]]), field);
  }
  for (const change of [{version: 2}, {attempt: 0}, {repositoryId: 0}, {pr: -1}, {workflowId: NaN},
    {repository: 'outsider/fork'}, {workflowPath: '.github/workflows/cloud-cost.yml'},
    {tree: '0'.repeat(40)}, {planDigest: 'f'.repeat(63)}, {jobsDigest: 'F'.repeat(64)}]) {
    assert.throws(() => assertSummary({...reused, reuse: {...proof, ...change}}, skipped, [jobs[0]]), JSON.stringify(change));
  }
});
