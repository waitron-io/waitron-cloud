import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createLocalAccountMailer } from '../../packages/registration/src/local-mailer.ts';
import * as local from './local.mjs';
const nodemailer = createRequire(new URL('../../packages/registration/package.json', import.meta.url))('nodemailer');

const bad = /Invalid cloud cost mail measurement/;
const context = id => ({ deliveryId: id ?? randomUUID(), signal: new AbortController().signal });
const message = { email: 'private-canary@example.test', locale: 'es' };
async function fixture(t, modes = []) {
  let calls = 0;
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    const mode = modes[calls++] ?? 'accept';
    if (mode === 'hang') return;
    if (mode === 'malformed') { socket.end('private-canary is not SMTP\r\n'); return; }
    if (mode === 'truncated') { socket.end('220-incomplete multiline\r\n'); return; }
    if (mode === 'oversize') { socket.end('220 ' + 'x'.repeat(16385) + '\r\n'); return; }
    let buffer = '', data = false;
    socket.write(mode === 'long-valid' ? '220 ' + 'x'.repeat(16385) + '\r\n' : '220 synthetic capture\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') { data = false; socket.write('250 captured\r\n'); }
        } else if (line.startsWith('EHLO')) socket.write('250-capture\r\n250 8BITMIME\r\n');
        else if (line.startsWith('RCPT') && mode === 'refuse') socket.write('451 deferred private-canary\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 send body\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 okay\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { target: `smtp://127.0.0.1:${server.address().port}`, calls: () => calls, sockets };
}
async function open(t, f, options = {}) {
  assert.equal(typeof local.openMailMeasurement, 'function', 'measure real SMTP independently of mailer completion');
  const run = await local.openMailMeasurement({ target: f.target, timeoutMs: 1000, ...options });
  t.after(() => run.close().catch(() => {}));
  return { run, mailer: run.wrapMailer(createLocalAccountMailer({ port: run.port })) };
}

// Counting logical messages alone loses the refused physical attempt before a worker retry.
test('mailIndependentSmtpRefusalRetryAndAcceptedOperationsReconcile', async t => {
  const f = await fixture(t, ['refuse', 'accept', 'accept']);
  const { run, mailer } = await open(t, f), c = context();
  await assert.rejects(mailer.sendPasswordChanged(message, c));
  await mailer.sendPasswordChanged(message, c);
  await mailer.sendPasswordChanged(message, context());
  assert.throws(() => run.snapshot(), bad);
  await run.close(); await run.close();
  assert.deepEqual(run.snapshot(), { scope: 'captured-mail-operations', status: 'measured', reconciled: true,
    producer: { attempts: 3, accepted: 2, refused: 1, retried: 1 },
    observer: { attempts: 3, accepted: 2, refused: 1 },
    discrepancy: { attempts: 0, accepted: 0, refused: 0 },
    operations: [
      { action: 'password_changed', outcome: 'refused', retryOrdinal: 0, attempts: 1 },
      { action: 'password_changed', outcome: 'accepted', retryOrdinal: 1, attempts: 1 },
      { action: 'password_changed', outcome: 'accepted', retryOrdinal: 0, attempts: 1 },
    ], billing: { quantity: null, status: 'unknown' } });
  assert.equal(f.calls(), 3);
  assert.equal(JSON.stringify(run.snapshot()).includes('private-canary'), false);
  assert.equal(JSON.stringify(run.snapshot()).includes(c.deliveryId), false);
});

// External SMTP or URL decoration must fail before any capture socket opens.
test('mailRejectsExternalTargetsAndUnboundedDeadlinesBeforeConnecting', async () => {
  assert.equal(typeof local.openMailMeasurement, 'function');
  for (const target of ['smtp://example.test:42', 'smtp://localhost:42', 'smtps://127.0.0.1:42',
    'smtp://user:secret@127.0.0.1:42', 'smtp://127.0.0.1:42/path', 'smtp://127.0.0.1:42/?raw', 'smtp://127.0.0.1:42/#raw'])
    await assert.rejects(local.openMailMeasurement({ target }), bad);
  for (const timeoutMs of [0, 30001, 0.5, NaN])
    await assert.rejects(local.openMailMeasurement({ target: 'smtp://127.0.0.1:42', timeoutMs }), bad);
});

