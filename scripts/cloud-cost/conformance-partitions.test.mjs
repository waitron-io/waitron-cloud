import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {conformanceMatrix, runTests} from './conformance.mjs';

const cases = [
  ['isolatedControllerRunsTheGenuineWriterAfterIsolationThenCollectsItsOwnState', 0],
  ['isolatedControllerFutureCheck', 0],
  ['isolatedHostStreamsTheCompleteGeneratedDayAndCollectsStorageBeforeReturning', 1],
  ['streamResultReporterKeepsTheActualMissedBoundaryAssertionAfterAGenuineCopyRefusal', 1],
  ['isolatedHostFutureCheck', 1],
  ['localCommandPublishesClosedStreamReceiptAfterOwnedCleanup', 2],
  ['localReceiptRefusesClockJump_-10000', 2],
  ['workerFailureDiagnosticNeverBypassesTheExistingNoLinksOwnershipCheck', 2],
  ['isolatedRefusalRetainsTraceWhenACompletedWorkerResultIsRejected', 2],
  ['futureReplayCheck', 2],
];
const groups = () => conformanceMatrix().filter(row => row.file === 'isolated-replay-conformance.test.mjs');

test('isolated replay partitions assign current and future case families exactly once', () => {
  const rows = groups();
  assert.equal(rows.length, 3, 'the long fixture must be split across three work jobs');
  assert.deepEqual(rows.map(row => row.group), ['1/3', '2/3', '3/3']);
  for (const [name, expected] of cases) {
    const selected = rows.flatMap((row, index) => new RegExp(row.pattern).test(name)
      && !(row.skipPattern && new RegExp(row.skipPattern).test(name)) ? [index] : []);
    assert.deepEqual(selected, [expected], name);
  }
});

test('each isolated replay partition executes only its cases in the real Node runner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-isolated-partitions-'));
  try {
    const file = join(root, 'isolated-replay-conformance.test.mjs');
    writeFileSync(file, "import {test} from 'node:test';\n" + cases.map(([name]) =>
      `test(${JSON.stringify(name)}, () => console.log(${JSON.stringify('executed:' + name)}));`).join('\n'));
    const rows = groups();
    assert.equal(rows.length, 3);
    for (let index = 0; index < rows.length; index++) {
      const {pattern, skipPattern} = rows[index];
      const result = await runTests([file], {pattern, skipPattern, stdio: 'pipe'});
      assert.equal(result.code, 0, result.output);
      const actual = [...result.output.matchAll(/executed:([^\r\n]+)/g)].map(match => match[1]);
      assert.deepEqual(actual, cases.filter(([, expected]) => expected === index).map(([name]) => name));
    }
  } finally { rmSync(root, {recursive: true, force: true}); }
});
