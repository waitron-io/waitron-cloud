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

const ownedStopPath = '/owned/PRIVATE_CANARY.db';
const ack = (reply = { status: 'stopped', path: ownedStopPath, txid: 0 }) => ({ statusCode: 200,
  ownedPath: ownedStopPath, body: Buffer.from(JSON.stringify(reply)) });
const afterStopSession = clock => stream.createLitestreamAfterStop({ clock: clock ?? (() => 0) });
const issued = (ordinal = 0, operation = 'list') => ({ invocation: id, ordinal, operation });
const admitted = (hop, ordinal = 0, operation = 'list') => ({ ...issued(ordinal, operation), hop, phase: 'workload' });
const settled = (channel, { ordinal = 0, operation = 'list', ...changes } = {}) => ({ token: `${id}:${ordinal + 1}`,
  channel, phase: 'workload', operation, retryOrdinal: ordinal, outcome: 'success', statusCode: 200,
  errorCode: null, sameAccount: null, bytesIn: 4, bytesOut: 0, attemptedBytesIn: 4, attemptedBytesOut: 0, ...changes });
const knownInterruption = () => ({ reason: 'transfer-interrupted', ioEvent: 'response-pipeline',
  code: 'ERR_STREAM_UNABLE_TO_PIPE', clientClosed: true, responseHeadersSeen: true });
function startAttempt(session, operation = 'list') {
  session.issue(issued(0, operation)); session.admit(admitted('producer', 0, operation)); session.admit(admitted('observer', 0, operation));
}

// Weakening any acknowledgement check would authorize the exception without the runtime boundary.
for (const [label, input] of [
  ['status', { ...ack(), statusCode: 201 }],
  ['already stopped', ack({ status: 'already_stopped', path: ownedStopPath, txid: 0 })],
  ['wrong path', ack({ status: 'stopped', path: '/other/PRIVATE_CANARY.db', txid: 0 })],
  ['negative txid', ack({ status: 'stopped', path: ownedStopPath, txid: -1 })],
  ['unsafe txid', ack({ status: 'stopped', path: ownedStopPath, txid: Number.MAX_SAFE_INTEGER + 1 })],
  ['fractional txid', ack({ status: 'stopped', path: ownedStopPath, txid: 0.5 })],
  ['string txid', ack({ status: 'stopped', path: ownedStopPath, txid: '0' })],
  ['missing key', ack({ status: 'stopped', path: ownedStopPath })],
  ['extra key', ack({ status: 'stopped', path: ownedStopPath, txid: 0, private: 'PRIVATE_CANARY' })],
  ['malformed JSON', { ...ack(), body: Buffer.from('{') }],
  ['oversized', { ...ack(), body: Buffer.concat([ack().body, Buffer.alloc(1024, ' ')]) }],
  ['unknown envelope', { ...ack(), private: 'PRIVATE_CANARY' }],
]) test(`after-stop acknowledgement refuses ${label} and poisons the session`, () => {
  const session = afterStopSession();
  assert.throws(() => session.acknowledgeStop(input), /Invalid cloud cost Litestream audit/);
  assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
});

test('after-stop boundary is one-way and cannot be moved or configured to forgive more attempts', () => {
  assert.throws(() => stream.createLitestreamAfterStop({ clock: () => 0, cap: 100 }), /Invalid cloud cost Litestream audit/);
  const session = afterStopSession(); session.acknowledgeStop(ack());
  assert.throws(() => session.acknowledgeStop(ack()), /Invalid cloud cost Litestream audit/);
  assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
});