// No SMTP exchange, a false client result or missing identity cannot qualify evidence.
test('mailRejectsEmptyUnobservedAndMismatchedDeliveries', async t => {
  const f = await fixture(t);
  const { run: empty } = await open(t, f);
  await assert.rejects(empty.close(), bad);
  for (const mode of ['unobserved', 'mismatch', 'missing-context']) {
    const { run } = await open(t, f);
    const actual = createLocalAccountMailer({ port: run.port });
    const mailer = run.wrapMailer(mode === 'unobserved' ? { sendPasswordChanged: async () => {} }
      : mode === 'mismatch' ? { async sendPasswordChanged(m, c) { await actual.sendPasswordChanged(m, c); throw Error('private-canary'); } } : actual);
    await assert.rejects(mailer.sendPasswordChanged(message, mode === 'missing-context' ? undefined : context()), bad);
    await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
  }
});

// Unpaired connections and overlapping work cannot be counted under another message's identity.
test('mailUnpairedAndOverlappingConnectionsPermanentlyRefuseEvidence', async t => {
  const f = await fixture(t, ['hang']);
  const { run } = await open(t, f);
  const socket = connect(run.port, '127.0.0.1'); socket.on('error', () => {});
  await once(socket, 'close');
  assert.equal(f.calls(), 0);
  await assert.rejects(run.close(), bad);
  const { run: overlapping, mailer } = await open(t, f);
  const first = assert.rejects(mailer.sendPasswordChanged(message, context()), bad);
  await assert.rejects(mailer.sendPasswordChanged(message, context()), bad);
  await assert.rejects(overlapping.close(), bad); await first;
});

// A deadline or cancellation must close owned transports promptly, never yield partial evidence.
test('mailDeadlineCancellationAndCloseSettleTheOwnedConnection', async t => {
  for (const mode of ['deadline', 'signal', 'close']) {
    const f = await fixture(t, ['hang']);
    const controller = new AbortController();
    const { run, mailer } = await open(t, f, { timeoutMs: mode === 'deadline' ? 50 : 30000, signal: controller.signal });
    const outcome = mailer.sendPasswordChanged(message, context()).then(() => 'accepted', e => bad.test(e.message) ? 'refused' : 'raw-error');
    // Wait for an actual owned connection before asking it to stop.
    while (f.calls() === 0) await new Promise(resolve => setTimeout(resolve, 1));
    if (mode === 'signal') controller.abort();
    let closing;
    if (mode === 'close') closing = run.close().catch(() => {});
    let timer;
    try {
      assert.equal(await Promise.race([outcome, new Promise(resolve => { timer = setTimeout(() => resolve('still-running'), 500); })]), 'refused');
    } finally { clearTimeout(timer); await outcome; await closing; await run.close().catch(() => {}); }
    assert.throws(() => run.snapshot(), bad);
  }
});

// Local rendering failure must remain an evidence gap rather than a successful zero-send sample.
test('mailRenderingErrorsAndPreAbortedRunsNeverExposePrivateDiagnostics', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  assert.equal(typeof local.openMailMeasurement, 'function');
  await assert.rejects(local.openMailMeasurement({ target: f.target, signal: controller.signal }), bad);
  const { run, mailer } = await open(t, f);
  await assert.rejects(mailer.sendPasswordChanged({ ...message, locale: 'private-canary' }, context()), e => bad.test(e.message) && !e.message.includes('private-canary'));
  await assert.rejects(run.close(), bad); assert.equal(f.calls(), 0);
});

