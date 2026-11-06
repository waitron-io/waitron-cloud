// Shared assertions for the native smoke's independently counted storage traffic.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { litestreamAfterStopOutput } from './litestream.mjs';
import { assessAccounting } from './accounting-policy.mjs';

export function delayLitestreamPutReplies(source) {
  const forwarding = "res.writeHead(incoming.statusCode, incoming.headers); incoming.on('error', () => res.destroy()); incoming.pipe(res);";
  const replacements = [
    ["let stage = 'prepare';", "let delayedPutReplies = 0; let stage = 'prepare';"],
    [forwarding, `const forward = () => { ${forwarding} };
      if (req.method === 'PUT' && incoming.statusCode < 300) { delayedPutReplies++; setTimeout(forward, 1500); } else forward();`],
    ['const result = { version, injectedFailures,', 'const result = { delayedPutReplies, version, injectedFailures,'],
  ];
  for (const [anchor, replacement] of replacements) {
    assert.equal(source.split(anchor).length, 2, 'delayed reply injection requires one unambiguous anchor');
    source = source.replace(anchor, replacement);
  }
  return source;
}

export function prepareDelayedLitestreamStop(source) {
  source = delayLitestreamPutReplies(source);
  // An older compacted copy cannot stand in for a new upload at the final-sale boundary.
  // The new upload's held reply must overlap stop to exercise the shared two-second drain budget.
  for (const [anchor, replacement] of [
    ["let delayedPutReplies = 0;", `const finalPutGate = (${createDelayedPutGate.toString().replace(/\n\s*/g, ' ')})(); let finalPutCommit, finalSaleWritten = false; const finalPutCommitted = new Promise(resolve => finalPutCommit = resolve); let delayedPutReplies = 0;`],
    ["await sale(2);", "finalPutGate.beforeSale(); await sale(2); finalSaleWritten = true;"],
    ["let requestBytes = 0;", "const postSaleRequest = finalSaleWritten; const finalPut = finalPutGate.admit(req, postSaleRequest); let requestBytes = 0;"],
    ["const forward = () => {", "const forward = () => { finalPutGate.forward(finalPut, res);"],
    ["delayedPutReplies++; setTimeout(forward, 1500);", "delayedPutReplies++; finalPutGate.response(finalPut, incoming.statusCode, () => { if (postSaleRequest) finalPutCommit(); }); setTimeout(forward, 1500);"],
    ["stage = 'stop';", `let finalPutTimer;
      stage = 'final-put-readiness';
      try { await Promise.race([finalPutCommitted, new Promise((_, reject) => {
        finalPutTimer = setTimeout(() => reject(Error('Final synthetic PUT did not commit')), 5000);
      })]); } finally { clearTimeout(finalPutTimer); }
      stage = 'stop';`],
  ]) {
    assert.equal(source.split(anchor).length, 2, 'final PUT readiness requires one unambiguous anchor');
    source = source.replace(anchor, replacement);
  }
  return source;
}

// An idle observed transport cannot exclude later compaction replies; those need their own gate.
export function createDelayedPutGate() {
  let knownWater = 0n, acknowledged = false, boundary;
  const olderReplies = new Set();
  return {
    beforeSale() { boundary = acknowledged ? knownWater : 0n; },
    admit(req, postSale) {
      const match = /\/(?:000[0-3]|0009)\/([a-f0-9]{16})-([a-f0-9]{16})\.ltx(?:\?|$)/.exec(req.url ?? '');
      const query = new URL(req.url ?? '/', 'http://synthetic.invalid').searchParams;
      const partial = query.has('partNumber') || query.has('uploadId');
      const first = match ? BigInt('0x' + match[1]) : 0n;
      const last = match ? BigInt('0x' + match[2]) : 0n;
      const known = req.method === 'PUT' && first > 0n && last >= first ? last : 0n;
      if (known > knownWater) knownWater = known;
      const row = { txid: partial ? 0n : known, postSale, forwarded: false };
      if (row.postSale && row.txid > 0n && row.txid <= boundary) {
        row.settled = new Promise(resolve => { row.settle = resolve; });
        olderReplies.add(row.settled);
      }
      return row;
    },
    response(row, status, ready) {
      if (status < 200 || status >= 300) return;
      if (row.txid > 0n) acknowledged = true;
      if (boundary > 0n && row.txid > boundary && row.postSale) {
        const release = () => { if (!row.forwarded) ready(); };
        if (olderReplies.size) Promise.all([...olderReplies]).then(release);
        else release();
      }
    },
    forward(row, res) {
      row.forwarded = true;
      if (row.settle) res.once('finish', () => { olderReplies.delete(row.settled); row.settle(); });
    },
  };
}

