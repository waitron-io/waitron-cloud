import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {RelayControl} from '../src/relay-control.ts';
import {RelayWorker} from '../src/relay-worker.ts';
import {EmailOutbox, EmailWorker} from '../src/email-outbox.ts';
import {SignupStore} from '../src/signup.ts';
import {PasswordRecoveryStore} from '../src/password-recovery.ts';
import {MonitorWorker} from '../src/monitoring.ts';
import {createLocalAccountMailer} from '../src/local-mailer.ts';
import {deferred, processWorker, setup, smtp, spend, waitLock} from './fixtures/relay-stop-barrier.ts';

test('relay fixture keeps the one-hour lease valid when successive clock reads advance', async t => {
  const f = await setup(t), original = Date.now, base = original(); let ticks = 0;
  try {Date.now = () => base + ticks++; await assert.doesNotReject(f.venue(), 'fixture lease must respect the one-hour maximum');}
  finally {Date.now = original;}
});

test('two persistent workers pause, restart and resume without mutating queued work or spend', async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue();
  const ready = await v.submit(), delayed = await v.submit(), expired = await v.submit();
  await f.pool.query("UPDATE relay_messages SET available_at=clock_timestamp()+interval '1 hour' WHERE message_id=$1", [delayed.messageId]);
  await f.pool.query("UPDATE relay_messages SET expires_at=clock_timestamp()-interval '1 second' WHERE message_id=$1", [expired.messageId]);
  const before = (await f.pool.query('SELECT * FROM relay_messages ORDER BY message_id')).rows, budget = await spend(f.pool);
  let one = await processWorker(t, f, s.port), two = await processWorker(t, f, s.port);
  await new RelayControl(f.pool).stop();
  for (let i = 0; i < 2; i++) assert.deepEqual(await Promise.all([one.command('run'), two.command('run')]), [false, false]);
  assert.deepEqual((await f.pool.query('SELECT * FROM relay_messages ORDER BY message_id')).rows, before);
  assert.deepEqual(await spend(f.pool), budget); assert.equal(s.captured.length, 0);
  await Promise.all([one.close(), two.close()]);
  one = await processWorker(t, f, s.port); two = await processWorker(t, f, s.port);
  assert.deepEqual(await Promise.all([one.command('run'), two.command('run')]), [false, false]);
  await new RelayControl(f.pool).resume();
  assert.deepEqual(await Promise.all([one.command('run'), two.command('run')]), [true, true]);
  assert.equal((await f.row(ready.messageId)).state, 'accepted'); assert.equal((await f.row(expired.messageId)).state, 'expired');
  assert.deepEqual(await f.row(delayed.messageId), before.find(row => row.message_id === delayed.messageId));
  await f.pool.query('UPDATE relay_messages SET available_at=clock_timestamp() WHERE message_id=$1', [delayed.messageId]);
  await Promise.all([one.command('run'), two.command('run')]);
  assert.equal((await f.row(delayed.messageId)).state, 'accepted'); assert.equal(s.captured.length, 2);
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count, '3');
});

test('stop holding UPDATE wins before a worker can claim', async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit();
  const w = await processWorker(t, f, s.port), held = await f.pool.connect();
  let run: Promise<unknown> | undefined;
  const before = await f.row(body.messageId);
  try {
    await held.query('BEGIN'); const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query('UPDATE relay_control SET stopped=true');
    run = w.command('run'); void run.catch(() => {});
    await waitLock(f.pool, w.name, 'FOR SHARE', pid);
    await held.query('COMMIT'); assert.equal(await run, false);
    assert.deepEqual(await f.row(body.messageId), before); assert.equal(s.captured.length, 0);
  } finally {await held.query('ROLLBACK'); held.release(); await run?.catch(() => {});}
});

test('stopped claim never commits a queued token even when handoff would clean it', async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit();
  const before = await f.row(body.messageId), w = await processWorker(t, f, s.port);
  await new RelayControl(f.pool).stop();
  const run = w.command('run', {pauseClaim: true}); void run.catch(() => {});
  try {
    const outcome = await Promise.race([run.then(result => ({result})), w.claimed.then(() => ({result: 'claimed'}))]);
    assert.deepEqual(outcome, {result: false}, 'stopped claim must not commit a token');
    assert.deepEqual(await f.row(body.messageId), before);
  } finally {w.release(); await run.catch(() => {});}
});

