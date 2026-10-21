import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as stream from './litestream.mjs';
const id = '11111111-2222-4333-8444-555555555555';
const log = ({ invocation = id, attempt = 1, method = 'PUT', path = '/private-bucket/PRIVATE_CANARY', extra = '' } = {}) =>
  `SDK 2026/10/18 07:00:00 DEBUG Request\n${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1:8333\r\nAmz-Sdk-Invocation-Id: ${invocation}\r\nAmz-Sdk-Request: attempt=${attempt}; max=10\r\nAuthorization: PRIVATE_CANARY\r\n${extra}\r\n`;
const headers = (attempt = 1) => ({ 'amz-sdk-invocation-id': id, 'amz-sdk-request': `attempt=${attempt}; max=10` });
function audit() {
  assert.equal(typeof stream.createLitestreamRequestAudit, 'function', 'audit pinned binary requests independently of proxy events');
  return stream.createLitestreamRequestAudit({ phase: 'workload' });
}
// Missing producer capture, retries, or a shared observer-derived producer makes these literal totals wrong.
test('independentLitestreamHeaderStreamReconcilesPhysicalRetriesWithoutClaimingBytes', () => {
  const a = audit();
  for (const byte of Buffer.from(log() + log({ attempt: 2 }))) a.write(Buffer.from([byte]));
  a.observe({ headers: headers(), operation: 'put' }); a.observe({ headers: headers(2), operation: 'put' }); a.end();
  assert.deepEqual(a.snapshot(), { requestsReconciled: true, status: 'unknown', producerAttempts: 2, observerAttempts: 2,
    requests: [{ phase: 'workload', operation: 'put', retryOrdinal: 0, attempts: 1 },
      { phase: 'workload', operation: 'put', retryOrdinal: 1, attempts: 1 }],
    gaps: ['litestream:body-bytes-unpaired', 'litestream:object-lifetimes-unpaired'] });
  assert.equal(JSON.stringify(a.snapshot()).includes('PRIVATE_CANARY'), false);
});
// A missing producer log is a discrepancy even when the network observer saw a valid request.
test('observerEventsNeverCreateLitestreamProducerConfirmation', () => {
  const a = audit(); a.observe({ headers: headers(), operation: 'put' }); a.end();
  assert.equal(a.snapshot().requestsReconciled, false); assert.equal(a.snapshot().producerAttempts, 0);
  assert.ok(a.snapshot().gaps.includes('litestream:requests-unreconciled'));
});
// Equal totals cannot hide a misclassified operation or a lost retry.
test('equalCountsWithWrongLitestreamOperationOrRetryRemainUnreconciled', () => {
  for (const observed of [{ headers: headers(), operation: 'get' }, { headers: headers(2), operation: 'put' }]) {
    const a = audit(); a.write(Buffer.from(log())); a.observe(observed); a.end();
    assert.equal(a.snapshot().requestsReconciled, false);
  }
});
// Duplicate/truncated headers, unsupported operations and overflowing logs must poison all later evidence.
test('malformedAndTruncatedLitestreamLogsCannotProduceValidEvidence', () => {
  for (const text of [log({ extra: 'Amz-Sdk-Invocation-Id: ' + id + '\r\n' }), log({ attempt: 2 }),
    log({ method: 'POST', path: '/private-bucket?delete' }), log().replace('attempt=1', 'attempt=0'),
    log().replace('max=10', 'max=0'), log().slice(0, -2), 'x'.repeat(65537)]) {
    const a = audit();
    assert.throws(() => { a.write(Buffer.from(text)); a.end(); a.snapshot(); }, /Invalid cloud cost Litestream audit/);
    assert.throws(() => a.snapshot(), /Invalid cloud cost Litestream audit/);
  }
});
// Duplicate network callbacks or forged/missing IDs cannot be hidden by aggregation.
test('malformedOrDuplicateLitestreamObserverEvidenceIsRefused', () => {
  for (const value of [{ headers: {}, operation: 'put' }, { headers: headers(), operation: 'copy' },
    { headers: { ...headers(), 'amz-sdk-request': ['attempt=1; max=10'] }, operation: 'put' }]) {
    const a = audit(); assert.throws(() => a.observe(value), /Invalid cloud cost Litestream audit/);
    assert.throws(() => a.snapshot(), /Invalid cloud cost Litestream audit/);
  }
  const a = audit(); a.observe({ headers: headers(), operation: 'put' });
  assert.throws(() => a.observe({ headers: headers(), operation: 'put' }), /Invalid cloud cost Litestream audit/);
});
// Listing requests can omit x-id; classify their HTTP shape independently from the proxy.
test('litestreamAuditClassifiesGetHeadListAndMultipartWithoutPublishingPaths', () => {
  const cases = [['GET', '/bucket?list-type=2&prefix=PRIVATE_CANARY', 'list'], ['GET', '/bucket/private', 'get'],
    ['HEAD', '/bucket/private', 'head'], ['DELETE', '/bucket/private', 'delete'],
    ['POST', '/bucket/private?uploads=', 'multipart-create'], ['PUT', '/bucket/private?uploadId=x&partNumber=1', 'multipart-upload'],
    ['POST', '/bucket/private?uploadId=x', 'multipart-complete'], ['DELETE', '/bucket/private?uploadId=x', 'multipart-abort']];
  for (const [method, path, operation] of cases) {
    const a = audit(); a.write(Buffer.from(log({ method, path }))); a.observe({ headers: headers(), operation }); a.end();
    assert.equal(a.snapshot().requestsReconciled, true, operation);
    assert.equal(a.snapshot().requests[0].operation, operation);
    assert.equal(JSON.stringify(a.snapshot()).includes('PRIVATE_CANARY'), false);
  }
});
// In-flight or empty streams cannot become a completed measured run, and finalized audits are immutable.
test('litestreamAuditRequiresEndAndNonemptyEvidenceAndRefusesLaterWrites', () => {
  const a = audit(); a.write(Buffer.from(log()));
  assert.throws(() => a.snapshot(), /Invalid cloud cost Litestream audit/);
  const empty = audit(); empty.end(); assert.equal(empty.snapshot().requestsReconciled, false);
  const b = audit(); b.end(); assert.throws(() => b.write(Buffer.from(log())), /Invalid cloud cost Litestream audit/);
  const c = audit(); c.end(); assert.throws(() => c.observe({ headers: headers(), operation: 'put' }), /Invalid cloud cost Litestream audit/);
});