// Invalid reuse must not leave a previously good measurement available to the caller.
test('mailInvalidReuseAfterSuccessPermanentlyRefusesEarlierEvidence', async t => {
  const f = await fixture(t);
  const { run, mailer } = await open(t, f), c = context();
  await mailer.sendPasswordChanged(message, c);
  await assert.rejects(mailer.sendPasswordChanged(message), bad);
  await assert.rejects(run.close(), bad);
  assert.throws(() => run.snapshot(), bad);
});

// Exhausting the scenario budget must prevent the next physical connection.
test('mailAttemptBudgetRefusesBeforeNextConnection', async t => {
  const f = await fixture(t);
  const { run, mailer } = await open(t, f, { maxAttempts: 1 });
  await mailer.sendPasswordChanged(message, context());
  await assert.rejects(mailer.sendPasswordChanged(message, context()), bad);
  assert.equal(f.calls(), 1);
  await assert.rejects(run.close(), bad);
  for (const maxAttempts of [0, 10001, 0.5, 1.5, NaN])
    await assert.rejects(local.openMailMeasurement({ target: f.target, maxAttempts }), bad);
});

// An invalid or unfinished server transcript cannot become a measured delivery failure.
test('mailMalformedTruncatedAndOversizedRepliesRefuseEvidenceWithoutRawErrors', async t => {
  for (const mode of ['malformed', 'truncated', 'oversize']) {
    const f = await fixture(t, [mode]);
    const { run, mailer } = await open(t, f);
    await assert.rejects(mailer.sendPasswordChanged(message, context()), e => bad.test(e.message) && !e.message.includes('private-canary'));
    await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
  }
});

// A caller resolving a refused SMTP attempt is an accounting mismatch, not a delivery success.
test('mailFalseSuccessAfterServerRefusalCannotQualify', async t => {
  const f = await fixture(t, ['refuse']);
  const { run } = await open(t, f), actual = createLocalAccountMailer({ port: run.port });
  const mailer = run.wrapMailer({ async sendPasswordChanged(m, c) { await actual.sendPasswordChanged(m, c).catch(() => {}); } });
  await assert.rejects(mailer.sendPasswordChanged(message, context()), bad);
  await assert.rejects(run.close(), bad);
});

// Cancellation belonging to one delivery must terminate its real capture socket too.
test('mailDeliverySignalAndActionIdentityAreEnforced', async t => {
  const f = await fixture(t, ['hang']);
  const { run, mailer } = await open(t, f, { timeoutMs: 30000 });
  const controller = new AbortController(), c = { deliveryId: randomUUID(), signal: controller.signal };
  const pending = assert.rejects(mailer.sendPasswordChanged(message, c), bad);
  while (f.calls() === 0) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(); await pending; await assert.rejects(run.close(), bad);
  const other = await fixture(t), next = await open(t, other), identity = context();
  await next.mailer.sendPasswordChanged(message, identity);
  await assert.rejects(next.mailer.sendVerification({ ...message, token: 'x'.repeat(43), expiresAt: '2027-01-01T00:00:00Z' }, identity), bad);
  assert.equal(other.calls(), 1); await assert.rejects(next.run.close(), bad);
});

// One queued message must not hide several recipients or an unbounded SMTP payload.
test('mailMultipleRecipientsAndOversizedDataRefuseOperationEvidence', async t => {
  for (const mode of ['recipients', 'body']) {
    const f = await fixture(t), { run } = await open(t, f);
    const transport = nodemailer.createTransport({ host: '127.0.0.1', port: run.port, ignoreTLS: true });
    const mailer = run.wrapMailer({ async sendPasswordChanged() {
      await transport.sendMail({ from: 'from@example.test', to: mode === 'recipients' ? ['one@example.test', 'two@example.test'] : 'one@example.test',
        text: mode === 'body' ? 'Synthetic line\n'.repeat(100000) : 'Synthetic' });
    } });
    try { await assert.rejects(mailer.sendPasswordChanged(message, context()), bad); await assert.rejects(run.close(), bad); }
    finally { transport.close(); }
  }
});

