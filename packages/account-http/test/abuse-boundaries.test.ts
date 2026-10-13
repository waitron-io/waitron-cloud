import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync, randomBytes, randomUUID, sign} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {after, before, beforeEach, test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {hashSecret, login} from '@waitron-cloud/identity';
import {createLeaseIssuer, SignupStore, transaction} from '@waitron-cloud/registration';
import {BackupKeyVault} from '../../backups/src/keys.ts';
import {requestPayload} from '../../backups/src/recovery-request.ts';
import {pairingPayload, type PairingClaims} from '../../registration/src/pairing-proof.ts';
import {verifyCloudAbuseReceipt} from './abuse-receipt.ts';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';

const origin = 'https://cloud.example.test';
const password = 'A distinct café password';
let db: Awaited<ReturnType<typeof database>>;
let app: ReturnType<typeof createAccountApp>;
let other: ReturnType<typeof createAccountApp>;
let owner: {accountId: string; organisationId: string; legalBusinessId: string; email: string};
let session: {token: string; csrfToken: string};
const receipt: Record<string, any> = {
  schemaVersion: 1,
  cloudHead: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  cloudDirty: execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim() !== '',
  measuredAt: new Date().toISOString(),
  environment: {node: process.version, cpuModel: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length},
  account: {},
  operations: {},
};

const config = () => ({portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: [] as string[]});
const bindings = (peer: string) => ({incoming: {socket: {remoteAddress: peer}}}) as HttpBindings;
const captures = () => ({
  vault: new BackupKeyVault(randomBytes(32)),
  objects: () => ({async read() {throw new Error('unused');}, async put() {throw new Error('unused');}, async remove() {throw new Error('unused');}}),
  async grant() {throw new Error('unused');},
});

function request(path: string, body: unknown, peer: string, headers: Record<string, string> = {}, target = app) {
  return target.request(origin + path, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)}, bindings(peer));
}

function browserHeaders() {
  return {origin, cookie: `__Host-cloud_session=${session.token}; __Host-cloud_csrf=${session.csrfToken}`, 'x-csrf-token': session.csrfToken};
}

function pairingTarget() {
  const keys = generateKeyPairSync('ed25519');
  const claims: PairingClaims = {origin, action: 'start', requestId: randomUUID(), publicKey: keys.publicKey.export({type: 'spki', format: 'der'}).toString('base64url'), localVenueId: randomUUID(), environment: 'test', code: '12345678', organisationId: '', legalBusinessId: '', issuedAt: Date.now()};
  const proof = (action: PairingClaims['action']) => {
    const payload = pairingPayload({...claims, action, code: action === 'start' ? claims.code : '', organisationId: action === 'complete' ? owner.organisationId : '', legalBusinessId: action === 'complete' ? owner.legalBusinessId : '', issuedAt: Date.now()});
    return {payload: payload.toString('base64url'), signature: sign(null, payload, keys.privateKey).toString('base64url')};
  };
  return {claims, proof};
}

function recoveryTarget() {
  const keys = generateKeyPairSync('ed25519');
  const target = {id: randomUUID(), code: '12345678', publicKey: keys.publicKey.export({type: 'spki', format: 'der'}).toString('base64url')};
  const proof = (action: 'start' | 'status') => {
    const payload = requestPayload(origin, target.id, action, target.publicKey, target.code, Date.now());
    return {payload: payload.toString('base64url'), signature: sign(null, payload, keys.privateKey).toString('base64url')};
  };
  return {...target, proof};
}

function counts(responses: Response[], admittedStatus: number) {
  return {attempts: responses.length, admitted: responses.filter(response => response.status === admittedStatus).length, refused: responses.filter(response => response.status === 429).length};
}

function timings(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return {samples: ordered.length, min: ordered[0]!, median: ordered[Math.floor(ordered.length / 2)]!, max: ordered.at(-1)!};
}

before(async () => {db = await database();});
after(async () => {
  try {
    if (Object.keys(receipt.account).length && Object.keys(receipt.operations).length === 4) {
      const verified = verifyCloudAbuseReceipt(receipt);
      if (process.env.ABUSE_RECEIPT) await writeFile(process.env.ABUSE_RECEIPT, JSON.stringify(verified, null, 2) + '\n', {mode: 0o600});
      console.log(JSON.stringify(verified, null, 2));
    }
  } finally {await db?.close();}
});