test('handoff takes control before message identity and stop wins without SMTP', async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit();
  const before = await f.row(body.messageId), w = await processWorker(t, f, s.port);
  const run = w.command('run', {pauseClaim: true}); void run.catch(() => {});
  const held = await f.pool.connect(), identity = await f.pool.connect();
  try {
    await w.claimed;
    await identity.query('BEGIN');
    await identity.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-message:'||$1||':'||$2,0))", [v.installation, body.messageId]);
    await held.query('BEGIN'); const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query('UPDATE relay_control SET stopped=true'); w.release();
    await waitLock(f.pool, w.name, 'FOR SHARE', pid);
    await held.query('COMMIT'); await identity.query('COMMIT'); await run;
    assert.deepEqual(await f.row(body.messageId), before); assert.equal(s.captured.length, 0);
  } finally {await held.query('ROLLBACK'); held.release(); await identity.query('ROLLBACK'); identity.release(); w.release(); await run.catch(() => {});}
});

test('claim SHARE blocks stop through commit and stopped handoff releases only its queued token', async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit();
  const before = await f.row(body.messageId), budget = await spend(f.pool);
  const w = await processWorker(t, f, s.port), writer = f.labelled('stop'), held = await f.pool.connect();
  let run: Promise<unknown> | undefined, stop: Promise<unknown> | undefined;
  try {
    await held.query('BEGIN'); const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-worker-capacity',0))");
    run = w.command('run', {pauseClaim: true}); void run.catch(() => {});
    const workerPid = await waitLock(f.pool, w.name, 'relay-worker-capacity', pid);
    stop = new RelayControl(writer.pool).stop(); void stop.catch(() => {});
    await waitLock(f.pool, writer.name, 'FOR UPDATE', workerPid);
    await held.query('COMMIT'); await w.claimed;
    assert.ok((await f.row(body.messageId)).claim_id, 'claim committed before handoff');
    assert.deepEqual(await stop, {stopped: true}); w.release(); assert.equal(await run, true);
    assert.deepEqual(await f.row(body.messageId), before); assert.deepEqual(await spend(f.pool), budget); assert.equal(s.captured.length, 0);
  } finally {await held.query('ROLLBACK'); held.release(); w.release(); await Promise.all([run?.catch(() => {}), stop?.catch(() => {})]);}
});

for (const variant of ['stolen', 'expired', 'cancelled', 'sending'] as const) test(`stopped handoff preserves a ${variant} claim boundary`, async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit();
  const w = await processWorker(t, f, s.port), run = w.command('run', {pauseClaim: true}); void run.catch(() => {});
  try {
    await w.claimed; await new RelayControl(f.pool).stop();
    if (variant === 'stolen') await f.pool.query('UPDATE relay_messages SET claim_id=$1 WHERE message_id=$2', [randomUUID(), body.messageId]);
    if (variant === 'expired') await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second' WHERE message_id=$1", [body.messageId]);
    if (variant === 'cancelled') await v.cancel(body.messageId);
    if (variant === 'sending') await f.pool.query("UPDATE relay_messages SET state='sending',attempts=1,status_revision=2 WHERE message_id=$1", [body.messageId]);
    const before = await f.row(body.messageId), budget = await spend(f.pool);
    w.release(); await assert.doesNotReject(run, 'stopped handoff must preserve the current state without a database error'); assert.equal(await run, true);
    assert.deepEqual(await f.row(body.messageId), variant === 'expired' ? {...before, claim_id: null, lease_until: null} : before);
    assert.deepEqual(await spend(f.pool), budget); assert.equal(s.captured.length, 0);
  } finally {w.release(); await run.catch(() => {});}
});

