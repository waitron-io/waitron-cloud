import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as runtime from './ci-reuse-runtime.mjs';
import {createDecisionEvidence} from './ci-decision.mjs';

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


test('decision admission rejects a self-consistent but wrong execution revision', () => {
  const git = (...args) => args[1] === 'HEAD^{tree}' ? 'c'.repeat(40) : 'a'.repeat(40);
  assert.throws(() => createDecisionEvidence({...context(), workflowId: 17, workflowSha: 'b'.repeat(40)},
    {full: true, head: 'a'.repeat(40), required: true}, git, 'full'), /Decision execution revision differs/);
});

test('reusable and explicit-full publication cannot manufacture source or decision evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-no-called-evidence-'));
  try {
    for (const marker of [{called: true}, {full: true}]) {
      runtime.publishRuntimePlan({...context(), workflowId: 17, ...marker}, {full: true, head: 'a'.repeat(40), required: true},
        (...args) => args[1] === 'HEAD^{tree}' ? 'c'.repeat(40) : 'a'.repeat(40), 'full', {root, output: join(root, 'output')});
      assert.equal(existsSync(join(root, 'output')), false);
      assert.equal(existsSync(join(root, 'source/plan.json')), false);
      assert.equal(existsSync(join(root, 'decision/plan.json')), false);
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a full main run can complete missing decision evidence after planner metadata was unavailable', () => {
  assert.equal(typeof runtime.completeMissingMainDecision, 'function');
  const root = mkdtempSync(join(tmpdir(), 'cloud-full-decision-fallback-'));
  try {
    const output = join(root, 'output');
    const git = (...args) => args[1] === 'HEAD^{tree}' ? 'c'.repeat(40) : 'a'.repeat(40);
    const api = {remaining: () => 5000, readRun: () => run()};
    runtime.completeMissingMainDecision({full: true, head: 'a'.repeat(40), required: true}, 'full', {context: context(), api, git, root, output});
    const decision = JSON.parse(readFileSync(join(root, 'decision/plan.json'), 'utf8'));
    assert.equal(decision.context.workflowId, 17); assert.equal(decision.mode, 'full');
    assert.equal(readFileSync(output, 'utf8'), 'decision_artifact=ci-decision-v1-aws-infrastructure-90-2\n');
    const untouched = join(root, 'untouched');
    runtime.completeMissingMainDecision({}, 'selected', {context: context(), published: 'already-hosted', api, git, root, output: untouched});
    assert.equal(existsSync(untouched), false);
    assert.throws(() => runtime.completeMissingMainDecision({}, 'selected', {context: context(), api, git, root, output: untouched}), /complete full work/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('invalid original ranges can record full work but cannot authorize selected or unselected work', () => {
  const git = (...args) => args[1] === 'HEAD^{tree}' ? 'c'.repeat(40) : 'a'.repeat(40);
  const invalid = {...context(), workflowId: 17, event: {...context().event, after: 'invalid-after'}};
  const full = createDecisionEvidence(invalid, {full: true, head: 'a'.repeat(40), required: true}, git, 'full');
  assert.equal(full.context.event.after, 'invalid-after', 'Preserve the actual untrusted range rather than manufacturing one');
  for (const mode of ['selected', 'unselected']) {
    assert.throws(() => createDecisionEvidence(invalid, {base: 'b'.repeat(40), head: 'a'.repeat(40), paths: ['input'], required: mode === 'selected'}, git, mode), /Decision event head differs/);
  }
});
