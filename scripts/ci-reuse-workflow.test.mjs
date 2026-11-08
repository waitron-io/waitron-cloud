import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {condition, evaluateExpression} from './fixtures/ci-expression.mjs';
const workflow = key => readFileSync(new URL(`../.github/workflows/${key}.yml`, import.meta.url), 'utf8');
const job = (text, name) => {const block = text.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1]; assert.ok(block, `Missing ${name}`); return block;};
const field = (text, key, indent = 4) => text.match(new RegExp(`^${' '.repeat(indent)}${key}: (.+)$`, 'm'))?.[1];
const cases = [['ci', 'changes', 'packages'], ['cloud-cost', 'discover', 'conformance'], ['venue-services-proof', 'changes', 'service-receipts'],
  ['aws-infrastructure', 'changes', 'verify']];
for (const [key, planner, work] of cases) {
  test(`${key} executes work only after selected planner output and always verifies the result`, () => {
    const text = workflow(key), workBlock = job(text, work), summary = job(text, 'summary');
    const expression = field(workBlock, 'if');
    for (const selected of [false, true]) {
      const context = {needs: {[planner]: {outputs: {required: String(selected), packages: String(selected)}}}};
      assert.equal(condition(expression, context), selected, `${key}: required=${selected}`);
      assert.equal(condition(expression, context, false), false, 'Planner failure cannot permit work');
      assert.equal(condition(field(summary, 'if'), context, false), true, 'Summary must run after planner failure');
    }
    const plan = job(text, planner);
    const inputs = field(plan, 'CI_WORKFLOW_INPUTS', 10);
    assert.ok(inputs, 'Planner must receive actual call inputs');
    for (const value of [{}, {full: false}, {full: true}]) assert.deepEqual(JSON.parse(evaluateExpression(inputs, {inputs: value})), value);
    const uploads = [...plan.matchAll(/      - name: (?:Retain source plan|Retain main decision)\n([\s\S]*?)(?=      - |$)/g)];
    assert.equal(uploads.length, 2, 'Both independent evidence uploads are mandatory');
    for (const [, block] of uploads) {
      const expression = field(block, 'if', 8);
      assert.equal(condition(expression, {steps: {plan: {outputs: {}}}}), false);
      assert.equal(condition(expression, {steps: {plan: {outputs: {source_artifact: 'source', decision_artifact: 'decision'}}}}), true);
      assert.equal(condition(expression, {steps: {plan: {outputs: {source_artifact: 'source', decision_artifact: 'decision'}}}}, false), false);
      assert.equal(field(block, 'if-no-files-found', 10), 'error');
    }
  });
}
test('AWS nightly call is full and is required by the always-running parent summary', () => {
  const nightly = workflow('nightly');
  assert.equal(field(job(nightly, 'aws'), 'uses'), './.github/workflows/aws-infrastructure.yml');
  assert.equal(field(job(nightly, 'aws'), 'full', 6), 'true');
  assert.ok(field(job(nightly, 'summary'), 'needs').slice(1, -1).split(', ').includes('aws'));
  for (const key of ['ci', 'cloud-cost', 'venue-services-proof', 'aws-infrastructure']) {
    assert.match(workflow(key), /      full:\n        type: boolean\n        default: true/);
  }
});
test('gate evaluator refuses unknown syntax rather than inventing skip permission', () => {
  for (const expression of ['success()', 'needs.x.outputs.required > 1', 'process.env', 'contains(inputs)']) {
    assert.throws(() => evaluateExpression(expression, {}));
  }
});

test('standard final source qualification has full history and the pinned Node runtime', () => {
  const summary = job(workflow('ci'), 'summary');
  assert.equal(field(summary, 'fetch-depth', 10), '0');
  assert.equal(field(summary, 'node-version', 10), "'26'");
});
