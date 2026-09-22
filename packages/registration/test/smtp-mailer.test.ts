import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer, type TLSSocket } from 'node:tls';
import { inspect, promisify } from 'node:util';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import { setTimeout as delay } from 'node:timers/promises';
import { EmailOutbox } from '../src/email-outbox.ts';
import { SignupStore } from '../src/signup.ts';
import { migrate } from '../src/migrate.ts';
import { configuredAccountMailer } from '../src/configured-mailer.ts';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { createSmtpAccountMailer, type SmtpAccountMailConfig } from '../src/smtp-mailer.ts';

const directory = mkdtempSync(join(tmpdir(), 'cloud-smtp-'));
let key: Buffer; let cert: Buffer;
const base = {host: '127.0.0.1', user: 'cloud-test', password: 'test-only-secret', from: 'accounts@example.test', portalOrigin: 'https://cloud.example.test'};
const message = () => ({email: 'owner@example.test', token: randomBytes(32).toString('base64url'), expiresAt: new Date(Date.now() + 1800000).toISOString()});
const context = () => ({deliveryId: randomUUID(), signal: new AbortController().signal});
before(() => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'),
    '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=SMTP test', '-addext', 'subjectAltName=IP:127.0.0.1'], {stdio: 'ignore'});
  key = readFileSync(join(directory, 'key.pem')); cert = readFileSync(join(directory, 'cert.pem'));
});
after(() => rmSync(directory, {recursive: true, force: true}));
async function server(options: SMTPServerOptions = {}) {
  const data: {raw: string; secure: boolean; to: string[]; from: string}[] = [];
  const smtp = new SMTPServer({secure: true, key, cert, logger: false, hideSTARTTLS: true,
    onAuth(auth, _session, callback) {
      if (auth.username === base.user && auth.password === base.password) callback(null, {user: 'cloud'});
      else callback(new Error('invalid credential'));
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {data.push({raw: Buffer.concat(chunks).toString(), secure: session.secure,
        to: session.envelope.rcptTo.map(to => to.address), from: session.envelope.mailFrom && session.envelope.mailFrom.address || ''}); callback();});
    }, ...options});
  smtp.on('error', () => {});
  let connections = 0; smtp.server.on('connection', () => {connections++;});
  await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve));
  const address = smtp.server.address(); assert.ok(address && typeof address !== 'string');
  return {data, get connections() {return connections;}, port: address.port, close: () => new Promise<void>(resolve => smtp.close(resolve))};
}
const readable = (raw: string) => raw.replace(/=\r\n/g, '').replace(/=3D/g, '=');

test('production adapter authenticates over verified TLS and sends all account messages with stable IDs', async () => {
  const smtp = await server(); const oldEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const mailer = createSmtpAccountMailer({...base, port: smtp.port}, {ca: cert});
    const content = message(); const delivery = context();
    const receipt = await mailer.sendVerification(content, delivery);
    assert.deepEqual(receipt, {transport: 'smtp', messageId: `<${delivery.deliveryId}@example.test>`});
    await mailer.sendVerification(content, delivery);
    await mailer.sendPasswordReset(content, context());
    await mailer.sendPasswordChanged({email: content.email}, context());
    assert.equal(smtp.data.length, 4);
    for (const captured of smtp.data) {
      assert.equal(captured.secure, true); assert.deepEqual(captured.to, [content.email]); assert.equal(captured.from, base.from);
      assert.ok(!captured.raw.includes(base.password));
    }
    assert.ok(readable(smtp.data[0]!.raw).includes(`https://cloud.example.test/signup?token=${content.token}`));
    for (const captured of smtp.data.slice(0, 2)) assert.ok(captured.raw.includes(receipt.messageId));
    assert.ok(readable(smtp.data[2]!.raw).includes(`https://cloud.example.test/reset-password?token=${content.token}`));
    assert.ok(smtp.data[3]!.raw.includes('Your Waitron Cloud password changed'));
    assert.ok(!smtp.data[3]!.raw.includes(content.token));
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    await smtp.close();
  }
});

test('untrusted TLS certificates fail closed without sending mail', async () => {
  const smtp = await server();
  try {
    await assert.rejects(createSmtpAccountMailer({...base, port: smtp.port}).sendVerification(message(), context()), {code: 'delivery_configuration'});
    assert.equal(smtp.data.length, 0);
  } finally { await smtp.close(); }
});

