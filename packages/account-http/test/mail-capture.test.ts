import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test, type TestContext} from 'node:test';
import {createMailCapture} from './mail-capture.ts';

const email = 'private-recipient@example.test';
const token = 's'.repeat(43);
const subject = 'Reset your Waitron Cloud password';
const privateError = new Error(`private SMTP response ${email} token=${token}`);
async function fixture(t: TestContext, options: {messages?: object[]; status?: number; text?: string; queryFails?: boolean; smtpFails?: boolean} = {}) {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/messages') {res.statusCode = options.status ?? 200; res.end(JSON.stringify({messages: options.messages ?? []}));}
    else res.end(JSON.stringify({Text: options.text ?? `Reset: token=${token}`}));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const send = async () => {if (options.smtpFails) throw privateError;};
  const pool = {async query() {
    if (options.queryFails) throw privateError;
    return {rows: [{kind: 'password_reset', status: 'sent', attempts: 1, failures: 0, last_error: null, transport: null,
      email, payload: `token=${token}`, message_id: 'private-message-id', has_message_id: false},
      {kind: email, status: token, attempts: email, failures: token, last_error: privateError.message, transport: email}]};
  }} as unknown as Parameters<typeof createMailCapture>[0]['pool'];
  const capture = createMailCapture({pool, inbox: `http://127.0.0.1:${address.port}`,
    mailer: {sendVerification: send, sendPasswordReset: send, sendPasswordChanged: send, sendServiceAlert: send}});
  return capture;
}
async function miss(capture: Awaited<ReturnType<typeof fixture>>) {
  try {await capture.tokenFromMail(email, subject); assert.fail('lookup must reject');}
  catch (error) {
    assert.ok(error instanceof assert.AssertionError);
    const message = error.message;
    assert.ok(!message.includes(email) && !message.includes(token) && !message.includes('private SMTP') && !message.includes('private-message-id'));
    const marker = 'Mail capture: ';
    assert.ok(message.includes(marker), 'missing Mail capture diagnostic');
    return JSON.parse(message.slice(message.indexOf(marker) + marker.length));
  }
}

test('a forced miss reports worker, SMTP, queue and inbox boundaries without private values', async t => {
  const capture = await fixture(t, {messages: [
    {ID: 'private-id', Subject: subject, To: [{Address: 'other@example.test'}]},
    {ID: 'private-id-2', Subject: `private ${token}`, To: [{Address: email}]},
  ]});
  await capture.runOnce({async runOnce() {await capture.mailer.sendPasswordReset({email, token, expiresAt: new Date().toISOString()}); return true;}});
  const diagnostic = await miss(capture);
  assert.deepEqual(diagnostic.worker.map((event: {result: string}) => event.result), ['handled']);
  assert.deepEqual(diagnostic.smtp.map((event: {kind: string; result: string}) => [event.kind, event.result]), [['password_reset', 'accepted']]);
  assert.deepEqual(diagnostic.outbox, [
    {kind: 'password_reset', status: 'sent', attempts: 1, failures: 0, lastError: null, transport: 'none', hasMessageId: false},
    {kind: 'other', status: 'other', attempts: null, failures: null, lastError: 'other', transport: 'other', hasMessageId: false},
  ]);
  assert.deepEqual(diagnostic.inbox, {status: 200, listed: 2, subjectMatches: 1, recipientMatches: 1, combinedMatches: 0});
});

test('an SMTP rejection and idle worker remain distinct from successful handoff', async t => {
  const capture = await fixture(t, {smtpFails: true});
  await assert.rejects(capture.mailer.sendPasswordReset({email, token, expiresAt: new Date().toISOString()}), error => error === privateError);
  assert.equal(await capture.runOnce({async runOnce() {return false;}}), false);
  const diagnostic = await miss(capture);
  assert.equal(diagnostic.smtp[0].result, 'rejected');
  assert.equal(diagnostic.worker[0].result, 'idle');
});

test('worker errors are rethrown and a failed diagnostic query preserves the lookup assertion', async t => {
  const capture = await fixture(t, {queryFails: true});
  await assert.rejects(capture.runOnce({async runOnce() {throw privateError;}}), error => error === privateError);
  const diagnostic = await miss(capture);
  assert.equal(diagnostic.worker[0].result, 'failed');
  assert.equal(diagnostic.outbox, 'unavailable');
});

test('a message with no token reports the detail boundary without including its body', async t => {
  const capture = await fixture(t, {messages: [{ID: 'private-id', Subject: subject, To: [{Address: email}]}], text: `private body ${email}`});
  const diagnostic = await miss(capture);
  assert.equal(diagnostic.stage, 'token');
  assert.equal(diagnostic.detailStatus, 200);
  assert.equal(diagnostic.inbox.combinedMatches, 1);
});

test('successful capture returns the same token without diagnostic database work', async t => {
  const capture = await fixture(t, {messages: [{ID: 'private-id', Subject: subject, To: [{Address: email}]}], queryFails: true});
  assert.equal(await capture.tokenFromMail(email, subject), token);
});
