import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {createTransport} from 'nodemailer';
import {SMTPServer} from 'smtp-server';
import {smtp} from './fixtures/relay-stop-barrier.ts';

// A real bind refusal must reject setup with its original error, rather than
// leave the caller waiting for a listening callback that will never arrive.
test('relay stop SMTP fixture rejects an occupied listener port', async t => {
  const occupied = createServer();
  await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address(); assert.ok(address && typeof address !== 'string');
  let attempted: SMTPServer | undefined;
  let report!: (error: NodeJS.ErrnoException) => void;
  const failed = new Promise<NodeJS.ErrnoException>(resolve => {report = resolve;});
  t.mock.method(SMTPServer.prototype, 'listen', function(this: SMTPServer, _port: number, host: string, ready: () => void) {
    attempted = this;
    this.once('error', report);
    return this.server.listen(address.port, host, ready);
  });
  let outcome: unknown = 'pending';
  try {
    void smtp(t).then(value => {outcome = value;}, error => {outcome = error;});
    const error = await failed;
    assert.equal(error.code, 'EADDRINUSE');
    await setImmediate();
    assert.equal(outcome, error, 'setup must reject with the original listener error');
    assert.equal(occupied.listening, true, 'the competing listener belongs to another caller');
  } finally {
    if (attempted) await new Promise<void>(resolve => attempted!.close(resolve));
    await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
  }
});

test('relay stop SMTP fixture captures mail and closes its listener after the test', async t => {
  let server: SMTPServer | undefined;
  t.after(async () => {
    if (server?.server.listening) await new Promise<void>(resolve => server!.close(resolve));
  });
  await t.test('mail delivery', async child => {
    const fixture = await smtp(child); server = fixture.server;
    const transport = createTransport({host: '127.0.0.1', port: fixture.port, secure: false, ignoreTLS: true});
    try {
      await transport.sendMail({from: 'sender@example.test', to: 'recipient@example.test', subject: 'Fixture delivery', text: 'Local fixture message'});
      assert.equal(fixture.captured.length, 1);
      assert.match(fixture.captured[0]!, /Subject: Fixture delivery/);
      assert.match(fixture.captured[0]!, /Local fixture message/);
      assert.doesNotThrow(() => fixture.server.emit('error', new Error('later connection error')));
    } finally {transport.close();}
  });
  assert.ok(server);
  assert.equal(server.server.listening, false, 'test teardown closes the owned listener');
});