export function createDelayedPutEvidence({ clock = () => performance.now() } = {}) {
  const puts = []; let number = 0, truncated = false, readiness = false, readinessRecorded = false;
  return {
    admit(req, postSale) {
      if (req.method !== 'PUT') return;
      number++;
      if (puts.length === 16) { truncated = true; return; }
      const level = /\/(000[0-3]|0009)\/[a-f0-9]{16}-[a-f0-9]{16}\.ltx(?:\?|$)/.exec(req.url);
      const row = { number, level: level ? Number(level[1]) : 'other', postSale, readiness: false, admitted: clock() };
      puts.push(row); return row;
    },
    response(row) { if (row) row.response = clock(); },
    forward(row) { if (row) row.forwarded = clock(); },
    ready(row) {
      if (readiness) return;
      readiness = true;
      if (row) { row.readiness = true; readinessRecorded = true; }
    },
    snapshot(stopStarted) {
      return { truncated, readinessRecorded, puts: puts.map(row => ({
        number: row.number, level: row.level, postSale: row.postSale, readiness: row.readiness,
        ...Object.fromEntries(['admitted', 'response', 'forwarded'].filter(key => row[key] !== undefined)
          .map(key => [key + 'Ms', Math.round(row[key] - stopStarted)])),
      })) };
    },
  };
}

export function prepareDelayedLitestreamDiagnostics(source) {
  for (const [anchor, replacement] of [
    ['let finalPutCommit, finalSaleWritten = false;',
      `const delayedPutEvidence = (${createDelayedPutEvidence.toString().replace(/\n\s*/g, ' ')})(); let finalPutCommit, finalSaleWritten = false;`],
    ['const postSaleRequest = finalSaleWritten;',
      'const postSaleRequest = finalSaleWritten; const delayedPutRecord = delayedPutEvidence.admit(req, postSaleRequest);'],
    ['const forward = () => {',
      'delayedPutEvidence.response(delayedPutRecord); const forward = () => { delayedPutEvidence.forward(delayedPutRecord);'],
    ['if (postSaleRequest) finalPutCommit();',
      'if (postSaleRequest) { delayedPutEvidence.ready(delayedPutRecord); finalPutCommit(); }'],
    ['timing: { elapsedMs: stopElapsed(), controlMs, exitMs },',
      'timing: { elapsedMs: stopElapsed(), controlMs, exitMs }, delayedPutEvidence: delayedPutEvidence.snapshot(stopStarted),'],
  ]) {
    assert.equal(source.split(anchor).length, 2, 'delayed PUT diagnostics require one unambiguous anchor');
    source = source.replace(anchor, replacement);
  }
  return source;
}

