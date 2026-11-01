// Shared assertions for the native smoke's independently counted storage traffic.
import assert from 'node:assert/strict';
import { litestreamAfterStopOutput } from './litestream.mjs';

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
  // A compacted copy of an older transaction must not stand in for the final sale.
  // Otherwise periodic replication and the stop flush can incur successive 1,500 ms holds inside two seconds.
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

// The initial smoke barrier drains pre-sale traffic; late compaction can add older replies afterwards.
export function createDelayedPutGate() {
  let highWater = 0n, boundary;
  const olderReplies = new Set();
  return {
    beforeSale() { boundary = highWater; },
    admit(req, postSale) {
      const match = /\/(?:000[0-3]|0009)\/([a-f0-9]{16})-([a-f0-9]{16})\.ltx(?:\?|$)/.exec(req.url ?? '');
      const partial = /[?&](?:partNumber|uploadId)=/.test(req.url ?? '');
      const first = match ? BigInt('0x' + match[1]) : 0n;
      const last = match ? BigInt('0x' + match[2]) : 0n;
      const row = { txid: req.method === 'PUT' && !partial && first > 0n && last >= first ? last : 0n, postSale, forwarded: false };
      if (row.postSale && row.txid > 0n && row.txid <= boundary) {
        row.settled = new Promise(resolve => { row.settle = resolve; });
        olderReplies.add(row.settled);
      }
      return row;
    },
    response(row, status, ready) {
      if (status < 200 || status >= 300) return;
      if (row.txid > highWater) highWater = row.txid;
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

export function assertSmokeAccounting(result) {
  const subset = result.afterStop;
  const output = litestreamAfterStopOutput(subset);
  assert.deepEqual(result.costAccuracy, output.costAccuracy);
  assert.equal(result.replication.requestsReconciled, true);
  const fields = ['attempts', 'bytesIn', 'bytesOut'];
  const rowFields = [...fields, 'attemptedBytesIn', 'attemptedBytesOut'];
  const residual = (rows, hop) => {
    const grouped = new Map();
    for (const [source, sign] of [[rows, 1], [subset.requests.filter(r => r.hop === hop), -1]]) {
      for (const row of source) {
        const key = [row.phase, row.operation, row.retryOrdinal, row.outcome].join(':');
        const total = grouped.get(key) ?? Object.fromEntries(rowFields.map(k => [k, 0]));
        for (const k of rowFields) total[k] += sign * row[k];
        grouped.set(key, total);
      }
    }
    for (const [key, total] of grouped) {
      for (const n of Object.values(total)) assert.ok(Number.isSafeInteger(n) && n >= 0);
      if (rowFields.every(k => total[k] === 0)) grouped.delete(key);
    }
    return grouped;
  };
  for (const proof of [result.observed, result.transport?.replication].filter(Boolean)) {
    assert.equal(proof.reconciled, subset.bodiesReconciled);
    assert.equal(proof.accounting.producer.attempts, result.replication.producerAttempts);
    assert.equal(proof.accounting.observer.attempts, result.replication.producerAttempts);
    for (const [hop, rows] of [['producer', proof.accounting.requests], ['observer', proof.observedRequests]]) {
      for (const k of fields) assert.equal(proof.accounting[hop][k], rows.reduce((n, r) => n + r[k], 0));
    }
    for (const k of fields) {
      const difference = proof.accounting.observer[k] - proof.accounting.producer[k];
      assert.equal(difference, subset.observer[k] - subset.producer[k]);
      assert.equal(proof.accounting.discrepancy[k], difference);
    }
    assert.deepEqual(residual(proof.accounting.requests, 'producer'), residual(proof.observedRequests, 'observer'),
      'ordinary traffic outside the after-stop subset must still match in both counters');
    if (!subset.bodiesReconciled) {
      assert.equal(proof.status, 'unknown');
      assert.ok(proof.gaps.includes('accounting:unreconciled'));
      assert.ok(proof.billing.length > 0);
      for (const row of proof.billing) { assert.equal(row.status, 'unknown'); assert.equal(row.quantity, null); }
    }
  }
}
