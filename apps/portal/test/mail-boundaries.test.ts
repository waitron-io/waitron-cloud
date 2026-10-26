import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {mailFor} from './fixtures.ts';
import {createMailCapture} from '../../../packages/account-http/test/mail-capture.ts';

// Losing queue/worker/SMTP evidence on a miss would hide the failed boundary again.
test('a missing portal message reports queue and inbox boundaries without message bodies', async t => {
  const token = 'private-reset-token';
  const server = createServer((_request, response) => response.end(JSON.stringify({messages: [
    {ID: 'private-message-id', Subject: 'Reset your Waitron Cloud password', To: [{Address: 'other@example.test'}], Text: token},
  ]})));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const before = process.env.MAILPIT_TEST_URL;
  process.env.MAILPIT_TEST_URL = `http://127.0.0.1:${address.port}`;
  t.after(() => {if (before === undefined) delete process.env.MAILPIT_TEST_URL; else process.env.MAILPIT_TEST_URL = before;});
  const evidence = async () => ({outbox: [{kind: 'password_reset', status: 'sent', attempts: 1}], worker: ['handled', 'idle'], smtp: ['accepted']});
  await assert.rejects(mailFor('owner@example.test', 'Reset your Waitron Cloud password', evidence), error => {
    assert.ok(error instanceof assert.AssertionError);
    assert.match(error.message, /Mail capture:/);
    const report = JSON.parse(error.message.split('Mail capture: ')[1]!);
    assert.deepEqual(report.outbox, [{kind: 'password_reset', status: 'sent', attempts: 1}]);
    assert.deepEqual(report.worker, ['handled', 'idle']); assert.deepEqual(report.smtp, ['accepted']);
    assert.deepEqual(report.inbox, {status: 200, listed: 1, subjectMatches: 1, recipientMatches: 0, combinedMatches: 0,
      messages: [{subject: 'Reset your Waitron Cloud password', recipients: ['other@example.test']}]});
    assert.ok(!error.message.includes(token) && !error.message.includes('private-message-id'));
    return true;
  });
});

test('portal evidence retains real worker and SMTP outcomes and filters database payloads', async () => {
  const send = async () => {};
  const pool = {async query() {return {rows: [{kind: 'password_reset', status: 'sent', attempts: 1, failures: 0,
    last_error: null, transport: null, has_message_id: false, token_hash: 'private-hash', payload: 'private-token'}]};}} as unknown as Parameters<typeof createMailCapture>[0]['pool'];
  const capture = createMailCapture({pool, inbox: 'http://127.0.0.1', mailer: {
    sendVerification: send, sendPasswordReset: send, sendPasswordChanged: send, sendServiceAlert: send,
  }});
  await capture.runOnce({async runOnce() {
    await capture.mailer.sendPasswordReset({email: 'owner@example.test', token: 'private-token', expiresAt: new Date().toISOString()});
    return true;
  }});
  await capture.runOnce({async runOnce() {return false;}});
  const report = await capture.evidence();
  assert.deepEqual(report.outbox, [{kind: 'password_reset', status: 'sent', attempts: 1, failures: 0, lastError: null, transport: 'none', hasMessageId: false}]);
  assert.deepEqual(report.worker.map(event => event.result), ['handled', 'idle']);
  assert.deepEqual(report.smtp.map(event => [event.kind, event.result]), [['password_reset', 'accepted']]);
  assert.ok(!JSON.stringify(report).includes('private-'));
});

test('a matching portal message returns its body without reading diagnostic data', async t => {
  const server = createServer((request, response) => response.end(JSON.stringify(request.url === '/api/v1/messages' ? {messages: [
    {ID: 'foreign', Subject: 'Reset your Waitron Cloud password', To: [{Address: 'other@example.test'}]},
    {ID: 'own', Subject: 'Reset your Waitron Cloud password', To: [{Address: 'owner@example.test'}]},
  ]} : {Text: request.url === '/api/v1/message/own' ? 'own reset link' : 'foreign reset link'})));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const before = process.env.MAILPIT_TEST_URL;
  process.env.MAILPIT_TEST_URL = `http://127.0.0.1:${address.port}`;
  t.after(() => {if (before === undefined) delete process.env.MAILPIT_TEST_URL; else process.env.MAILPIT_TEST_URL = before;});
  assert.equal(await mailFor('owner@example.test', 'Reset your Waitron Cloud password', async () => {
    assert.fail('successful mail capture must not read diagnostic data');
  }), 'own reset link');
});

test('unavailable evidence preserves the mail assertion and unexpected headers are redacted', async t => {
  const server = createServer((_request, response) => response.end(JSON.stringify({messages: [
    {ID: 'private-id', Subject: 'private-token', To: [{Address: 'private-token@outside.invalid'}], Snippet: 'private-body'},
  ]})));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const before = process.env.MAILPIT_TEST_URL;
  process.env.MAILPIT_TEST_URL = `http://127.0.0.1:${address.port}`;
  t.after(() => {if (before === undefined) delete process.env.MAILPIT_TEST_URL; else process.env.MAILPIT_TEST_URL = before;});
  await assert.rejects(mailFor('owner@example.test', 'Reset your Waitron Cloud password', async () => {throw new Error('private-query-error');}), error => {
    assert.ok(error instanceof assert.AssertionError);
    const report = JSON.parse(error.message.split('Mail capture: ')[1]!);
    assert.equal(report.boundaries, 'unavailable');
    assert.deepEqual(report.inbox.messages, [{subject: 'other', recipients: ['other']}]);
    assert.ok(!error.message.includes('private-'));
    return true;
  });
});