// Actual pinned Go PutObject/GetObject serializers add x-id; a mismatched hint must still be refused.
test('pinnedGoOperationHintsMustAgreeWithTheIndependentRequestShape', () => {
  for (const [method, path, name] of [['PUT', '/bucket/private?x-id=PutObject', 'put'],
    ['GET', '/bucket/private?x-id=GetObject', 'get'],
    ['PUT', '/bucket/private?partNumber=1&uploadId=x&x-id=UploadPart', 'multipart-upload']]) {
    const a = audit(); a.write(Buffer.from(log({ method, path }))); a.observe({ headers: headers(), operation: name }); a.end();
    assert.equal(a.snapshot().requestsReconciled, true);
  }
  for (const path of ['/bucket/private?x-id=GetObject', '/bucket/private?x-id=CopyObject']) {
    const a = audit(); assert.throws(() => a.write(Buffer.from(log({ path }))), /Invalid cloud cost Litestream audit/);
  }
});

// An invalid call after finalization must invalidate previously valid evidence, not return the saved success.
test('finalizedLitestreamEvidenceIsPoisonedAfterMisuse', () => {
  const a = audit(); a.write(Buffer.from(log())); a.observe({ headers: headers(), operation: 'put' }); a.end();
  assert.equal(a.snapshot().requestsReconciled, true);
  assert.throws(() => a.write(Buffer.from('x')), /Invalid cloud cost Litestream audit/);
  assert.throws(() => a.snapshot(), /Invalid cloud cost Litestream audit/);
});

// Validate a partial line immediately and validate max attempts even when sequence ordering is otherwise correct.
test('litestreamPartialLineOverflowAndImpossibleRetryCeilingsAreRejected', () => {
  const a = audit(); assert.throws(() => a.write(Buffer.from('x'.repeat(65537))), /Invalid cloud cost Litestream audit/);
  const b = audit(); b.write(Buffer.from(log()));
  assert.throws(() => b.write(Buffer.from(log({ attempt: 2 }).replace('max=10', 'max=1'))), /Invalid cloud cost Litestream audit/);
  const c = audit(); assert.throws(() => c.write(Buffer.from(log({ method: 'POST' }))), /Invalid cloud cost Litestream audit/);
});

test('nativeDeletionBatchHeaderAuditRequiresIndependentOptInAndMatchingSdkHint', () => {
  const path = '/synthetic/?delete=&x-id=DeleteObjects';
  const a = stream.createLitestreamRequestAudit({ phase: 'workload', allowBulkDeletes: true });
  a.write(Buffer.from(log({ method: 'POST', path }))); a.observe({ headers: headers(), operation: 'delete-many' }); a.end();
  assert.equal(a.snapshot().requestsReconciled, true);
  assert.deepEqual(a.snapshot().requests, [{ phase: 'workload', operation: 'delete-many', retryOrdinal: 0, attempts: 1 }]);
  for (const options of [{}, { allowBulkDeletes: true }]) {
    const b = stream.createLitestreamRequestAudit({ phase: 'workload', ...options });
    assert.throws(() => b.write(Buffer.from(log({ method: 'POST', path: options.allowBulkDeletes ? path.replace('DeleteObjects', 'DeleteObject') : path }))), /Invalid cloud cost Litestream audit/);
  }
});
