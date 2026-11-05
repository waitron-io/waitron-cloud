import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as runtime from './ci-reuse-runtime.mjs';

const context = () => ({repository: 'waitron-io/waitron-cloud', repositoryId: 123, runId: 90, attempt: 2,
  workflowPath: '.github/workflows/aws-infrastructure.yml', eventName: 'push', sha: 'a'.repeat(40), ref: 'refs/heads/main',
  workflowRef: 'waitron-io/waitron-cloud/.github/workflows/aws-infrastructure.yml@refs/heads/main', workflowSha: 'a'.repeat(40),
  full: false, called: false, event: {before: 'b'.repeat(40), after: 'a'.repeat(40)}});
const run = () => ({id: 90, run_attempt: 2, workflow_id: 17, path: '.github/workflows/aws-infrastructure.yml',
  event: 'push', head_sha: 'a'.repeat(40), repository: {id: 123, full_name: 'waitron-io/waitron-cloud'},
  head_repository: {id: 123, full_name: 'waitron-io/waitron-cloud'}});
test('runtime binds workflow ID to its own current API run before producing evidence', () => {
  assert.equal(typeof runtime.bindRuntimeWorkflow, 'function');
  assert.equal(runtime.bindRuntimeWorkflow(context(), {remaining: () => 5000, readRun: () => run()}).workflowId, 17);
  for (const bad of [{id: 91}, {run_attempt: 1}, {workflow_id: 0}, {path: '.github/workflows/ci.yml'}, {head_sha: 'b'.repeat(40)},
    {event: 'pull_request'}, {repository: {id: 124, full_name: 'waitron-io/waitron-cloud'}}]) {
    assert.throws(() => runtime.bindRuntimeWorkflow(context(), {remaining: () => 5000, readRun: () => ({...run(), ...bad})}));
  }
});
test('main publication keeps decision JSON isolated from PR source evidence', () => {
  assert.equal(typeof runtime.publishRuntimePlan, 'function');
  const root = mkdtempSync(join(tmpdir(), 'cloud-runtime-evidence-'));
  try {
    const git = (...args) => args[1] === 'HEAD^{tree}' ? 'c'.repeat(40) : 'a'.repeat(40);
    const output = join(root, 'output');
    runtime.publishRuntimePlan({...context(), workflowId: 17}, {full: true, head: 'a'.repeat(40), required: true}, git, 'full',
      {root, output});
    const decision = JSON.parse(readFileSync(join(root, 'decision/plan.json'), 'utf8'));
    assert.equal(decision.mode, 'full'); assert.equal(decision.context.workflowId, 17);
    assert.equal(readFileSync(output, 'utf8'), 'decision_artifact=ci-decision-v1-aws-infrastructure-90-2\n');
    assert.throws(() => readFileSync(join(root, 'source/plan.json')));
  } finally {rmSync(root, {recursive: true, force: true});}
});
