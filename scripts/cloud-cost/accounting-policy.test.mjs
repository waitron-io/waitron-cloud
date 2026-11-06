import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from './accounting-policy.mjs';
import { createMeter } from './meter.mjs';

const assess = value => {
  assert.equal(typeof policy.assessAccounting, 'function', 'the original-record accounting assessor must exist');
  return policy.assessAccounting(value);
};
const snapshot = (options = {}) => {
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const attempt = { token: 'PRIVATE_TOKEN', phase: 'workload', operation: 'put', retryOrdinal: 0,
    outcome: 'success', statusCode: 200, errorCode: null, sameAccount: true,
    bytesIn: 0, bytesOut: 11, attemptedBytesIn: 0, attemptedBytesOut: 11, ...options };
  meter.observeAttempt({ ...attempt, channel: 'producer' });
  meter.observeAttempt({ ...attempt, channel: 'observer' });
  return meter.snapshot();
};
const local = () => ({ producer: 'local-stream', sources: [
  { scope: 'requests', record: snapshot() },
  { scope: 'restore', record: snapshot({ phase: 'restore', operation: 'get' }) },
  { scope: 'administration', record: snapshot({ phase: 'cleanup', operation: 'delete' }) },
  { scope: 'storage', record: snapshot() },
] });

// Removing scope coverage or trusting transfer status alone must not qualify a cost export.
test('complete original meter coverage qualifies clean local accounting', () => {
  assert.deepEqual(assess(local()), { status: 'measured', gaps: [], publicationEligible: true });
});

for (const producer of ['local-stream', 'archive', 'service', 'remote']) {
  test(`${producer} cannot qualify missing original source coverage`, () => {
    assert.deepEqual(assess({ producer, sources: [] }), {
      status: 'unknown', gaps: ['accounting:incomplete-total'], publicationEligible: false });
  });
}
for (const scope of ['requests', 'restore', 'administration', 'storage']) {
  test(`missing ${scope} coverage forbids local publication`, () => {
    const input = local(); input.sources = input.sources.filter(source => source.scope !== scope);
    assert.equal(assess(input).publicationEligible, false);
  });
}

test('unknownBillingBlocksPublicationWithEqualMeters', () => {
  const input = local(); input.sources[0].record = snapshot({ operation: 'bucket-inspect' });
  assert.equal(input.sources[0].record.status, 'measured');
  assert.equal(input.sources[0].record.reconciled, true);
  assert.deepEqual(assess(input), { status: 'unknown', gaps: ['request-billing:unknown'], publicationEligible: false });
});

test('original gap codes survive even when independent totals agree', () => {
  const input = local(); input.sources[0].record.gaps = ['accounting:request-cutoff'];
  assert.deepEqual(assess(input), { status: 'unknown', gaps: ['accounting:request-cutoff'], publicationEligible: false });
});

test('unknown status without a detailed gap cannot qualify as measured', () => {
  const input = local(); input.sources[0].record.status = 'unknown';
  assert.deepEqual(assess(input), { status: 'unknown', gaps: ['accounting:incomplete-total'], publicationEligible: false });
});

test('unpaired row provenance cannot hide behind equal grand totals', () => {
  const input = local(), record = input.sources[0].record;
  record.reconciled = false;
  record.observedRequests[0].phase = 'idle';
  assert.deepEqual(record.accounting.producer, record.accounting.observer);
  assert.deepEqual(assess(input), { status: 'unknown',
    gaps: ['accounting:meter-disagreement', 'request-billing:unknown'], publicationEligible: false });
});

test('an absent billing witness forbids export despite fully paired body counts', () => {
  const input = local(); input.sources[0].record.billing = [];
  assert.deepEqual(assess(input), { status: 'unknown', gaps: ['request-billing:unknown'], publicationEligible: false });
});

