// Explicit local PostgreSQL/Mailpit integration. Every account, message and ledger
// here is generated; no private venue source or provider endpoint is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as tcpServer, connect } from 'node:net';
import { createServer as httpServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { EmailOutbox, EmailWorker } from '../../../packages/registration/src/email-outbox.ts';
import { createLocalAccountMailer } from '../../../packages/registration/src/local-mailer.ts';
import { transaction } from '../../../packages/registration/src/transaction.ts';
import { SignupStore } from '../../../packages/registration/src/signup.ts';
import { PasswordRecoveryStore } from '../../../packages/registration/src/password-recovery.ts';
import { fiscalHttpFixture } from '../../../packages/account-http/test/fiscal-http-fixture.ts';
import { openMailMeasurement } from '../mail.mjs';
import { openFiscalMeasurement } from '../fiscal.mjs';
import { buildServiceReceipt, validateServiceReceipt } from '../service-receipt.mjs';
const { Pool } = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');

if (!process.env.TEST_DATABASE_URL || !process.env.MAILPIT_TEST_URL || !process.env.MAILPIT_TEST_SMTP_PORT)
  throw Error('Run with scripts/test-postgres.mjs');

async function refusedOnceSmtp() {
  const sockets = new Set(); let connections = 0;
  const server = tcpServer(client => {
    sockets.add(client); client.on('error', () => {}); client.once('close', () => sockets.delete(client));
    if (++connections === 1) { client.end('421 temporary generated capture refusal\r\n'); return; }
    const upstream = connect(Number(process.env.MAILPIT_TEST_SMTP_PORT), '127.0.0.1');
    sockets.add(upstream); upstream.on('error', () => client.destroy());
    upstream.once('close', () => { sockets.delete(upstream); client.destroy(); });
    client.once('close', () => upstream.destroy()); client.pipe(upstream); upstream.pipe(client);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { target: `smtp://127.0.0.1:${server.address().port}`, connections: () => connections,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
async function refusedOnceHttp(port) {
  let calls = 0; const upstreams = new Set();
  const server = httpServer((req, res) => {
    if (++calls === 1) { req.resume(); res.writeHead(503); res.end('Generated temporary refusal'); return; }
    const upstream = request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
    });
    upstreams.add(upstream); upstream.on('error', () => res.destroy());
    upstream.once('close', () => upstreams.delete(upstream)); req.pipe(upstream);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { target: `http://127.0.0.1:${server.address().port}`, calls: () => calls,
    async close() { for (const upstream of upstreams) upstream.destroy(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve)); } };
}
async function collect(s, meters, proxies = []) {
  const results = [];
  for (const group of [meters, proxies, [s]]) results.push(...await Promise.allSettled(group.filter(Boolean).map(resource => resource.close())));
  for (const result of results) assert.equal(result.status, 'fulfilled', 'every owned resource must close before exporting');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try { assert.equal((await admin.query('SELECT count(*)::integer AS n FROM pg_namespace WHERE nspname=$1', [s.f.schema])).rows[0].n, 0); }
  finally { await admin.end(); }
  await assert.rejects(fetch(`http://127.0.0.1:${s.port}`, { signal: AbortSignal.timeout(1000) }));
}

// Omit either meter, the retry/refusal rows, or verified cleanup and this real
// queue-to-SMTP / HTTP-to-registry journey cannot produce its scenario receipt.
test('serviceReceiptJoinsGenuineQueueDeliveryAndFiscalLifecycleAfterOwnedCleanup', { timeout: 60000 }, async t => {
  const startedAt = new Date().toISOString(), s = await fiscalHttpFixture();
  let mailRun, fiscalRun, smtp, http, mail, fiscal, sent, calls, bodyBytesOut = 0, bodyBytesIn = 0;
  const email = `generated-${randomUUID()}@example.test`;
  try {
    smtp = await refusedOnceSmtp(); http = await refusedOnceHttp(s.port);
    mailRun = await openMailMeasurement({ target: smtp.target });
    fiscalRun = await openFiscalMeasurement({ target: http.target, clock: () => performance.now() / 1000,
      credentials: { cookie: `cloud_session=${s.v.session.token}`, csrfToken: s.v.session.csrfToken } });
    const outbox = new EmailOutbox({ activeKeyId: 'generated', keys: { generated: randomBytes(32).toString('hex') } });
    await transaction(s.f.pool, async client => {
      for (const locale of ['en', 'es', 'es']) await outbox.enqueue(client, 'password_changed', { email, locale });
    });
    const worker = new EmailWorker(s.f.pool, outbox, mailRun.wrapMailer(createLocalAccountMailer({ port: mailRun.port })));
    assert.equal(await worker.runOnce(), true);
    const failed = await worker.status(); assert.equal(failed.failures, 1); assert.equal(failed.counts.sent, 0);
    await s.f.pool.query('UPDATE email_outbox SET available_at=clock_timestamp()');
    for (let n = 0; n < 3; n++) assert.equal(await worker.runOnce(), true);
    assert.equal(await worker.runOnce(), false);
    const status = await worker.status(); assert.equal(status.counts.sent, 3); assert.equal(status.attempts, 4);
    assert.equal((await s.f.pool.query('SELECT count(*)::integer AS n FROM email_outbox WHERE payload IS NOT NULL OR key_id IS NOT NULL')).rows[0].n, 0);
    const captured = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/messages', { signal: AbortSignal.timeout(3000) });
    assert.equal(captured.status, 200);
    const messages = (await captured.json()).messages.filter(message => message.To.some(to => to.Address === email));
    assert.deepEqual(messages.map(message => message.Subject).sort(), ['Tu contraseña de Waitron Cloud ha cambiado',
      'Tu contraseña de Waitron Cloud ha cambiado', 'Your Waitron Cloud password changed']);
    const call = async (action, body, expectedStatus = 200) => {
      const response = await fiscalRun.request(action, body); assert.equal(response.statusCode, expectedStatus);
      // Only reserve retries; retain that failed request and its independent reply.
      bodyBytesOut += Buffer.byteLength(JSON.stringify(body)) * (calls === undefined ? 2 : 1);
      bodyBytesIn += response.body.length; calls = http.calls();
      return JSON.parse(response.body);
    };
    const reserved = await call('reserve', s.v.input); assert.equal(reserved.payload.state, 'reserved');
    assert.deepEqual(await call('reserve', s.v.input), reserved);
    const consume = { version: 1, operationId: randomUUID(), allocationId: reserved.payload.allocation.allocationId,
      binding: s.v.input.binding, oldMachineOffline: true, oldMachineAbsent: false, noParallelRecovery: true,
      confirmedAt: new Date().toISOString() };
    const consumed = await call('consume', consume); assert.equal(consumed.payload.state, 'consumed');
    const statusReply = await call('status', { version: 1, venueId: s.v.id, operationId: consume.operationId });
    assert.equal(statusReply.state, 'recorded'); assert.deepEqual(statusReply.receipt, consumed);
    const listed = await call('list', { version: 1, venueId: s.v.id, cursor: null, limit: 50 });
    assert.deepEqual(listed.items, [consumed]); assert.equal(listed.nextCursor, null);
    const report = await call('report', s.proof({ venueId: s.v.id, scope: s.v.input.scope, receipt: consumed,
      paperHistory: null, activationEvidence: { eventId: s.v.input.binding.eventId, result: 'committed' } }));
    assert.equal(report.state, 'matched'); assert.equal(report.receiptId, consumed.payload.receiptId);
    await call('reserve', { unexpected: true }, 400);
    assert.equal((await s.f.pool.query('SELECT c_high_water FROM fiscal_registry_scopes')).rows[0].c_high_water, 1);
    const events = (await s.a.request('history', { scope: s.v.input.scope, afterSequence: '0', nonce: 'test' })).events;
    assert.deepEqual(events.map(event => event.action), ['reserve', 'consume', 'report']);
    await mailRun.close(); await fiscalRun.close(); mail = mailRun.snapshot(); fiscal = fiscalRun.snapshot();
    sent = smtp.connections(); calls = http.calls();
  } finally {
    await collect(s, [mailRun, fiscalRun], [smtp, http]);
  }
  const endedAt = new Date().toISOString();
  const receipt = buildServiceReceipt({ metadata: { runId: randomUUID(), cloudRevision: process.env.COST_CLOUD_REVISION,
    window: { startedAt, endedAt, elapsedSeconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000 } },
    mail, fiscal, cleanup: { listeners: 0, clients: 0, schemas: 0 } });
  assert.equal(sent, 4); assert.equal(calls, 8);
  assert.deepEqual(receipt.summary.mail, { attempts: 4, accepted: 3, refused: 1, retried: 1, bytes: null });
  assert.deepEqual(receipt.summary.fiscal, { attempts: 8, successful: 6, failed: 2, retried: 1,
    bodyBytesIn: bodyBytesIn + Buffer.byteLength('Generated temporary refusal'), bodyBytesOut });
  assert.deepEqual(validateServiceReceipt(JSON.parse(JSON.stringify(receipt))), receipt);
  assert.equal([email, s.v.id, s.v.account, s.v.session.token, s.v.input.scope.taxpayerId, 'payload', 'signature', '127.0.0.1']
    .some(value => typeof value === 'string' && value.length > 0 && JSON.stringify(receipt).includes(value)), false);
  t.diagnostic(JSON.stringify(receipt));
});

test('serviceReceiptKeepsSignupRecoveryAndUnauthenticatedFiscalRefusalAsASeparateScenario', { timeout: 60000 }, async t => {
  const startedAt = new Date().toISOString(), s = await fiscalHttpFixture();
  const email = `generated-${randomUUID()}@example.test`; let mailRun, fiscalRun, mail, fiscal, bodyBytesIn, bodyBytesOut;
  try {
    mailRun = await openMailMeasurement({ target: `smtp://127.0.0.1:${process.env.MAILPIT_TEST_SMTP_PORT}` });
    fiscalRun = await openFiscalMeasurement({ target: `http://127.0.0.1:${s.port}`, clock: () => performance.now() / 1000 });
    const outbox = new EmailOutbox({ activeKeyId: 'generated', keys: { generated: randomBytes(32).toString('hex') } });
    const signup = new SignupStore(s.f.pool, outbox), recovery = new PasswordRecoveryStore(s.f.pool, outbox);
    const worker = new EmailWorker(s.f.pool, outbox, mailRun.wrapMailer(createLocalAccountMailer({ port: mailRun.port })));
    const capturedToken = async path => {
      const response = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/messages', { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200);
      for (const row of (await response.json()).messages.filter(m => m.To.some(to => to.Address === email))) {
        const detail = await fetch(process.env.MAILPIT_TEST_URL + '/api/v1/message/' + row.ID, { signal: AbortSignal.timeout(3000) });
        assert.equal(detail.status, 200);
        const match = (await detail.json()).Text.match(new RegExp('/' + path + '#token=([A-Za-z0-9_-]{43})'));
        if (match) return match[1];
      }
      assert.fail('Missing generated capture link');
    };
    await signup.request(email, 'es'); assert.equal(await worker.runOnce(), true);
    await signup.complete(await capturedToken('signup'), { password: 'Generated local fixture password',
      organisationName: 'Generated venue', legalBusinessName: 'Generated SL', countryCode: 'ES' });
    await recovery.request(email, 'en'); assert.equal(await worker.runOnce(), true);
    await recovery.complete(await capturedToken('reset-password'), 'Different generated fixture password', 'es');
    assert.equal(await worker.runOnce(), true); assert.equal(await worker.runOnce(), false);
    const status = await worker.status(); assert.equal(status.counts.sent, 3); assert.equal(status.attempts, 3); assert.equal(status.failures, 0);
    const response = await fiscalRun.request('reserve', s.v.input);
    assert.equal(response.statusCode, 401); assert.equal(JSON.parse(response.body).error, 'unauthenticated');
    bodyBytesIn = response.body.length; bodyBytesOut = Buffer.byteLength(JSON.stringify(s.v.input));
    assert.equal((await s.a.request('history', { scope: s.v.input.scope, afterSequence: '0', nonce: 'test' })).events.length, 0);
    await mailRun.close(); await fiscalRun.close(); mail = mailRun.snapshot(); fiscal = fiscalRun.snapshot();
  } finally { await collect(s, [mailRun, fiscalRun]); }
  const endedAt = new Date().toISOString();
  const receipt = buildServiceReceipt({ metadata: { runId: randomUUID(), cloudRevision: process.env.COST_CLOUD_REVISION,
    window: { startedAt, endedAt, elapsedSeconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000 } },
    mail, fiscal, cleanup: { listeners: 0, clients: 0, schemas: 0 } });
  assert.deepEqual(receipt.summary.mail, { attempts: 3, accepted: 3, refused: 0, retried: 0, bytes: null });
  assert.deepEqual(receipt.mail.operations.map(r => [r.action, r.retryOrdinal, r.attempts]),
    [['verification', 0, 1], ['password_reset', 0, 1], ['password_changed', 0, 1]]);
  assert.deepEqual(receipt.summary.fiscal, { attempts: 1, successful: 0, failed: 1, retried: 0, bodyBytesIn, bodyBytesOut });
  assert.deepEqual(validateServiceReceipt(JSON.parse(JSON.stringify(receipt))), receipt);
  assert.equal(JSON.stringify(receipt).includes(email), false);
  t.diagnostic(JSON.stringify(receipt));
});