// Restore the one-sale recovery point only after the writer and every covering write are collected.
// This makes missing stored data independent of readiness and the lost HTTP reply.
export function prepareLitestreamWriteLoss(source, { loseStoredWrites }) {
  assert.equal(typeof loseStoredWrites, 'boolean');
  source = prepareDelayedLitestreamStop(source);
  for (const [anchor, replacement] of [
    ['let delayedPutReplies = 0;', 'let baseline = [], cutoffReplies = 0; let delayedPutReplies = 0;'],
    ['finalPutGate.beforeSale(); await sale(2);', `
      baseline = await Promise.all((await list()).map(async row => {
        const stored = await clients[1].send(new sdk.GetObjectCommand({ Bucket, Key: row.Key }));
        return { Key: row.Key, Body: Buffer.from(await stored.Body.transformToByteArray()) };
      }));
      if (!baseline.length) fail();
      finalPutGate.beforeSale(); await sale(2);`],
    ['delayedPutReplies++; finalPutGate.response(finalPut, incoming.statusCode, () => { if (postSaleRequest) finalPutCommit(); }); setTimeout(forward, 1500);', `
      delayedPutReplies++; let cutReply = false;
      finalPutGate.response(finalPut, incoming.statusCode, () => {
        if (postSaleRequest) { cutReply = true; incoming.resume(); finalPutCommit(); }
      });
      setTimeout(() => { if (cutReply) { cutoffReplies++; res.destroy(); } else forward(); }, 1500);`],
    ["if (refusedUploads.size) fail();", `if (refusedUploads.size) fail();
      let baselineRestored = false;
      if (${loseStoredWrites}) {
        for (const row of await list()) await clients[2].send(new DeleteObjectCommand({ Bucket, Key: row.Key }));
        for (const row of baseline) await clients[0].send(new sdk.PutObjectCommand({ Bucket, ...row }));
        const retained = await list();
        if (retained.length !== baseline.length) fail();
        for (const row of retained) {
          const expected = baseline.find(original => original.Key === row.Key);
          const actual = await clients[1].send(new sdk.GetObjectCommand({ Bucket, Key: row.Key }));
          if (!expected || !Buffer.from(await actual.Body.transformToByteArray()).equals(expected.Body)) fail();
        }
        baselineRestored = true;
      }
      const accounting = replication.meter.snapshot();
      console.error(JSON.stringify({ kind: 'lost-write-control', version, sourceSales: replay.counts().successful,
        status: accounting.status, gaps: accounting.gaps, baselineObjects: baseline.length, cutoffReplies, baselineRestored }));`],
    ["finally { db.close(); }", `finally { db.close(); }
        console.error(JSON.stringify({ kind: 'lost-write-restore', restoredSales, integrity }));`],
  ]) {
    assert.equal(source.split(anchor).length, 2, 'lost-write control requires one unambiguous anchor');
    source = source.replace(anchor, replacement);
  }
  return source;
}

// Validate original meter records before allowing accounting uncertainty in a native journey.
export function assertMeterAccounting(proof) {
  assessAccounting({ producer: 'local-stream', sources: [{ scope: 'requests', record: proof }] });
  const identity = row => [row.phase, row.operation, row.retryOrdinal, row.outcome].join(':');
  const sorted = rows => [...rows].sort((a, b) => identity(a).localeCompare(identity(b)));
  const overflow = [...Object.values(proof.accounting.producer), ...Object.values(proof.accounting.observer),
    ...proof.accounting.requests.flatMap(Object.values), ...proof.observedRequests.flatMap(Object.values),
    ...proof.accounting.objects.map(row => row.bytes)].includes(null);
  const unknownStorage = proof.accounting.objects.some(row => row.byteSeconds === null);
  if (overflow) assert.ok(proof.gaps.includes('accounting:overflow'));
  if (unknownStorage) assert.ok(proof.gaps.includes('accounting:incomplete-history') || proof.gaps.includes('accounting:overflow'));
  if (overflow || unknownStorage) assert.equal(proof.status, 'unknown');
  if (proof.reconciled) assert.deepEqual(sorted(proof.accounting.requests), sorted(proof.observedRequests));
  else {
    assert.equal(proof.status, 'unknown');
    assert.ok(proof.gaps.includes('accounting:unreconciled'));
  }
  if (proof.gaps.some(gap => gap !== 'request-billing:unknown')) assert.equal(proof.status, 'unknown');
  for (const row of [...proof.accounting.requests, ...proof.observedRequests]) {
    const other = (proof.accounting.requests.includes(row) ? proof.observedRequests : proof.accounting.requests)
      .find(candidate => identity(candidate) === identity(row));
    if (row.outcome === 'transport-error' || !other || !isDeepStrictEqual(row, other)) {
      assert.equal(proof.status, 'unknown');
      assert.ok(proof.gaps.length > 0);
      const billing = proof.billing.find(candidate => candidate.phase === row.phase && candidate.requestClass === row.requestClass);
      assert.ok(billing, 'every uncertain request class retains its billing uncertainty');
      assert.equal(billing.status, 'unknown'); assert.equal(billing.quantity, null);
    }
  }
  return proof;
}