const invalid = value => assert.throws(() => assess(value), { message: 'Invalid cloud cost accounting evidence' });
for (const [name, change] of [
  ['unknown producer', input => { input.producer = 'PRIVATE_PRODUCER'; }],
  ['unknown scope', input => { input.sources[0].scope = 'PRIVATE_SCOPE'; }],
  ['duplicate scope', input => { input.sources.push(input.sources[0]); }],
  ['unneeded scope', input => { input.sources.push({ scope: 'fiscal', record: snapshot() }); }],
  ['eligible summary', input => { input.publicationEligible = true; }],
  ['descriptor flag', input => { input.sources[0].eligible = true; }],
  ['private meter field', input => { input.sources[0].record.headers = 'PRIVATE_CANARY'; }],
  ['private row field', input => { input.sources[0].record.accounting.requests[0].key = 'PRIVATE_CANARY'; }],
  ['private gap', input => { input.sources[0].record.gaps = ['PRIVATE_CANARY']; }],
  ['unknown status', input => { input.sources[0].record.status = 'PRIVATE_STATUS'; }],
  ['wrong operation class', input => { input.sources[0].record.accounting.requests[0].requestClass = 's3-read'; }],
  ['impossible successful count', input => { input.sources[0].record.accounting.requests[0].successful = 0; }],
  ['impossible retry count', input => { input.sources[0].record.accounting.requests[0].retried = 1; }],
  ['impossible attempted bytes', input => { input.sources[0].record.accounting.requests[0].attemptedBytesOut = 0; }],
  ['unsafe individual count', input => { input.sources[0].record.accounting.requests[0].attempts = Number.MAX_SAFE_INTEGER + 1; }],
  ['inconsistent self total', input => { input.sources[0].record.accounting.producer.attempts = 2; }],
  ['inconsistent discrepancy', input => { input.sources[0].record.accounting.discrepancy.attempts = 1; }],
  ['duplicate request row', input => { input.sources[0].record.accounting.requests.push(input.sources[0].record.accounting.requests[0]); }],
  ['duplicate billing row', input => { input.sources[0].record.billing.push(input.sources[0].record.billing[0]); }],
  ['measured null billing', input => { input.sources[0].record.billing[0].quantity = null; }],
  ['billing exceeds attempts', input => { input.sources[0].record.billing[0].quantity = 2; }],
  ['sparse source array', input => { delete input.sources[0]; }],
  ['array private property', input => { input.sources.secret = 'PRIVATE_CANARY'; }],
  ['oversized source array', input => { input.sources = Array(7).fill(input.sources[0]); }],
  ['cyclic record', input => { input.sources[0].record.self = input.sources[0].record; }],
  ['nonplain record', input => { Object.setPrototypeOf(input.sources[0].record, { secret: 'PRIVATE_CANARY' }); }],
]) {
  test(`malformedHarnessEvidenceStillRefuses: ${name}`, () => {
    const input = local(); change(input); invalid(input);
  });
}

test('hostile getters and proxies are refused before running user code', () => {
  let touched = 0;
  for (const place of ['root', 'sources', 'descriptor', 'record', 'row', 'billing']) {
    for (const kind of ['getter', 'proxy']) {
      const input = local();
      const hostile = kind === 'proxy' ? new Proxy({}, {
        get() { touched++; throw Error('PRIVATE_GET'); }, ownKeys() { touched++; throw Error('PRIVATE_KEYS'); },
        getOwnPropertyDescriptor() { touched++; throw Error('PRIVATE_DESCRIPTOR'); },
        getPrototypeOf() { touched++; throw Error('PRIVATE_PROTOTYPE'); },
      }) : Object.defineProperty({}, 'producer', { enumerable: true, get() { touched++; throw Error('PRIVATE_GETTER'); } });
      if (place === 'root') { invalid(hostile); continue; }
      if (place === 'sources') input.sources = hostile;
      if (place === 'descriptor') input.sources[0] = hostile;
      if (place === 'record') input.sources[0].record = hostile;
      if (place === 'row') input.sources[0].record.accounting.requests[0] = hostile;
      if (place === 'billing') input.sources[0].record.billing[0] = hostile;
      invalid(input);
    }
  }
  assert.equal(touched, 0);
});

