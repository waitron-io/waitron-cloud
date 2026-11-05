import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reuseProof} from './fixtures/ci-evidence.mjs';

const cases = [
  ['aws-infrastructure', 'changes', 'verify', ['verify (guards-1)', 'verify (guards-2)', 'verify (guards-3)', 'verify (suites)']],
  ['venue-services-proof', 'changes', 'service-receipts', ['service-receipts (legacy)', 'service-receipts (venue)']],
  ['download-supervision-diagnostic', 'changes', 'linux-contention', ['linux-contention']],
];
for (const [key, planner, work, names] of cases) {
  test(`${key} summary requires complete jobs, needs results and exact attempt identities`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-native-summary-'));
    try {
      const repo = 'waitron-io/waitron-cloud';
      const fixture = join(root, 'api.json');
      writeFileSync(join(root, 'gh'), '#!/bin/sh\nprintf \'HTTP/1.1 200 OK\\r\\n\\r\\n\'\ncat "$CI_API_FIXTURE"\n', {mode: 0o700});
      const jobs = [planner, ...names].map((name, id) => ({id: id + 1, name, run_id: 42, run_attempt: 1, head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success'}));
      const results = {[planner]: {result: 'success'}, [work]: {result: 'success'}};
      const execute = (records = jobs, needs = results, prefix = '', selection = {full: true, required: true, head: 'a'.repeat(40)}) => {
        writeFileSync(fixture, JSON.stringify({total_count: records.length + 1, jobs: [...records, {id: 100, name: prefix + 'summary', status: 'in_progress', run_id: 42, run_attempt: 1, head_sha: 'a'.repeat(40)}]}));
        const result = spawnSync(process.execPath, ['scripts/ci-native-summary.mjs'], {encoding: 'utf8', timeout: 5000, env: {...process.env,
          PATH: `${root}:${process.env.PATH}`, CI_API_FIXTURE: fixture, CI_PLAN: JSON.stringify(selection), CI_RESULTS: JSON.stringify(needs),
          CI_JOB_PREFIX: prefix, CI_WORKFLOW_PATH: `.github/workflows/${key}.yml`, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1',
          CI_HEAD_SHA: 'a'.repeat(40), GITHUB_STEP_SUMMARY: join(root, 'summary')}});
        return result;
      };
      assert.equal(execute().status, 0);
      for (const record of jobs) {
        const missing = execute(jobs.filter(job => job.id !== record.id));
        assert.equal(missing.status, 1, missing.stdout + missing.stderr); assert.match(missing.stderr, /inventory|Missing/);
      }
      for (const change of [{conclusion: 'failure'}, {run_attempt: 2}, {head_sha: 'b'.repeat(40)}, {run_id: 43}]) {
        assert.equal(execute(jobs.map((job, i) => i === 1 ? {...job, ...change} : job)).status, 1);
      }
      for (const status of ['failure', 'skipped', 'cancelled', 'queued', 'in_progress']) {
        assert.equal(execute(jobs, {...results, [work]: {result: status}}).status, 1);
      }
      assert.equal(execute([...jobs, {...jobs[0], id: 99, name: 'unplanned'}]).status, 1);
      assert.equal(execute(jobs.map((job, i) => i === 1 ? {...job, name: 'unplanned', conclusion: 'skipped'} : job)).status, 1);
      assert.equal(execute(jobs.map((job, i) => i === 1 ? {...job, id: jobs[0].id} : job)).status, 1);
      assert.equal(execute(jobs.map((job, i) => i === 1 ? {...job, name: jobs[0].name} : job)).status, 1);
      assert.equal(execute(jobs, results, 'unknown / ').status, 1);
      assert.equal(execute(jobs.map(job => ({...job, name: 'unknown / ' + job.name})), results, 'unknown / ').status, 1);
      if (key !== 'download-supervision-diagnostic') {
        const prefix = key === 'aws-infrastructure' ? 'aws / ' : 'venue / ';
        assert.equal(execute(jobs.map(job => ({...job, name: prefix + job.name})), results, prefix).status, 0);
      }
      if (key === 'venue-services-proof') {
        const unselected = {base: 'b'.repeat(40), head: 'a'.repeat(40), paths: ['apps/portal/src/account.ts'], required: false};
        const skipped = {...jobs[1], name: 'service-receipts (${{ matrix.receipt }})', conclusion: 'skipped'};
        assert.equal(execute([jobs[0], skipped], {...results, [work]: {result: 'skipped'}}, '', unselected).status, 0);
        assert.equal(execute([jobs[0], {...skipped, conclusion: 'success'}], {...results, [work]: {result: 'skipped'}}, '', unselected).status, 1);
        const proof = {...reuseProof(), workflowPath: '.github/workflows/venue-services-proof.yml'};
        const stale = execute([jobs[0], skipped], {...results, [work]: {result: 'skipped'}}, '', {required: false, reuse: proof});
        assert.equal(stale.status, 1); // The final source must be requalified, even when the current skips match.
      }
    } finally {rmSync(root, {recursive: true, force: true});}
  });
}

test('native summary rejects duplicate job identities even from a preloaded job reader', async () => {
  const {waitForNativeSummary} = await import('./ci-native-summary.mjs');
  const identity = {runId: 42, runAttempt: 1, headSha: 'a'.repeat(40)};
  const record = name => ({id: name === 'changes' ? 1 : 2, name, run_id: 42, run_attempt: 1,
    head_sha: identity.headSha, status: 'completed', conclusion: 'success'});
  const jobs = [record('changes'), record('linux-contention'), {...record('summary'), id: 3}];
  const summary = records => waitForNativeSummary('.github/workflows/download-supervision-diagnostic.yml',
    {full: true, required: true, head: identity.headSha}, {changes: {result: 'success'}, 'linux-contention': {result: 'success'}},
    {identity, readJobs: () => records});
  await summary(jobs);
  await assert.rejects(summary(jobs.map((job, i) => i === 1 ? {...job, id: 1} : job)), /Duplicate native job ID/);
});

test('native summary retries transient lookups within its unchanged publication deadline', async () => {
  const {waitForNativeSummary} = await import('./ci-native-summary.mjs');
  const identity = {runId: 42, runAttempt: 1, headSha: 'a'.repeat(40)};
  const jobs = ['changes', 'linux-contention', 'summary'].map((name, id) => ({id: id + 1, name, run_id: 42, run_attempt: 1,
    head_sha: identity.headSha, status: 'completed', conclusion: 'success'}));
  const plan = {full: true, required: true, head: identity.headSha}, results = {changes: {result: 'success'}, 'linux-contention': {result: 'success'}};
  let reads = 0, time = 0;
  const run = readJobs => waitForNativeSummary('.github/workflows/download-supervision-diagnostic.yml', plan, results,
    {identity, readJobs, now: () => time, timeoutMs: 5000, sleep: async ms => {assert.ok(ms >= 0); time += ms;}});
  await run(() => {reads++; if (reads === 1) throw Object.assign(Error('Controlled transient read'), {code: 'ETIMEDOUT'}); return jobs;});
  assert.equal(reads, 2);
  reads = 0; time = 0;
  await assert.rejects(run(() => {reads++; time += 50; throw Object.assign(Error('Still unavailable'), {code: 'ETIMEDOUT'});}), /Timed out/);
  assert.ok(time >= 5000 && time <= 5050); assert.ok(reads < 5);
  reads = 0; time = 0;
  await assert.rejects(run(() => {reads++; throw Error('Invalid current evidence');}), /Invalid current evidence/);
  assert.equal(reads, 1);
});
