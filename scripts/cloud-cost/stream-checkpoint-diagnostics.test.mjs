import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { openStreamMeasurement } from './stream-measurement.mjs';
import { workerFailureTrace } from './worker-diagnostic.mjs';

const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const bad = { message: 'Invalid cloud cost stream measurement' };

// Dropping or mislabelling the checkpoint refusal must lose these independent HTTP observations.
async function fixture(t, onDiagnostic) {
  const state = { extra: false, stored: false, time: 0, requests: 0 };
  const server = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      state.requests++;
      const url = new URL(req.url, 'http://local');
      if (req.method === 'PUT') { state.stored = true; res.end(); }
      else if (url.searchParams.has('versioning')) res.end('<VersioningConfiguration/>');
      else if (url.searchParams.has('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
      else if (url.searchParams.get('list-type') === '2') {
        const respond = () => res.end('<ListBucketResult><IsTruncated>false</IsTruncated>'
        + (state.stored ? '<Contents><Key>PRIVATE_KEY</Key><Size>4</Size></Contents>' : '')
        + (state.extra ? '<Contents><Key>PRIVATE_UNOBSERVED</Key><Size>1</Size></Contents>' : '') + '</ListBucketResult>');
        if (state.holdList) { const hold = state.holdList; state.holdList = null; hold(respond); }
        else respond();
      }
      else { res.writeHead(500); res.end('PRIVATE_UNEXPECTED_REQUEST'); }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const session = await openStreamMeasurement({ sdk, bucket: 'private-checkpoint', versioned: false,
    target: `http://127.0.0.1:${server.address().port}`, clock: () => state.time, onDiagnostic });
  t.after(() => session.close().catch(error => assert.deepEqual({ message: error.message }, bad)));
  return { state, session };
}
async function upload(url, expectedStatus = 200) {
  return new Promise((resolve, reject) => {
    const req = request(url + '/private-checkpoint/PRIVATE_KEY', { method: 'PUT', agent: false, headers: {
      'content-length': '4', 'amz-sdk-invocation-id': '11111111-2222-4333-8444-000000000001',
      'amz-sdk-request': 'attempt=1; max=1',
    } }, res => { res.resume(); res.on('end', () => res.statusCode === expectedStatus ? resolve(res.statusCode) : reject(Error('upload refused'))); });
    req.on('error', reject); req.end('data');
  });
}
async function stopped(url) {
  await assert.rejects(new Promise((resolve, reject) => {
    const req = request(url, { agent: false }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.end();
  }), /ECONNREFUSED|ECONNRESET|socket hang up/);
}

for (const stage of ['checkpoint-admission', 'checkpoint-inventory', 'checkpoint-accounting']) {
  test('checkpointNamesItsRefusingOperation_' + stage, async t => {
    const trace = [], f = await fixture(t, event => trace.push(event));
    if (stage === 'checkpoint-admission') await f.session.close();
    if (stage === 'checkpoint-inventory') f.state.extra = true;
    if (stage === 'checkpoint-accounting') { await upload(f.session.url); f.state.time = 1e308; }
    const before = f.state.requests;
    await assert.rejects(f.session.checkpoint(), bad);
    assert.deepEqual(trace, [{ kind: 'measurement-refusal', stage }]);
    assert.deepEqual(workerFailureTrace(trace), trace);
    assert.equal(f.state.requests - before, stage === 'checkpoint-admission' ? 0 : 3);
    await stopped(f.session.url);
    await assert.rejects(f.session.finish(), bad);
    assert.doesNotMatch(JSON.stringify(trace), /PRIVATE|private-checkpoint|127\.0\.0\.1/);
  });
}

test('healthyCheckpointsPublishNoFailureAndKeepTheSessionUsable', async t => {
  const trace = [], f = await fixture(t, event => trace.push(event));
  assert.equal((await f.session.checkpoint()).requests.reconciled, true);
  await upload(f.session.url); f.state.time = 2;
  assert.equal((await f.session.checkpoint()).storage.objects.bytes, 4);
  assert.equal((await f.session.finish()).status, 'measured');
  assert.deepEqual(trace, []);
});

for (const mode of ['throw', 'reject']) test('checkpointReporterFailureCannotReplaceRefusal_' + mode, async t => {
  let calls = 0;
  const f = await fixture(t, () => {
    calls++;
    if (mode === 'throw') throw Error('PRIVATE_REPORTER');
    return Promise.reject(Error('PRIVATE_REPORTER'));
  });
  f.state.extra = true;
  await assert.rejects(f.session.checkpoint(), bad);
  assert.equal(calls, 1);
  await stopped(f.session.url);
});

for (const [name, event] of [
  ['stage', { kind: 'measurement-refusal', stage: 'PRIVATE_STAGE' }],
  ['extra', { kind: 'measurement-refusal', stage: 'checkpoint-inventory', error: 'PRIVATE_ERROR' }],
  ['getter', { kind: 'measurement-refusal', get stage() { throw Error('PRIVATE_GETTER'); } }],
]) test('checkpointWorkerAdmissionRejectsPrivateOrExecutableEvidence_' + name, () => {
  assert.throws(() => workerFailureTrace([event]), { message: 'Invalid cloud cost worker diagnostic' });
});

for (const stage of ['checkpoint-admission', 'checkpoint-inventory', 'checkpoint-traffic', 'checkpoint-accounting'])
  test('checkpointWorkerAdmissionPreservesOnlyItsFixedCode_' + stage, () => {
    const trace = [{ kind: 'measurement-refusal', stage }];
    const admitted = workerFailureTrace(trace);
    assert.deepEqual(admitted, trace);
    trace[0].stage = 'PRIVATE_LATER_VALUE';
    assert.equal(admitted[0].stage, stage);
  });


// A request refused during inventory poisons session health without an accounting snapshot failure.
test('checkpointDistinguishesARacingWriteFromAccountingFailure', async t => {
  const trace = [], f = await fixture(t, event => trace.push(event));
  let entered, release;
  const held = new Promise(resolve => { entered = resolve; });
  f.state.holdList = resume => { release = resume; entered(); };
  t.after(() => release?.());
  const refusing = assert.rejects(f.session.checkpoint(), bad);
  await held;
  const before = f.state.requests;
  assert.equal(await upload(f.session.url, 400), 400);
  assert.equal(f.state.requests, before, 'racing writes never reach storage');
  release(); await refusing;
  assert.deepEqual(trace, [{ kind: 'measurement-refusal', stage: 'checkpoint-traffic' }]);
  assert.deepEqual(workerFailureTrace(trace), trace);
  await stopped(f.session.url);
  await assert.rejects(f.session.finish(), bad);
});