for (const outcome of ['accepted', 'refused', 'retryable', 'uncertain'] as const) test(`sending committed before stop records real ${outcome} outcome without holding a database client`, async t => {
  const f = await setup(t), v = await f.venue(), body = await v.submit(), reached = deferred(), release = deferred();
  const s = await smtp(t, outcome === 'refused' || outcome === 'retryable' ? {
    onRcptTo(_address, _session, done) {reached.resolve(); void release.promise.then(() => done(Object.assign(new Error('local refusal'), {responseCode: outcome === 'refused' ? 550 : 451})));},
  } : {
    onData(stream, _session, done) {stream.resume(); stream.on('end', () => {
      reached.resolve(); void release.promise.then(() => {
        if (outcome === 'uncertain') for (const connection of (s.server as any).connections) connection.close();
        else done();
      });
    });},
  });
  const w = await processWorker(t, f, s.port), writer = f.labelled('stop'), held = await f.pool.connect();
  let run: Promise<unknown> | undefined, stop: Promise<unknown> | undefined;
  try {
    await held.query('BEGIN'); const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-suppression',0))");
    run = w.command('run'); void run.catch(() => {});
    const workerPid = await waitLock(f.pool, w.name, 'relay-suppression', pid);
    stop = new RelayControl(writer.pool).stop(); void stop.catch(() => {});
    await waitLock(f.pool, writer.name, 'FOR UPDATE', workerPid);
    await held.query('COMMIT'); await reached.promise;
    assert.deepEqual(await stop, {stopped: true});
    assert.equal((await f.row(body.messageId)).state, 'sending');
    const status = await Promise.race([w.command('status'), delay(1000).then(() => 'blocked')]);
    assert.notEqual(status, 'blocked', 'the sole worker database client is released during SMTP'); assert.equal(status.counts.sending, 1);
    release.resolve(); assert.equal(await run, true);
    const row = await f.row(body.messageId);
    assert.equal(row.state, {accepted: 'accepted', refused: 'failed', retryable: 'queued', uncertain: 'uncertain'}[outcome]);
    assert.equal(row.attempts, 1); assert.equal(row.status_revision, 3);
    if (outcome === 'retryable') {
      assert.ok(row.payload); assert.ok(row.available_at.getTime() - Date.now() > 25000);
      const before = await f.row(body.messageId); assert.equal(await w.command('run'), false); assert.deepEqual(await f.row(body.messageId), before);
    } else assert.equal(row.payload, null);
  } finally {release.resolve(); await held.query('ROLLBACK'); held.release(); await Promise.all([run?.catch(() => {}), stop?.catch(() => {})]);}
});

test('stop after sending commit still permits the pending SMTP connection and truthful acceptance', async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit();
  const w = await processWorker(t, f, s.port), run = w.command('run', {pauseSending: true}); void run.catch(() => {});
  try {
    await w.sending; assert.equal(s.captured.length, 0); assert.equal((await f.row(body.messageId)).state, 'sending');
    assert.deepEqual(await new RelayControl(f.pool).stop(), {stopped: true});
    w.release(); assert.equal(await run, true);
    assert.equal((await f.row(body.messageId)).state, 'accepted'); assert.equal((await f.row(body.messageId)).attempts, 1);
    assert.equal(s.captured.length, 1);
  } finally {w.release(); await run.catch(() => {});}
});

test('stopped recovery reaps expired sending once and fences a late SMTP reply', async t => {
  const f = await setup(t), v = await f.venue(), body = await v.submit(), reached = deferred(), release = deferred();
  const s = await smtp(t, {onData(stream, _session, done) {stream.resume(); stream.on('end', () => {reached.resolve(); void release.promise.then(() => done());});}});
  const w = await processWorker(t, f, s.port), other = await processWorker(t, f, s.port), run = w.command('run'); void run.catch(() => {});
  try {
    await reached.promise; await new RelayControl(f.pool).stop();
    await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second' WHERE message_id=$1", [body.messageId]);
    assert.equal(await other.command('run'), true);
    const before = await f.row(body.messageId); assert.equal(before.state, 'uncertain'); assert.equal(before.payload, null);
    release.resolve(); await run; assert.deepEqual(await f.row(body.messageId), before); assert.equal(await other.command('run'), false);
  } finally {release.resolve(); await run.catch(() => {});}
});

test('killed sending worker restarts stopped and recovers without resending', async t => {
  const f = await setup(t), v = await f.venue(), body = await v.submit(), reached = deferred(); let sends = 0;
  const s = await smtp(t, {onData(stream) {stream.resume(); stream.on('end', () => {sends++; reached.resolve();});}});
  const w = await processWorker(t, f, s.port), run = w.command('run'); void run.catch(() => {});
  await reached.promise; await new RelayControl(f.pool).stop(); await w.kill(); await run.catch(() => {});
  await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second' WHERE message_id=$1", [body.messageId]);
  const restarted = await processWorker(t, f, s.port);
  assert.equal(await restarted.command('run'), true); assert.equal((await f.row(body.messageId)).state, 'uncertain');
  assert.equal((await f.row(body.messageId)).payload, null); assert.equal(await restarted.command('run'), false); assert.equal(sends, 1);
});