test('SMTP response classes become fixed errors with no recipient, token or provider detail', async () => {
  for (const [responseCode, code, retryable] of [[451, 'delivery_deferred', true], [550, 'delivery_rejected', false]] as const) {
    const content = message();
    const smtp = await server({onRcptTo(_address, _session, callback) { callback(Object.assign(new Error(`relay-private-diagnostic:${content.token} ${content.email}`), {responseCode})); }});
    try {
      await assert.rejects(createSmtpAccountMailer({...base, port: smtp.port}, {ca: cert}).sendVerification(content, context()), error => {
        assert.ok(error && typeof error === 'object');
        assert.equal((error as {code: string}).code, code); assert.equal((error as {retryable: boolean}).retryable, retryable);
        for (const secret of [content.token, content.email, base.password, 'relay-private-diagnostic:']) assert.ok(!inspect(error).includes(secret));
        return true;
      });
      assert.equal(smtp.data.length, 0);
    } finally { await smtp.close(); }
  }
  const smtp = await server();
  try { await assert.rejects(createSmtpAccountMailer({...base, port: smtp.port, password: 'incorrect'}, {ca: cert}).sendVerification(message(), context()), {code: 'delivery_configuration', retryable: true}); }
  finally { await smtp.close(); }
});

test('total timeout and caller cancellation close a stalled TLS connection', async () => {
  for (const external of [false, true]) {
    const sockets = new Set<TLSSocket>();
    let connected!: () => void; const connection = new Promise<void>(resolve => {connected = resolve;});
    let closed!: () => void; const disconnection = new Promise<void>(resolve => {closed = resolve;});
    const smtp = createTlsServer({key, cert}, socket => {
      sockets.add(socket); socket.on('error', () => {}); socket.resume(); connected();
      socket.once('close', () => {sockets.delete(socket); closed();});
    });
    smtp.on('tlsClientError', () => {});
    await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve));
    const address = smtp.address(); assert.ok(address && typeof address !== 'string');
    const cancel = new AbortController();
    try {
      const mailer = createSmtpAccountMailer({...base, port: address.port, timeoutMs: external ? 5000 : 100}, {ca: cert});
      const sending = assert.rejects(mailer.sendVerification(message(), {deliveryId: randomUUID(), signal: cancel.signal}), {code: 'delivery_timeout'});
      void sending.catch(() => {});
      await Promise.race([connection, new Promise((_, reject) => {const timer = setTimeout(() => reject(new Error('TLS connection did not open')), 1000); timer.unref();})]);
      if (external) cancel.abort();
      await sending;
      await Promise.race([disconnection, new Promise((_, reject) => {const timer = setTimeout(() => reject(new Error('TLS socket remained open')), 1000); timer.unref();})]);
      assert.equal(sockets.size, 0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => smtp.close(() => resolve()));
    }
  }
});

test('invalid production configuration is rejected without exposing supplied values', () => {
  for (const change of [
    {host: ''}, {host: 'smtp://user:secret@example.test'}, {port: 0}, {port: 1.5}, {user: ''}, {password: ''},
    {from: 'bad\r\nBcc: leak@example.test'}, {portalOrigin: 'http://cloud.example.test'},
    {portalOrigin: 'https://user:secret@cloud.example.test'}, {portalOrigin: 'https://cloud.example.test/path'},
    {portalOrigin: 'https://localhost'}, {portalOrigin: 'not a url'}, {timeoutMs: 0}, {timeoutMs: 15001},
  ]) assert.throws(() => createSmtpAccountMailer({...base, ...change} as SmtpAccountMailConfig), {message: 'Invalid production mail configuration'});
});


test('a trusted certificate for a different hostname is rejected', async () => {
  const smtp = await server();
  try {
    await assert.rejects(createSmtpAccountMailer({...base, host: 'localhost', port: smtp.port}, {ca: cert})
      .sendVerification(message(), context()), {code: 'delivery_configuration'});
    assert.equal(smtp.data.length, 0);
  } finally { await smtp.close(); }
});

test('production requires explicit SMTP selection and never falls back to local delivery', () => {
  const original = process.env;
  try {
    for (const mode of [undefined, 'local', 'unknown']) {
      process.env = {NODE_ENV: 'production', ...(mode === undefined ? {} : {CLOUD_MAIL_TRANSPORT: mode})};
      assert.throws(() => configuredAccountMailer(), {message: 'Invalid email transport configuration'});
    }
    process.env = {NODE_ENV: 'production', CLOUD_MAIL_TRANSPORT: 'smtp'};
    assert.throws(() => configuredAccountMailer(), {message: 'Invalid production mail configuration'});
    process.env = {};
    assert.ok(configuredAccountMailer().sendVerification);
  } finally {process.env = original;}
});