// Each real renderer keeps its action class; returned aggregates cannot mutate retained evidence.
test('mailAllFourRenderersRetainOnlyIndependentActionCounts', async t => {
  const f = await fixture(t), { run, mailer } = await open(t, f);
  const account = { ...message, token: 'x'.repeat(43), expiresAt: '2027-01-01T00:00:00Z' };
  await mailer.sendVerification(account, context()); await mailer.sendPasswordReset(account, context());
  await mailer.sendPasswordChanged(message, context());
  await mailer.sendServiceAlert({ ...message, incidentId: randomUUID(), venueId: randomUUID(), revision: 1,
    issue: 'disconnected', state: 'open' }, context());
  await run.close();
  const snapshot = run.snapshot();
  assert.deepEqual(snapshot.operations.map(r => [r.action, r.outcome, r.attempts]),
    [['verification', 'accepted', 1], ['password_reset', 'accepted', 1], ['password_changed', 'accepted', 1], ['service_alert', 'accepted', 1]]);
  snapshot.producer.attempts = 0; snapshot.operations[0].attempts = 0;
  assert.equal(run.snapshot().producer.attempts, 4); assert.equal(run.snapshot().operations[0].attempts, 1);
});

// Reject a second caller immediately, before it can replace the first connection's identity.
test('mailConcurrentCallerIsRefusedBeforeItsTransportStarts', async t => {
  const f = await fixture(t, ['hang', 'hang']), { run, mailer } = await open(t, f);
  const first = mailer.sendPasswordChanged(message, context()).catch(() => {});
  while (f.calls() === 0) await new Promise(resolve => setTimeout(resolve, 1));
  const second = mailer.sendPasswordChanged(message, context()).then(() => 'accepted', () => 'refused');
  let timer;
  try {
    assert.equal(await Promise.race([second, new Promise(resolve => { timer = setTimeout(() => resolve('still-running'), 100); })]), 'refused');
  } finally { clearTimeout(timer); await run.close().catch(() => {}); await first; await second; }
  assert.throws(() => run.snapshot(), bad);
});

// An otherwise successful transcript cannot smuggle an unbounded reply line into evidence.
test('mailOverlongCompleteGreetingRefusesAnOtherwiseSuccessfulExchange', async t => {
  const f = await fixture(t, ['long-valid']), { run, mailer } = await open(t, f);
  await assert.rejects(mailer.sendPasswordChanged(message, context()), bad);
  await assert.rejects(run.close(), bad);
});

// Cancelling the caller must also close its physical SMTP connection before normal shutdown.
test('mailCancellationClosesTheActualCaptureSocket', async t => {
  const f = await fixture(t, ['hang']), controller = new AbortController();
  const { run, mailer } = await open(t, f, { signal: controller.signal, timeoutMs: 30000 });
  const pending = mailer.sendPasswordChanged(message, context()).catch(() => {});
  while (f.calls() === 0) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(); await pending;
  try {
    await Promise.race([Promise.all([...f.sockets].map(s => once(s, 'close'))), new Promise(resolve => setTimeout(resolve, 100))]);
    assert.equal(f.sockets.size, 0, 'cancellation must close the backend connection');
  } finally { for (const s of f.sockets) s.destroy(); await run.close().catch(() => {}); }
});

// The measurement deadline must apply even while the capture server never sends its greeting.
test('mailDeadlineRejectsBeforeTheServerResponds', async t => {
  const f = await fixture(t, ['hang']), { run, mailer } = await open(t, f, { timeoutMs: 50 });
  const pending = mailer.sendPasswordChanged(message, context()).then(() => 'accepted', () => 'refused');
  let timer;
  try {
    assert.equal(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve('still-running'), 250); })]), 'refused');
  } finally { clearTimeout(timer); for (const s of f.sockets) s.destroy(); await pending; await run.close().catch(() => {}); }
});