// Retained inventory stays checked even when a byte count or time bound is unknown.
export function assertStorageAccounting(proof, expected = {}) {
  assessAccounting({ producer: 'local-stream', sources: [{ scope: 'storage', record: proof }] });
  const incomplete = proof.objects.bytes === null || Object.values(proof.byteSeconds).includes(null);
  if (incomplete || proof.gaps?.length) {
    assert.equal(proof.status, 'unknown');
    assert.ok(proof.gaps?.length > 0, 'unknown storage must retain its original accounting gaps');
  }
  for (const group of ['objects', 'byteSeconds']) if (expected[group]) {
    for (const [key, value] of Object.entries(expected[group])) {
      if (proof[group][key] === null && (group === 'byteSeconds' || key === 'bytes')) continue;
      assert.deepEqual(proof[group][key], value, `known storage ${group}.${key}`);
    }
  }
  return proof;
}

export function assertSmokeAccounting(result) {
  assert.ok(result.observed, 'the native smoke retains its original meter');
  assert.ok(result.replication, 'the native smoke retains its original request audit');
  if (result.lifetimes) assertStorageAccounting(result.lifetimes);
  const subset = result.afterStop;
  const output = litestreamAfterStopOutput(subset);
  assert.deepEqual(result.costAccuracy, output.costAccuracy);
  const fields = ['attempts', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'];
  // The after-stop ledger is a subset, never an explanation for all accounting gaps.
  const containsSubset = (proof, rows, hop) => {
    for (const selected of subset.requests.filter(row => row.hop === hop)) {
      const row = rows.find(row => ['phase', 'operation', 'retryOrdinal', 'outcome'].every(key => row[key] === selected[key]));
      assert.ok(row, 'after-stop observations must exist in the original full meter');
      for (const key of fields) {
        if (row[key] === null || selected[key] === null) assert.ok(proof.gaps.includes('accounting:overflow'));
        else assert.ok(Number.isSafeInteger(row[key] - selected[key]) && row[key] >= selected[key]);
      }
    }
  };
  for (const [name, proof] of [['replication', result.observed], ['replication', result.transport?.replication],
    ['restore', result.transport?.restore], ['administration', result.administration]]) {
    if (!proof) continue;
    assertMeterAccounting(proof);
    const audit = result[name];
    if (name !== 'administration' && audit) {
      if (audit.requestsReconciled) {
        assert.equal(proof.accounting.producer.attempts, audit.producerAttempts);
        assert.equal(proof.accounting.observer.attempts, audit.observerAttempts ?? audit.producerAttempts);
      } else {
        assert.equal(audit.status, 'unknown');
        assert.ok(audit.gaps.includes('litestream:requests-unreconciled'));
      }
    }
    if (name === 'replication') {
      containsSubset(proof, proof.accounting.requests, 'producer'); containsSubset(proof, proof.observedRequests, 'observer');
      if (subset.status === 'unknown') assert.equal(proof.status, 'unknown');
    }
  }
}