test('production CLI delivers queued signup through authenticated TLS and records its receipt', {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const schema = `smtp_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
  const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`});
  const smtp = await server();
  const keys = {test: randomBytes(32).toString('hex')};
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const signup = new SignupStore(pool, new EmailOutbox({activeKeyId: 'test', keys}));
    await signup.request('owner@example.test');
    const env = {...process.env, NODE_ENV: 'production', DATABASE_URL: process.env.TEST_DATABASE_URL,
      PGOPTIONS: `-c search_path=${schema}`, CLOUD_EMAIL_ACTIVE_KEY_ID: 'test', CLOUD_EMAIL_KEYS: JSON.stringify(keys),
      CLOUD_MAIL_TRANSPORT: 'smtp', CLOUD_SMTP_HOST: base.host, CLOUD_SMTP_PORT: String(smtp.port),
      CLOUD_SMTP_USER: base.user, CLOUD_SMTP_PASSWORD: base.password, CLOUD_MAIL_FROM: base.from,
      CLOUD_PORTAL_ORIGIN: base.portalOrigin, NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem')};
    const cli = () => promisify(execFile)(process.execPath, ['src/email-worker-cli.ts', '--once'], {env, timeout: 10000});
    env.CLOUD_SMTP_PASSWORD = 'incorrect';
    const failed = await cli();
    assert.equal(JSON.parse(failed.stdout).failures, 1);
    let record = (await pool.query('SELECT * FROM email_outbox')).rows[0];
    assert.equal(record.status, 'pending'); assert.equal(record.last_error, 'delivery_configuration');
    assert.equal(smtp.data.length, 0);
    env.CLOUD_SMTP_PASSWORD = base.password;
    await pool.query("UPDATE email_outbox SET available_at = clock_timestamp()");
    const sent = await cli();
    assert.equal(JSON.parse(sent.stdout).counts.sent, 1);
    record = (await pool.query('SELECT * FROM email_outbox')).rows[0];
    assert.equal(record.transport, 'smtp'); assert.equal(record.message_id, `<${record.id}@example.test>`);
    assert.equal(record.payload, null); assert.equal(record.attempts, 2);
    assert.equal(smtp.data.length, 1); assert.ok(smtp.data[0]!.raw.includes(record.message_id));
    const token = readable(smtp.data[0]!.raw).match(/signup\?token=([A-Za-z0-9_-]{43})/)?.[1];
    assert.ok(token);
    const account = await signup.complete(token, {password: 'A long unique test password', organisationName: 'Venue', legalBusinessName: 'Venue SL', countryCode: 'ES'});
    assert.ok(account.accountId);
    for (const output of [failed.stdout, failed.stderr, sent.stdout, sent.stderr]) {
      for (const secret of [base.password, token, 'owner@example.test', keys.test]) assert.ok(!output.includes(secret));
    }
  } finally {
    await smtp.close(); await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
});


test('cancelling during message preparation prevents a later SMTP connection', async t => {
  const smtp = await server();
  const original = nodemailer.createTransport;
  let finishPreparation!: () => void;
  let prepared!: () => void;
  const preparation = new Promise<void>(resolve => {prepared = resolve;});
  t.mock.method(nodemailer, 'createTransport', (options: Parameters<typeof original>[0]) => {
    const transport = original(options);
    transport.use('compile', (_mail, callback) => {finishPreparation = callback; prepared();});
    return transport;
  });
  const cancel = new AbortController();
  try {
    const sending = assert.rejects(createSmtpAccountMailer({...base, port: smtp.port}, {ca: cert})
      .sendVerification(message(), {deliveryId: randomUUID(), signal: cancel.signal}), {code: 'delivery_timeout'});
    await preparation; cancel.abort(); await sending;
    finishPreparation(); await delay(100);
    assert.equal(smtp.connections, 0);
  } finally { await smtp.close(); }
});

test('malformed recipients are rejected before connecting to SMTP', async () => {
  for (const email of ['bad\r\nBcc: leak@example.test', 'Owner@EXAMPLE.TEST', 'not an email']) {
    await assert.rejects(createSmtpAccountMailer(base).sendVerification({...message(), email}), {code: 'delivery_rejected'});
  }
});

test('a successful transport reply must accept exactly one recipient without rejections', async t => {
  for (const result of [{accepted: [], rejected: []}, {accepted: ['owner@example.test'], rejected: ['another@example.test']}]) {
    t.mock.method(nodemailer, 'createTransport', () => ({async sendMail() {return result;}, close() {}}));
    await assert.rejects(createSmtpAccountMailer(base).sendVerification(message()), {code: 'delivery_rejected'});
    t.mock.restoreAll();
  }
});
