import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {receiptSuites} from './ci-scope.mjs';

export function assertReceiptSuites(receipts) {
  assert.ok(Array.isArray(receipts) && receipts.length > 0, 'Missing selected receipt suites');
  assert.equal(new Set(receipts).size, receipts.length, 'Duplicate selected receipt suite');
  for (const suite of receipts) assert.ok(receiptSuites.includes(suite), `Unknown receipt suite: ${suite}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {receipts} = JSON.parse(process.env.CI_PLAN);
    assertReceiptSuites(receipts);
    const concurrency = process.env.CI_RECEIPT_CONCURRENCY ?? '1';
    assert.ok(concurrency === '1' || concurrency === '2', 'Invalid receipt concurrency');
    let failed = false;
    let next = 0;
    // Finish the selected checks so one failure cannot hide another suite's result.
    const worker = async () => { while (next < receipts.length) {
      const suite = receipts[next++];
      console.log(`::group::${suite}`);
      const started = performance.now();
      const result = await new Promise(resolve => {
        const child = spawn('pnpm', [suite], {stdio: 'inherit'});
        child.once('error', error => resolve({error}));
        child.once('close', (status, signal) => resolve({status, signal}));
      });
      const passed = !result.error && result.status === 0;
      console.log(`Receipt ${suite}: ${passed ? 'PASS' : 'FAIL'} (${Math.round(performance.now() - started)} ms)`);
      console.log('::endgroup::');
      if (!passed) {
        failed = true;
        console.error(`Receipt ${suite} failed: ${result.error?.message ?? result.signal ?? result.status}`);
      }
    }};
    await Promise.all(Array.from({length: Math.min(Number(concurrency), receipts.length)}, worker));
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