// Equal timestamps use event order; a backwards clock or changed phase must refuse evidence.
for (const action of ['backwards-clock', 'duplicate-issue', 'duplicate-admission', 'duplicate-settlement', 'unknown-hop',
  'missing-producer', 'missing-issue', 'wrong-operation', 'wrong-phase', 'ordinal-reset', 'private-field', 'unknown-outcome', 'invalid-status'])
  test(`after-stop correlation cannot accept ${action}`, () => {
    let now = 1; const session = afterStopSession(() => now);
    if (action !== 'missing-issue') session.issue(issued());
    const run = () => {
      if (action === 'backwards-clock') now = 0;
      if (action === 'duplicate-issue') return session.issue(issued());
      if (action === 'unknown-hop') return session.admit({ ...admitted('producer'), hop: 'PRIVATE_CANARY' });
      if (action === 'missing-producer') return session.admit(admitted('observer'));
      if (action === 'private-field') return session.admit({ ...admitted('producer'), private: 'PRIVATE_CANARY' });
      session.admit(admitted('producer'));
      if (action === 'duplicate-admission') return session.admit(admitted('producer'));
      if (action === 'wrong-operation') return session.admit(admitted('observer', 0, 'get'));
      if (action === 'wrong-phase') return session.admit({ ...admitted('observer'), phase: 'idle' });
      if (action === 'ordinal-reset') return session.admit(admitted('producer', 2));
      session.admit(admitted('observer'));
      if (action === 'unknown-outcome') return session.settle(settled('producer', { outcome: 'PRIVATE_CANARY' }));
      if (action === 'invalid-status') return session.settle(settled('producer', { statusCode: 503 }));
      session.settle(settled('producer')); session.settle(settled('observer'));
      if (action === 'duplicate-settlement') return session.settle(settled('producer'));
      return session.snapshot();
    };
    assert.throws(run, /Invalid cloud cost Litestream audit/);
    assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
  });

// The exception is a closed signature, not permission to ignore arbitrary I/O failure.
for (const [label, change] of [['event', { ioEvent: 'response-aborted' }], ['code', { code: 'ECONNRESET' }],
  ['reason', { reason: 'upstream-error' }], ['client open', { clientClosed: false }], ['no headers', { responseHeadersSeen: false }],
  ['extra key', { private: 'PRIVATE_CANARY' }]]) test(`after-stop interrupted list refuses unrelated ${label}`, () => {
    const session = afterStopSession(); startAttempt(session); session.acknowledgeStop(ack());
    assert.throws(() => session.settle(settled('producer', { outcome: 'transport-error' }), { ...knownInterruption(), ...change }), /Invalid cloud cost Litestream audit/);
    assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
  });

// Buffering SDK logs cannot backdate a real storage admission; identities must still pair by completion.
test('late SDK log arrival cannot relabel an admitted list or create an extra counted hop', () => {
  const session = afterStopSession(); session.admit(admitted('producer')); session.admit(admitted('observer'));
  session.acknowledgeStop(ack()); session.issue(issued());
  session.settle(settled('producer')); session.settle(settled('observer'));
  assert.equal(session.snapshot().used, 0);
});

for (const changes of [{ errorCode: 'PRIVATE_CANARY' }, { sameAccount: 'PRIVATE_CANARY' }, { bytesOut: -1 },
  { attemptedBytesIn: 3 }]) test(`after-stop event refuses invalid public counter metadata ${Object.keys(changes)[0]}`, () => {
    const session = afterStopSession(); startAttempt(session);
    assert.throws(() => session.settle(settled('producer', changes)), /Invalid cloud cost Litestream audit/);
    assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
  });