const history = () => ({ status: 'measured', scope: 'unversioned-object-history', windowSeconds: 2,
  objects: { class: 'stream', bytes: 11, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
  byteSeconds: { low: 11, high: 22 } });
const mail = () => ({ scope: 'captured-mail-operations', status: 'measured', reconciled: true,
  producer: { attempts: 1, accepted: 1, refused: 0, retried: 0 },
  observer: { attempts: 1, accepted: 1, refused: 0 }, discrepancy: { attempts: 0, accepted: 0, refused: 0 },
  operations: [{ action: 'password_changed', outcome: 'accepted', retryOrdinal: 0, attempts: 1 }],
  billing: { quantity: null, status: 'unknown' } });
const remote = () => ({ producer: 'remote', sources: [{ scope: 'remote', record: {
  scope: 'gateway-tcp-stream', audience: 'staff', status: 'measured', reconciled: true,
  producer: { connections: 1, bytesToGateway: 7, bytesFromGateway: 2 },
  observer: { connections: 1, bytesToGateway: 7, bytesFromGateway: 2 },
  discrepancy: { connections: 0, bytesToGateway: 0, bytesFromGateway: 0 }, excludedOverhead: ['ip', 'tcp', 'wireguard'],
} }] });
const service = () => ({ producer: 'service', sources: [...local().sources,
  { scope: 'mail', record: mail() }, { scope: 'fiscal', record: snapshot({ operation: 'fiscal' }) }] });

for (const scope of ['unversioned-put-only', 'unversioned-object-history', 'versioned-object-history']) {
  test(`${scope} retains original lifetime bounds for complete archive accounting`, () => {
    const input = local(); input.producer = 'archive'; input.sources[3].record = { ...history(), scope };
    assert.deepEqual(assess(input), { status: 'measured', gaps: [], publicationEligible: true });
  });
}
test('lifetime uncertainty forbids publication while preserving independently measured requests', () => {
  const input = local(); input.sources[3].record = { ...history(), status: 'unknown',
    gaps: ['accounting:incomplete-history'], byteSeconds: { low: null, high: null } };
  assert.deepEqual(assess(input), { status: 'unknown', gaps: ['accounting:incomplete-history'], publicationEligible: false });
  assert.deepEqual(input.sources[0].record.billing, [{ phase: 'workload', requestClass: 's3-write', quantity: 1, status: 'measured' }]);
});
test('service original mail and fiscal billing stay unknown despite equal meters', () => {
  assert.deepEqual(assess(service()), { status: 'unknown', gaps: ['request-billing:unknown'], publicationEligible: false });
});
for (const scope of ['mail', 'fiscal']) {
  test(`service cannot omit its ${scope} source`, () => {
    const input = service(); input.sources = input.sources.filter(source => source.scope !== scope);
    assert.deepEqual(assess(input), { status: 'unknown',
      gaps: ['accounting:incomplete-total', 'request-billing:unknown'], publicationEligible: false });
  });
}
test('remote original encrypted payload counters qualify only their covered scope', () => {
  assert.deepEqual(assess(remote()), { status: 'measured', gaps: [], publicationEligible: true });
});
test('remote counter disagreement yields unknown accounting without discarding either actual count', () => {
  const input = remote(), record = input.sources[0].record;
  record.observer.bytesFromGateway = 1; record.discrepancy.bytesFromGateway = -1; record.reconciled = false;
  assert.deepEqual(assess(input), { status: 'unknown', gaps: ['accounting:meter-disagreement'], publicationEligible: false });
  assert.equal(record.producer.bytesFromGateway, 2); assert.equal(record.observer.bytesFromGateway, 1);
});
test('remote incomplete totals carry their named gap and cannot qualify export', () => {
  const input = remote(), record = input.sources[0].record;
  record.status = 'unknown'; record.gaps = ['accounting:request-cutoff'];
  record.observer.bytesFromGateway = null; record.discrepancy.bytesFromGateway = null;
  assert.deepEqual(assess(input), { status: 'unknown',
    gaps: ['accounting:incomplete-total', 'accounting:meter-disagreement', 'accounting:request-cutoff'], publicationEligible: false });
});
for (const [name, build, change] of [
  ['private history field', local, input => { input.sources[3].record = { ...history(), key: 'PRIVATE_KEY' }; }],
  ['inverted lifetime bounds', local, input => { input.sources[3].record = history(); input.sources[3].record.byteSeconds.low = 23; }],
  ['negative lifetime', local, input => { input.sources[3].record = history(); input.sources[3].record.windowSeconds = -1; }],
  ['unsafe object count', local, input => { input.sources[3].record = history(); input.sources[3].record.objects.currentVersions = 1.5; }],
  ['private mail action', service, input => { input.sources[4].record.operations[0].action = 'PRIVATE_ACTION'; }],
  ['mail self-total', service, input => { input.sources[4].record.producer.attempts = 2; }],
  ['mail discrepancy', service, input => { input.sources[4].record.discrepancy.accepted = 1; }],
  ['mail duplicate row', service, input => { input.sources[4].record.operations.push(input.sources[4].record.operations[0]); }],
  ['remote audience', remote, input => { input.sources[0].record.audience = 'PRIVATE_AUDIENCE'; }],
  ['remote private overhead', remote, input => { input.sources[0].record.excludedOverhead = ['PRIVATE_HEADER']; }],
  ['remote unsafe count', remote, input => { input.sources[0].record.producer.connections = -1; }],
  ['remote false discrepancy', remote, input => { input.sources[0].record.discrepancy.connections = 1; }],
  ['mail used as a meter', local, input => { input.sources[0].record = mail(); }],
  ['meter used as remote evidence', remote, input => { input.sources[0].record = snapshot(); }],
]) {
  test(`malformed domain evidence refuses: ${name}`, () => { const input = build(); change(input); invalid(input); });
}

test('original overflow snapshots stay unknown while safe rows retain actual quantities', () => {
  const input = local(), meter = createMeter({ phase: 'workload', clock: () => 0 });
  for (const [token, bytes] of [['first', Number.MAX_SAFE_INTEGER], ['second', 1]]) {
    const row = { token, phase: 'workload', operation: 'put', retryOrdinal: 0, outcome: 'success', statusCode: 200,
      errorCode: null, sameAccount: true, bytesIn: 0, bytesOut: bytes, attemptedBytesIn: 0, attemptedBytesOut: bytes };
    for (const channel of ['producer', 'observer']) meter.observeAttempt({ ...row, channel });
  }
  input.sources[0].record = meter.snapshot();
  assert.deepEqual(assess(input), { status: 'unknown',
    gaps: ['accounting:incomplete-total', 'accounting:overflow'], publicationEligible: false });
  assert.deepEqual(input.sources[0].record.billing, [{ phase: 'workload', requestClass: 's3-write', quantity: 2, status: 'measured' }]);
  assert.equal(input.sources[1].record.accounting.producer.bytesOut, 11);
});

test('real unmatched meter events keep both diagnostic ledgers and forbid publication', () => {
  const input = local(), meter = createMeter({ phase: 'workload', clock: () => 0 });
  meter.observeAttempt({ token: 'PRIVATE_TOKEN', channel: 'producer', phase: 'workload', operation: 'put', retryOrdinal: 0,
    outcome: 'transport-error', statusCode: null, errorCode: null, sameAccount: null,
    bytesIn: 0, bytesOut: 3, attemptedBytesIn: 0, attemptedBytesOut: 11 });
  input.sources[0].record = meter.snapshot();
  assert.deepEqual(assess(input), { status: 'unknown',
    gaps: ['accounting:meter-disagreement', 'accounting:unreconciled', 'request-billing:unknown'], publicationEligible: false });
  assert.equal(input.sources[0].record.accounting.producer.attempts, 1);
  assert.equal(input.sources[0].record.accounting.observer.attempts, 0);
});

test('assessment returns detached fixed labels and never mutates original private evidence', () => {
  const input = local(), before = structuredClone(input);
  const result = assess(input); result.gaps.push('PRIVATE_CANARY');
  assert.deepEqual(input, before);
  assert.deepEqual(assess(input), { status: 'measured', gaps: [], publicationEligible: true });
  assert.doesNotMatch(JSON.stringify(assess(input)), /PRIVATE/);
});
for (const scope of ['requests', 'restore', 'administration', 'storage']) {
  test(`fiscal traffic cannot impersonate ${scope} storage accounting`, () => {
    const input = local(); input.sources.find(source => source.scope === scope).record = snapshot({ operation: 'fiscal' });
    invalid(input);
  });
}
test('storage traffic cannot impersonate the fiscal source', () => {
  const input = service(); input.sources[5].record = snapshot(); invalid(input);
});

test('real closed loopback traffic supplies the original remote accounting record', async t => {
  const { createServer, connect } = await import('node:net');
  const { once } = await import('node:events');
  const { openRemoteMeasurement } = await import('./remote.mjs');
  const sockets = new Set();
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('data', () => {});
    socket.once('end', () => socket.end('ok')); socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const run = await openRemoteMeasurement({ target: `tcp://127.0.0.1:${server.address().port}`, audience: 'staff' });
  t.after(() => run.close().catch(() => {}));
  const client = connect({ host: '127.0.0.1', port: run.port, allowHalfOpen: true });
  t.after(() => client.destroy()); client.on('data', () => {});
  const closed = once(client, 'close'); client.end('private'); await closed; await run.close();
  const original = run.snapshot();
  assert.deepEqual(original.producer, { connections: 1, bytesToGateway: 7, bytesFromGateway: 2 });
  assert.deepEqual(assess({ producer: 'remote', sources: [{ scope: 'remote', record: original }] }),
    { status: 'measured', gaps: [], publicationEligible: true });
  assert.doesNotMatch(JSON.stringify(original), /private/);
});

test('valid-shaped records still reject accessors before reading admitted fields', () => {
  let reads = 0;
  for (const location of ['producer', 'sources', 'source-scope', 'record', 'status', 'requests', 'request-phase', 'billing-quantity', 'array-entry']) {
    const input = local(); let object, key;
    if (location === 'producer' || location === 'sources') { object = input; key = location; }
    if (location === 'source-scope') { object = input.sources[0]; key = 'scope'; }
    if (location === 'record') { object = input.sources[0]; key = 'record'; }
    if (location === 'status') { object = input.sources[0].record; key = 'status'; }
    if (location === 'requests') { object = input.sources[0].record.accounting; key = 'requests'; }
    if (location === 'request-phase') { object = input.sources[0].record.accounting.requests[0]; key = 'phase'; }
    if (location === 'billing-quantity') { object = input.sources[0].record.billing[0]; key = 'quantity'; }
    if (location === 'array-entry') { object = input.sources; key = '0'; }
    Object.defineProperty(object, key, { enumerable: true, get() { reads++; throw Error('PRIVATE_ACCESSOR'); } });
    invalid(input);
  }
  assert.equal(reads, 0);
});

for (const [name, build, change] of [
  ['a fully relabelled request class', local, input => {
    const r = input.sources[0].record;
    r.accounting.requests[0].requestClass = 's3-read'; r.observedRequests[0].requestClass = 's3-read'; r.billing[0].requestClass = 's3-read';
  }],
  ['consistent discrepancy hiding a forged self-total', local, input => {
    const r = input.sources[0].record; r.accounting.producer.attempts = 2; r.accounting.discrepancy.attempts = -1;
  }],
  ['duplicated groups with otherwise correct totals', local, input => {
    const r = input.sources[0].record;
    r.accounting.requests.push(structuredClone(r.accounting.requests[0])); r.observedRequests.push(structuredClone(r.observedRequests[0]));
    r.accounting.producer = { attempts: 2, bytesIn: 0, bytesOut: 22 }; r.accounting.observer = { attempts: 2, bytesIn: 0, bytesOut: 22 };
  }],
  ['a private lifetime object field', local, input => {
    input.sources[3].record = history(); input.sources[3].record.objects.key = 'PRIVATE_KEY';
  }],
  ['forged mail operations despite equal counters', service, input => {
    const r = input.sources[4].record;
    r.producer.attempts = 2; r.producer.accepted = 2; r.observer.attempts = 2; r.observer.accepted = 2;
  }],
  ['duplicated mail groups with otherwise correct totals', service, input => {
    const r = input.sources[4].record;
    r.operations.push(structuredClone(r.operations[0]));
    r.producer.attempts = 2; r.producer.accepted = 2; r.observer.attempts = 2; r.observer.accepted = 2;
  }],
]) {
  test(`independent malformed refusal: ${name}`, () => { const input = build(); change(input); invalid(input); });
}

test('omitting a gap label cannot turn an original unknown billing row into measured cost', () => {
  const input = local(), record = input.sources[0].record;
  record.billing[0] = { phase: 'workload', requestClass: 's3-write', quantity: null, status: 'unknown' };
  assert.deepEqual(record.gaps, []);
  assert.deepEqual(assess(input), { status: 'unknown', gaps: ['request-billing:unknown'], publicationEligible: false });
});
