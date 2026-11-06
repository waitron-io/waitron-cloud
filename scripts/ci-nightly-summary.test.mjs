import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

function run(results) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-nightly-summary-'));
  const output = join(root, 'summary.md');
  try {
    const result = spawnSync(process.execPath, ['scripts/ci-nightly-summary.mjs'], {encoding: 'utf8', env: {...process.env, CI_NIGHTLY_RESULTS: JSON.stringify(results), GITHUB_STEP_SUMMARY: output}});
    return {...result, report: (() => {try {return readFileSync(output, 'utf8');} catch {return '';}})()};
  } finally {rmSync(root, {recursive: true, force: true});}
}
const green = {standard: {result: 'success'}, cost: {result: 'success'}, venue: {result: 'success'}, aws: {result: 'success'}, mutations: {result: 'success'}};
test('nightly final result requires all four workflows and the mutation job and publishes their outcomes', () => {
  const result = run(green);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const family of ['standard', 'cost', 'venue', 'aws', 'mutations']) assert.ok(result.report.includes(`| ${family} | success |`));
});
for (const family of ['standard', 'cost', 'venue', 'aws', 'mutations']) {
  for (const status of ['failure', 'cancelled', 'skipped', 'queued', 'in_progress', null]) {
    test(`nightly reports and refuses ${family} ${status}`, () => {
      const result = run({...green, [family]: {result: status}});
      assert.equal(result.status, 1);
      assert.match(result.report, new RegExp(`\\| ${family} \\|`));
      assert.match(result.stderr, /Nightly full CI did not pass/);
    });
  }
  test(`nightly refuses missing ${family}`, () => {
    const records = {...green}; delete records[family];
    const result = run(records);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Nightly full CI did not pass/);
  });
}
test('nightly refuses an extra workflow rather than silently omitting its result', () => {
  const result = run({...green, unexpected: {result: 'failure'}});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected nightly workflow/);
});