beforeEach(async () => {
  await resetSchema(db.pool);
  const email = `owner-${randomUUID()}@example.test`;
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request(email);
  const queued = (await db.pool.query('SELECT * FROM email_outbox')).rows[0];
  const message = db.outbox.open(queued); assert.ok('token' in message);
  owner = {...await signup.complete(message.token, {password, organisationName: 'Café Sol', legalBusinessName: 'Café Sol SL', countryCode: 'ES'}), email};
  session = await transaction(db.pool, client => login(client, {email, password}));
  await db.pool.query('DELETE FROM account_rate_limits; DELETE FROM email_outbox; DELETE FROM password_reset_requests');
  const leaseIssuer = createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url'));
  const backup = captures();
  app = createAccountApp({pool: db.pool, outbox: db.outbox, config: config(), leaseIssuer, captures: backup});
  other = createAccountApp({pool: db.secondPool, outbox: db.outbox, config: config(), leaseIssuer, captures: backup});
});

test('account limits serialize under contention and the response floor covers known and unknown addresses', async () => {
  const hashDurations = await Promise.all(Array.from({length: 8}, async (_, index) => {
    const started = performance.now(); await hashSecret(`contention password ${index}`); return performance.now() - started;
  }));

  const measureLogin = async (email: string, peer: string, index: number) => {
    const started = performance.now();
    const response = await request('/api/account/login', {email, password: 'wrong password'}, peer, {origin}, index % 2 ? other : app);
    return {response, elapsed: performance.now() - started};
  };
  const timed = await Promise.all([
    ...Array.from({length: 8}, (_, index) => measureLogin(owner.email, `198.51.100.${index + 1}`, index)),
    ...Array.from({length: 8}, (_, index) => measureLogin(`missing-${index}@example.test`, `203.0.113.${index + 1}`, index)),
  ]);
  assert.ok(timed.every(result => result.response.status === 401));
  const known = timed.slice(0, 8).map(result => result.elapsed);
  const unknown = timed.slice(8).map(result => result.elapsed);
  assert.ok([...known, ...unknown].every(elapsed => elapsed >= 285));

  await db.pool.query('TRUNCATE account_rate_limits');
  const sharedIpResponses = await Promise.all(Array.from({length: 12}, (_, index) => request('/api/account/login', {email: owner.email, password: 'wrong password'}, '192.0.2.44', {origin}, index % 2 ? other : app)));
  assert.deepEqual(counts(sharedIpResponses, 401), {attempts: 12, admitted: 10, refused: 2});

  await db.pool.query('TRUNCATE account_rate_limits');
  const sharedAddressResponses = await Promise.all(Array.from({length: 30}, (_, index) => request('/api/account/login', {email: owner.email, password: 'wrong password'}, `192.0.2.${index + 1}`, {origin}, index % 2 ? other : app)));
  assert.ok(sharedAddressResponses.every(response => response.status === 401));
  const legitimate = await request('/api/account/login', {email: owner.email, password}, '198.51.100.200', {origin});
  assert.equal(legitimate.status, 429);

  await db.pool.query('DELETE FROM account_rate_limits; DELETE FROM email_outbox; DELETE FROM password_reset_requests');
  const cooldownResponses = await Promise.all(Array.from({length: 8}, (_, index) => request('/api/account/password-reset/request', {email: owner.email}, `203.0.113.${index + 1}`, {origin}, index % 2 ? other : app)));
  assert.ok(cooldownResponses.every(response => response.status === 202));
  const messagesQueued = Number((await db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='password_reset'")).rows[0].count);
  assert.equal(messagesQueued, 1);

  receipt.account = {
    sharedIp: counts(sharedIpResponses, 401),
    sharedAddress: {attempts: 31, admitted: 30, refused: 1, legitimateRefused: true},
    cooldown: {attempts: 8, accepted: cooldownResponses.length, messagesQueued},
    passwordHashMs: timings(hashDurations),
    responseFloorMs: {known: timings(known), unknown: timings(unknown)},
  };
});

test('shared-NAT machine limits admit exactly ten new pairing and recovery requests', async () => {
  const pairings = Array.from({length: 12}, pairingTarget);
  const pairingResponses = await Promise.all(pairings.map((target, index) => request('/api/pairing/start', target.proof('start'), '192.0.2.70', {}, index % 2 ? other : app)));
  assert.deepEqual(counts(pairingResponses, 200), {attempts: 12, admitted: 10, refused: 2});

  await db.pool.query('TRUNCATE account_rate_limits');
  const recoveries = Array.from({length: 12}, recoveryTarget);
  const recoveryResponses = await Promise.all(recoveries.map((target, index) => request('/api/recovery/start', target.proof('start'), '192.0.2.71', {}, index % 2 ? other : app)));
  assert.deepEqual(counts(recoveryResponses, 200), {attempts: 12, admitted: 10, refused: 2});
  receipt.operations.pairingSharedIp = counts(pairingResponses, 200);
  receipt.operations.recoverySharedIp = counts(recoveryResponses, 200);
});

test('guessed operation IDs do not spend a target budget while five concurrent known-ID guesses close it', async () => {
  const pairing = pairingTarget();
  assert.equal((await request('/api/pairing/start', pairing.proof('start'), '192.0.2.80')).status, 200);
  const guessedPairing = await Promise.all(Array.from({length: 5}, () => request('/api/account/pairing/inspect', {requestId: randomUUID(), code: '87654321'}, '192.0.2.81', browserHeaders())));
  assert.ok(guessedPairing.every(response => response.status === 400));
  assert.deepEqual(await Promise.all(guessedPairing.map(response => response.json())), Array(5).fill({error: 'pairing_unavailable'}));
  const pairingAfterGuesses = Number((await db.pool.query('SELECT failed_codes FROM pairing_requests WHERE id=$1', [pairing.claims.requestId])).rows[0].failed_codes);
  assert.equal(pairingAfterGuesses, 0);
  const knownPairing = await Promise.all(Array.from({length: 5}, () => request('/api/account/pairing/inspect', {requestId: pairing.claims.requestId, code: '87654321'}, '192.0.2.81', browserHeaders())));
  assert.ok(knownPairing.every(response => response.status === 400));
  assert.deepEqual(await Promise.all(knownPairing.map(response => response.json())), Array(5).fill({error: 'pairing_unavailable'}));
  const pairingFailures = Number((await db.pool.query('SELECT failed_codes FROM pairing_requests WHERE id=$1', [pairing.claims.requestId])).rows[0].failed_codes);
  assert.equal(pairingFailures, 5);
  const correctPairing = await request('/api/account/pairing/inspect', {requestId: pairing.claims.requestId, code: pairing.claims.code}, '192.0.2.81', browserHeaders());
  assert.equal(correctPairing.status, 400);

  const recovery = recoveryTarget();
  assert.equal((await request('/api/recovery/start', recovery.proof('start'), '192.0.2.82')).status, 200);
  const guessedRecovery = await Promise.all(Array.from({length: 5}, () => request('/api/account/recovery/inspect', {requestId: randomUUID(), code: '87654321'}, '192.0.2.83', browserHeaders())));
  assert.ok(guessedRecovery.every(response => response.status === 410));
  assert.deepEqual(await Promise.all(guessedRecovery.map(response => response.json())), Array(5).fill({error: 'unavailable'}));
  const recoveryAfterGuesses = Number((await db.pool.query('SELECT failed_codes FROM backup_recovery_requests WHERE id=$1', [recovery.id])).rows[0].failed_codes);
  assert.equal(recoveryAfterGuesses, 0);
  const knownRecovery = await Promise.all(Array.from({length: 5}, () => request('/api/account/recovery/inspect', {requestId: recovery.id, code: '87654321'}, '192.0.2.83', browserHeaders())));
  assert.ok(knownRecovery.every(response => response.status === 410));
  assert.deepEqual(await Promise.all(knownRecovery.map(response => response.json())), Array(5).fill({error: 'unavailable'}));
  const recoveryFailures = Number((await db.pool.query('SELECT failed_codes FROM backup_recovery_requests WHERE id=$1', [recovery.id])).rows[0].failed_codes);
  assert.equal(recoveryFailures, 5);
  const correctRecovery = await request('/api/account/recovery/inspect', {requestId: recovery.id, code: recovery.code}, '192.0.2.83', browserHeaders());
  assert.equal(correctRecovery.status, 410);

  receipt.operations.pairingCodes = {guessedIds: 5, targetFailuresAfterGuesses: pairingAfterGuesses, knownIdFailures: pairingFailures, correctCodeRefused: true};
  receipt.operations.recoveryCodes = {guessedIds: 5, targetFailuresAfterGuesses: recoveryAfterGuesses, knownIdFailures: recoveryFailures, correctCodeRefused: true};
});