// A response fragment is an observed byte, not proof of full-body equality or a second affected attempt.
for (const count of [3, 4]) test(`after-stop list settlements share the admission cap and retain fragments: ${count}`, () => {
  const session = afterStopSession();
  for (let n = 1; n <= count; n++) {
    const invocation = `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
    session.issue({ ...issued(), invocation });
    for (const hop of ['producer', 'observer']) session.admit({ ...admitted(hop), invocation });
  }
  session.acknowledgeStop(ack());
  for (let n = 1; n <= count; n++) {
    const token = `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555:1`;
    session.settle({ ...settled('observer'), token });
    const finish = () => session.settle({ ...settled('producer', { outcome: 'transport-error', bytesIn: 2 }), token }, knownInterruption());
    if (n === 4) {
      assert.throws(finish, /Invalid cloud cost Litestream audit/);
      assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
    } else finish();
  }
  if (count === 3) {
    const result = session.snapshot();
    assert.equal(result.used, 3); assert.equal(result.lateAdmissions, 0); assert.equal(result.lateSettlements, 3);
    assert.deepEqual(result.producer, { attempts: 3, bytesIn: 6, bytesOut: 0 });
    assert.deepEqual(result.observer, { attempts: 3, bytesIn: 12, bytesOut: 0 });
    assert.equal(result.requests.find(r => r.hop === 'producer').attemptedBytesIn, 12);
    assert.equal(result.bodiesReconciled, false); assert.equal(result.status, 'unknown');
  }
});

test('late admission and interrupted settlement count the same SDK attempt only once', () => {
  const session = afterStopSession(); session.acknowledgeStop(ack()); startAttempt(session);
  session.settle(settled('observer'));
  session.settle(settled('producer', { outcome: 'transport-error' }), knownInterruption());
  const result = session.snapshot();
  assert.equal(result.used, 1); assert.equal(result.lateAdmissions, 1); assert.equal(result.lateSettlements, 1);
  assert.equal(result.bodiesReconciled, false, 'equal fragments still do not prove a complete response');
});

for (const invalid of ['missing storage admission', 'observer interruption', 'changed settlement phase'])
  test(`after-stop settlement refuses ${invalid} immediately`, () => {
    const session = afterStopSession(); session.issue(issued()); session.admit(admitted('producer'));
    if (invalid !== 'missing storage admission') session.admit(admitted('observer'));
    session.acknowledgeStop(ack());
    const input = invalid === 'changed settlement phase' ? settled('producer', { phase: 'idle' })
      : settled(invalid === 'observer interruption' ? 'observer' : 'producer', { outcome: 'transport-error' });
    assert.throws(() => session.settle(input, invalid === 'changed settlement phase' ? null : knownInterruption()), /Invalid cloud cost Litestream audit/);
    assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
  });

test('changing phases cannot reset the one session allowance', () => {
  const session = afterStopSession(); session.acknowledgeStop(ack());
  for (const [index, phase] of ['startup', 'workload', 'idle', 'verification'].entries()) {
    const invocation = `${String(index + 1).padStart(8, '0')}-2222-4333-8444-555555555555`, token = invocation + ':1';
    session.issue({ ...issued(), invocation }); session.admit({ ...admitted('producer'), invocation, phase });
    if (index === 3) {
      assert.throws(() => session.admit({ ...admitted('observer'), invocation, phase }), /Invalid cloud cost Litestream audit/);
      assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
    } else {
      session.admit({ ...admitted('observer'), invocation, phase });
      for (const channel of ['producer', 'observer']) session.settle({ ...settled(channel), token, phase });
    }
  }
});

test('after-stop aggregate refuses byte totals that no longer fit a safe integer', () => {
  const session = afterStopSession(); session.acknowledgeStop(ack());
  for (let n = 1; n <= 2; n++) {
    const invocation = `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`, token = invocation + ':1';
    session.issue({ ...issued(), invocation });
    for (const hop of ['producer', 'observer']) session.admit({ ...admitted(hop), invocation });
    for (const channel of ['producer', 'observer']) session.settle({ ...settled(channel, {
      bytesIn: Number.MAX_SAFE_INTEGER, attemptedBytesIn: Number.MAX_SAFE_INTEGER }), token });
  }
  assert.throws(() => session.snapshot(), /Invalid cloud cost Litestream audit/);
});

const putCommit = (changes = {}) => ({ token: `${id}:1`, statusCode: 200, bytesOut: 4, expectedBytesOut: 4,
  requestComplete: true, versionId: null, deleteMarker: null, ...changes });
const putSettlement = (hop, changes = {}) => settled(hop, { operation: 'put', bytesOut: 4, attemptedBytesOut: 4, ...changes });
// Recording ordinary retry success must not activate the shutdown exception or alter strict counts.
test('ordinary successful retry can retain backend evidence before stop without consuming the cap', () => {
  const s = afterStopSession(); startAttempt(s, 'put');
  for (const hop of ['producer', 'observer']) s.settle(putSettlement(hop, { statusCode: 503, outcome: 'server-error' }));
  s.issue(issued(1, 'put'));
  for (const hop of ['producer', 'observer']) s.admit(admitted(hop, 1, 'put'));
  s.commit(putCommit({ token: `${id}:2` }));
  for (const hop of ['producer', 'observer']) s.settle(putSettlement(hop, { ordinal: 1 }));
  assert.equal(s.snapshot().used, 0); assert.equal(s.snapshot().status, 'measured');
});
for (const mode of ['second-upload', 'retry', 'uncommitted', 'partial-settlement', 'pre-ack-interruption', 'wrong-signature']) {
  test(`prior PUT completion remains bounded: ${mode}`, () => {
    const s = afterStopSession(); startAttempt(s, 'put');
    if (mode === 'retry') {
      for (const hop of ['producer', 'observer']) s.settle(putSettlement(hop, { outcome: 'server-error', statusCode: 503 }));
      s.issue(issued(1, 'put')); for (const hop of ['producer', 'observer']) s.admit(admitted(hop, 1, 'put'));
    }
    const ordinal = mode === 'retry' ? 1 : 0;
    if (mode !== 'uncommitted') s.commit(putCommit({ token: `${id}:${ordinal + 1}` }));
    if (mode === 'second-upload') {
      const invocation = id.replace('11111111', '22222222');
      s.issue({ ...issued(0, 'put'), invocation });
      for (const hop of ['producer', 'observer']) s.admit({ ...admitted(hop, 0, 'put'), invocation });
      s.commit(putCommit({ token: `${invocation}:1` }));
    }
    if (mode !== 'pre-ack-interruption') s.acknowledgeStop(ack());
    const run = () => {
      if (mode === 'second-upload') {
        for (const hop of ['producer', 'observer']) s.settle(putSettlement(hop));
        return s.settle(putSettlement('producer', { token: id.replace('11111111', '22222222') + ':1' }));
      }
      const interrupted = ['pre-ack-interruption', 'wrong-signature'].includes(mode);
      return s.settle(putSettlement('producer', { ordinal, ...(mode === 'partial-settlement' ? { bytesOut: 3 } : {}),
        ...(interrupted ? { outcome: 'transport-error' } : {}) }), interrupted
        ? { ...knownInterruption(), ...(mode === 'wrong-signature' ? { code: 'ECONNRESET' } : {}) } : null);
    };
    assert.throws(run, /Invalid cloud cost Litestream audit/);
    assert.throws(() => s.snapshot(), /Invalid cloud cost Litestream audit/);
  });
}

// A PUT response marked as a delete marker is not a successful object-version witness.
test('after-stop PUT cannot erase a conflicting delete-marker response while normalizing its commit', () => {
  const s = afterStopSession(); startAttempt(s, 'put');
  const finish = s.beginLifetime({ headers: headers(), operation: 'put', versioned: true });
  s.commit(putCommit({ versionId: 'COMMIT_PRIVATE_CANARY' })); s.acknowledgeStop(ack());
  s.settle(putSettlement('producer'));
  assert.throws(() => finish({ statusCode: 200, bytesOut: 4, interrupted: false,
    responseHeaders: { 'x-amz-version-id': 'COMMIT_PRIVATE_CANARY', 'x-amz-delete-marker': 'true' } }), /Invalid cloud cost Litestream audit/);
});

for (const [label, change] of [
  ['unfinished request', { requestComplete: false }], ['partial body', { bytesOut: 3 }],
  ['unsafe byte count', { bytesOut: Number.MAX_SAFE_INTEGER + 1, expectedBytesOut: Number.MAX_SAFE_INTEGER + 1 }],
  ['negative byte count', { bytesOut: -1, expectedBytesOut: -1 }], ['failed status', { statusCode: 503 }],
  ['fractional status', { statusCode: 200.5 }], ['null status', { statusCode: null }],
  ['unknown identity', { token: '22222222-2222-4333-8444-555555555555:1' }],
  ['malformed identity', { token: 'PRIVATE_CANARY' }], ['empty version', { versionId: '' }],
  ['private control character', { versionId: 'PRIVATE\nCANARY' }], ['oversized version', { versionId: 'x'.repeat(1025) }],
  ['delete marker', { deleteMarker: 'true' }], ['unexpected marker', { deleteMarker: false }],
  ['unknown field', { PRIVATE_CANARY: true }],
]) test(`backend commit witness refuses ${label}`, () => {
  const s = afterStopSession(); startAttempt(s, 'put');
  assert.throws(() => s.commit(putCommit(change)), /Invalid cloud cost Litestream audit/);
  assert.throws(() => s.snapshot(), /Invalid cloud cost Litestream audit/);
});
for (const mode of ['missing-observer', 'wrong-operation', 'duplicate']) test(`commit witnesses cannot invent or replace an upload: ${mode}`, () => {
  const s = afterStopSession(), operation = mode === 'wrong-operation' ? 'list' : 'put';
  s.issue(issued(0, operation)); s.admit(admitted('producer', 0, operation));
  if (mode !== 'missing-observer') s.admit(admitted('observer', 0, operation));
  if (mode === 'duplicate') s.commit(putCommit());
  assert.throws(() => s.commit(putCommit()), /Invalid cloud cost Litestream audit/);
});
for (const mode of ['twice', 'unsettled', 'wrong-bytes', 'wrong-status', 'wrong-interruption', 'wrong-version', 'unexpected-version']) {
  test(`lifetime completion stays paired to its own producer and version: ${mode}`, () => {
    const s = afterStopSession(); startAttempt(s, 'put');
    const finish = s.beginLifetime({ headers: headers(), operation: 'put', versioned: mode !== 'unexpected-version' });
    s.commit(putCommit({ versionId: 'COMMIT_PRIVATE_CANARY' })); s.acknowledgeStop(ack());
    if (mode !== 'unsettled') s.settle(putSettlement('producer'));
    const event = { statusCode: mode === 'wrong-status' ? 201 : 200, bytesOut: mode === 'wrong-bytes' ? 3 : 4,
      interrupted: mode === 'wrong-interruption', responseHeaders: { 'x-amz-version-id': mode === 'wrong-version' ? 'OTHER_PRIVATE_CANARY' : 'COMMIT_PRIVATE_CANARY' } };
    if (mode === 'twice') finish(event);
    assert.throws(() => finish(event), /Invalid cloud cost Litestream audit/);
    assert.throws(() => s.snapshot(), /Invalid cloud cost Litestream audit/);
  });
}
// Both hops share one late PUT allowance and that allowance shares the existing three-attempt cap.
for (const listCount of [2, 3]) test(`late committed PUT and lists share the distinct-attempt cap: lists=${listCount}`, () => {
  const s = afterStopSession(); startAttempt(s, 'put'); s.commit(putCommit()); s.acknowledgeStop(ack());
  for (const hop of ['producer', 'observer']) s.settle(putSettlement(hop));
  for (let n = 0; n < listCount; n++) {
    const invocation = `${String(n + 2).padStart(8, '0')}-2222-4333-8444-555555555555`;
    s.issue({ ...issued(), invocation }); s.admit({ ...admitted('producer'), invocation });
    const admit = () => s.admit({ ...admitted('observer'), invocation });
    if (n === 2) { assert.throws(admit, /Invalid cloud cost Litestream audit/); return; }
    admit(); for (const hop of ['producer', 'observer']) s.settle({ ...settled(hop), token: `${invocation}:1` });
  }
  assert.equal(s.snapshot().used, 3); assert.equal(s.snapshot().lateAdmissions, 2); assert.equal(s.snapshot().lateSettlements, 1);
  assert.equal(s.snapshot().bodiesReconciled, true);
});

for (const mode of ['changed-status', 'changed-request-length']) test(`a late committed PUT must agree with the backend response and complete body: ${mode}`, () => {
  const s = afterStopSession(); startAttempt(s, 'put'); s.commit(putCommit()); s.acknowledgeStop(ack());
  assert.throws(() => s.settle(putSettlement('producer', { outcome: 'transport-error',
    ...(mode === 'changed-status' ? { statusCode: 201 } : { attemptedBytesOut: 5 }) }), knownInterruption()), /Invalid cloud cost Litestream audit/);
});

// Read lifetimes still correlate their actual request bytes, even though they mutate no objects.
test('interrupted list lifetime cannot claim body bytes absent from its producer counter', () => {
  const s = afterStopSession(); startAttempt(s);
  const finish = s.beginLifetime({ headers: headers(), operation: 'list', versioned: false });
  s.acknowledgeStop(ack()); s.settle(settled('producer', { outcome: 'transport-error' }), knownInterruption());
  assert.throws(() => finish({ statusCode: 200, bytesOut: 1, interrupted: true }), /Invalid cloud cost Litestream audit/);
});
for (const versionId of [null, 'null']) test(`versioned lifetime cannot use an unknown backend version as a commit: ${typeof versionId}:${versionId}`, () => {
  const s = afterStopSession(); startAttempt(s, 'put');
  const finish = s.beginLifetime({ headers: headers(), operation: 'put', versioned: true });
  s.commit(putCommit({ versionId })); s.acknowledgeStop(ack()); s.settle(putSettlement('producer'));
  assert.throws(() => finish({ statusCode: 200, bytesOut: 4, interrupted: false }), /Invalid cloud cost Litestream audit/);
});

test('a bound versioned lifetime cannot be changed into an unversioned reader by mutating its input', () => {
  const s = afterStopSession(); startAttempt(s, 'put');
  const input = { headers: headers(), operation: 'put', versioned: true };
  const finish = s.beginLifetime(input); input.versioned = false;
  s.commit(putCommit()); s.acknowledgeStop(ack()); s.settle(putSettlement('producer'));
  assert.throws(() => finish({ statusCode: 200, bytesOut: 4, interrupted: false }), /Invalid cloud cost Litestream audit/);
});
