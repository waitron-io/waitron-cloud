import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as checks from './litestream-smoke-test-utils.mjs';
import { readFileSync } from 'node:fs';

function evidence(interrupted = false) {
  const row = (outcome, bytesIn) => ({ phase: 'workload', operation: 'list', retryOrdinal: 0, outcome,
    attempts: 1, bytesIn, bytesOut: 0, attemptedBytesIn: 8, attemptedBytesOut: 0 });
  const producer = row(interrupted ? 'transport-error' : 'success', interrupted ? 2 : 8), observer = row('success', 8);
  const totals = r => ({ attempts: 3, bytesIn: r.bytesIn + 20, bytesOut: 40 });
  const proof = { reconciled: !interrupted, status: interrupted ? 'unknown' : 'measured',
    gaps: interrupted ? ['accounting:unreconciled', 'request-billing:unknown', 'after-stop:list-response-interrupted'] : [],
    billing: [{ quantity: interrupted ? null : 3, status: interrupted ? 'unknown' : 'measured' }],
    accounting: { producer: totals(producer), observer: totals(observer),
      discrepancy: { attempts: 0, bytesIn: interrupted ? 6 : 0, bytesOut: 0 },
      requests: [producer, { ...row('success', 20), operation: 'put', attempts: 2, bytesOut: 40 }],
    }, observedRequests: [observer, { ...row('success', 20), operation: 'put', attempts: 2, bytesOut: 40 }] };
  const afterStop = { cap: 3, used: 1, lateAdmissions: interrupted ? 0 : 1, lateSettlements: interrupted ? 1 : 0,
    producer: { attempts: 1, bytesIn: producer.bytesIn, bytesOut: 0 }, observer: { attempts: 1, bytesIn: 8, bytesOut: 0 },
    requests: [{ hop: 'producer', ...producer }, { hop: 'observer', ...observer }], requestsReconciled: true,
    bodiesReconciled: !interrupted, status: interrupted ? 'unknown' : 'measured',
    gaps: interrupted ? ['after-stop:list-response-interrupted', 'after-stop:body-bytes-unpaired'] : [] };
  return { replication: { requestsReconciled: true, producerAttempts: 3 }, afterStop,
    observed: structuredClone(proof), transport: { replication: proof },
    costAccuracy: { status: 'incomplete', reason: 'after-stop', message: 'Cost may be a few requests short after stop.' } };
}

test('smoke consumers accept paired traffic and retain an interrupted list discrepancy', () => {
  assert.equal(typeof checks.assertSmokeAccounting, 'function', 'the smoke consumer must inspect the separate ledger');
  for (const interrupted of [false, true]) checks.assertSmokeAccounting(evidence(interrupted));
});
for (const [name, mutate] of [
  ['missing ledger', r => delete r.afterStop],
  ['missing caveat', r => delete r.costAccuracy],
  ['false precision', r => r.costAccuracy.status = 'measured'],
  ['changed actual bytes', r => r.afterStop.producer.bytesIn = 8],
  ['fourth attempt', r => r.afterStop.used = 4],
  ['false reconciliation', r => r.transport.replication.reconciled = true],
  ['unrelated byte discrepancy', r => r.observed.accounting.observer.bytesOut++],
  ['moved ordinary outcome', r => r.observed.observedRequests[1].outcome = 'server-error'],
  ['incomplete billing hidden', r => r.observed.billing[0].quantity = 3],
  ['private ledger field', r => r.afterStop.path = 'PRIVATE_CANARY'],
]) test(`smoke consumers reject ${name}`, () => {
  assert.equal(typeof checks.assertSmokeAccounting, 'function');
  const result = evidence(true); mutate(result);
  assert.throws(() => checks.assertSmokeAccounting(result));
});

const forwarding = "res.writeHead(incoming.statusCode, incoming.headers); incoming.on('error', () => res.destroy()); incoming.pipe(res);";
test('the delayed PUT injection really holds successful replies for 1500ms', () => {
  assert.equal(typeof checks.delayLitestreamPutReplies, 'function');
  const source = `let stage = 'prepare'; const version='0.5.17',injectedFailures=1; ${forwarding}
    const result = { version, injectedFailures, stage }; publish(result);`;
  for (const [method, statusCode, delayed] of [['PUT', 200, true], ['PUT', 503, false], ['GET', 200, false]]) {
    let forwarded = 0, timer, output;
    new Function('req', 'incoming', 'res', 'setTimeout', 'publish', checks.delayLitestreamPutReplies(source))(
      { method }, { statusCode, headers: {}, on() {}, pipe() { forwarded++; } }, { writeHead() {} },
      (action, milliseconds) => { timer = { action, milliseconds }; }, result => { output = result; });
    assert.equal(forwarded, delayed ? 0 : 1);
    assert.equal(output.delayedPutReplies, delayed ? 1 : 0);
    if (delayed) { assert.equal(timer.milliseconds, 1500); timer.action(); assert.equal(forwarded, 1); }
    else assert.equal(timer, undefined);
  }
});
test('the delayed PUT injection refuses missing or ambiguous anchors in the real smoke', () => {
  assert.equal(typeof checks.delayLitestreamPutReplies, 'function');
  const source = readFileSync(new URL('./fixtures/litestream-smoke.mjs', import.meta.url), 'utf8');
  assert.doesNotThrow(() => checks.delayLitestreamPutReplies(source));
  for (const anchor of [forwarding, "let stage = 'prepare';", 'const result = { version, injectedFailures,']) {
    assert.throws(() => checks.delayLitestreamPutReplies(source.replace(anchor, '')));
    assert.throws(() => checks.delayLitestreamPutReplies(source + '\n' + anchor));
  }
});