for (const phase of ['claim', 'handoff'] as const) test(`missing control refuses ${phase} without SMTP or additional attempts`, async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit(), w = await processWorker(t, f, s.port);
  let run: Promise<unknown> | undefined;
  try {
    if (phase === 'handoff') {run = w.command('run', {pauseClaim: true}); void run.catch(() => {}); await w.claimed;}
    await f.pool.query('DELETE FROM relay_control');
    const before = await f.row(body.messageId);
    if (phase === 'claim') run = w.command('run'); else w.release();
    await assert.rejects(run!, {code: 'relay_unavailable'});
    assert.deepEqual(await f.row(body.messageId), before); assert.equal(s.captured.length, 0);
  } finally {w.release(); await run?.catch(() => {});}
});

for (const phase of ['claim', 'handoff'] as const) test(`database failure during ${phase} refuses work and releases transaction locks`, async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue(), body = await v.submit(), w = await processWorker(t, f, s.port);
  const held = await f.pool.connect(); let run: Promise<unknown> | undefined;
  try {
    if (phase === 'handoff') {run = w.command('run', {pauseClaim: true}); void run.catch(() => {}); await w.claimed;}
    const before = await f.row(body.messageId);
    await held.query('BEGIN'); const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await held.query('SELECT * FROM relay_control FOR UPDATE');
    if (phase === 'claim') {run = w.command('run'); void run.catch(() => {});} else w.release();
    const workerPid = await waitLock(f.pool, w.name, 'FOR SHARE', pid);
    assert.equal((await f.pool.query('SELECT pg_cancel_backend($1) AS cancelled', [workerPid])).rows[0].cancelled, true);
    await assert.rejects(run!, {code: '57014'}); await held.query('ROLLBACK');
    assert.deepEqual(await f.row(body.messageId), before); assert.equal(s.captured.length, 0);
    assert.equal((await f.pool.query('SELECT count(*) FROM pg_locks WHERE pid=$1 AND NOT granted', [workerPid])).rows[0].count, '0');
  } finally {await held.query('ROLLBACK'); held.release(); w.release(); await run?.catch(() => {});}
});

test('settlement of a committed send succeeds when control state disappears', async t => {
  const f = await setup(t), v = await f.venue(), body = await v.submit(), reached = deferred(), release = deferred();
  const s = await smtp(t, {onData(stream, _session, done) {stream.resume(); stream.on('end', () => {reached.resolve(); void release.promise.then(() => done());});}});
  const w = await processWorker(t, f, s.port), run = w.command('run'); void run.catch(() => {});
  try {await reached.promise; await f.pool.query('DELETE FROM relay_control'); release.resolve(); await run;
    assert.equal((await f.row(body.messageId)).state, 'accepted'); assert.equal((await f.row(body.messageId)).payload, null);
  } finally {release.resolve(); await run.catch(() => {});}
});

test('account verification, password reset and venue alerts still deliver with relay stopped', async t => {
  const f = await setup(t), s = await smtp(t), v = await f.venue();
  const relay = await v.submit(), before = await f.row(relay.messageId);
  const outbox = new EmailOutbox({activeKeyId: 'mail', keys: {mail: randomBytes(32).toString('hex')}});
  await new RelayControl(f.pool).stop();
  const signup = new SignupStore(f.pool, outbox);
  await signup.request('account@example.test', 'es');
  const request = outbox.open((await f.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0]);
  assert.ok('token' in request);
  const mail = new EmailWorker(f.pool, outbox, createLocalAccountMailer({port: s.port}));
  assert.equal(await mail.runOnce(), true);
  const owner = await signup.complete(request.token, {password: 'A sufficiently long password', organisationName: 'Sol', legalBusinessName: 'Sol SL', countryCode: 'ES'});
  await new PasswordRecoveryStore(f.pool, outbox).request('account@example.test', 'es');
  assert.equal(await mail.runOnce(), true);
  await f.pool.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'remote_access','ready')", [v.installation]);
  await f.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '1 hour' WHERE id=$1", [v.installation]);
  await f.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,true,'es')", [v.account]);
  const monitor = new MonitorWorker(f.pool, outbox); await monitor.schedule(); assert.equal(await monitor.runOnce(), true);
  assert.equal(await mail.runOnce(), true);
  assert.equal((await f.pool.query("SELECT count(*) FROM email_outbox WHERE status='sent'")).rows[0].count, '3');
  assert.equal(s.captured.length, 3); assert.ok(s.captured.every(raw => raw.includes('cloud@example.test')));
  assert.equal(await new RelayWorker(f.pool, {...f.config, smtpPort: s.port}).runOnce(), false);
  assert.deepEqual(await f.row(relay.messageId), before); assert.deepEqual(await new RelayControl(f.pool).status(), {stopped: true});
  assert.ok(owner.accountId);
});
