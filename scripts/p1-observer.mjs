import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

// Use the observer's clock so transport and stop delays count against recovery.
export async function observeP1({probes, ready, stopped, replacement, reconcile, signal, holdMs,
  now = () => performance.now(), sleep = ms => delay(ms, undefined, {signal})}) {
  const names = ['session', 'remote', 'login', 'backup', 'signup'];
  const finalBackupAfter = holdMs === undefined ? 900_000 : holdMs - 60_000;
  const samples = [], states = Object.fromEntries(names.map(name => [name, {next: 0, count: 0}]));
  for (const name of names.filter(name => name !== 'signup')) {
    await probes[name](signal, false);
    states[name].lastSuccess = now(); states[name].baselineAt = now();
  }
  signal?.throwIfAborted();
  const faultAt = now();
  ready();
  let stoppedAt, replacementReady = false, signalFailure, repair;
  Promise.resolve().then(stopped).then(confirmedAt => {
    stoppedAt = confirmedAt ?? now();
    process.stderr.write('P1 timing observer stopped-received ' + (stoppedAt - faultAt) + '\n');
    for (const state of Object.values(states)) if (!state.recovered) state.next = 0;
  }, error => {signalFailure = error;});
  Promise.resolve().then(replacement).then(() => {replacementReady = true;}, error => {signalFailure = error;});
  const launch = name => {
    const state = states[name], at = now(), controller = new AbortController();
    state.pending = {at, controller, ended: false, afterStop: stoppedAt !== undefined};
    const pending = state.pending;
    // The measured hold ends with a retained read. Its first successful backup already ran the verifier.
    const fresh = pending.afterStop && !(holdMs !== undefined && name === 'backup' && state.recovered);
    (async () => probes[name](signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, fresh))()
      .then(result => {pending.result = result; pending.ok = true; pending.endedAt = now(); pending.ended = true;}, error => {pending.error = error; pending.endedAt = now(); pending.ended = true;});
  };
  try {
    await sleep(0);
    for (;;) {
      signal?.throwIfAborted();
      if (signalFailure) throw signalFailure;
      const at = now();
      if (reconcile && stoppedAt !== undefined && replacementReady && !repair) {
        repair = {};
        Promise.resolve().then(() => reconcile(signal)).then(result => {repair.result = result; repair.done = true;}, error => {
          process.stderr.write('P1 reconciliation failed ' + JSON.stringify({samples: samples.slice(-10)}) + '\n');
          signalFailure = error;
        });
      }
      assert.ok(at - faultAt < 2100000, 'p1.leg_timeout');
      if (stoppedAt === undefined) assert.ok(at - faultAt < 300000, 'p1.stop_timeout');
      else assert.ok(stoppedAt - faultAt <= 90000, 'p1.stop_slower_than_bound');
      for (const name of names) {
        const state = states[name], pending = state.pending;
        const deadline = name === 'backup' ? 300000 : name === 'signup' ? 90000 : 5000;
        if (pending && !pending.ended && at - pending.at >= deadline) {
          pending.expired = true; pending.controller.abort();
          if (state.recovered) throw Error('p1.' + name + '_after_recovery');
        }
        if (pending?.ended) {
          const ok = pending.ok && !pending.expired && pending.endedAt - pending.at <= deadline;
          const durationMs = (pending.endedAt ?? at) - pending.at;
          samples.push({name, startedMs: pending.at - faultAt, durationMs, ok: Boolean(ok)});
          state.pending = undefined;
          if (!ok && state.recovered) throw Error('p1.' + name + '_after_recovery');
          if (ok) {
            state.longestGapMs = Math.max(state.longestGapMs ?? 0, pending.endedAt - state.lastSuccess || 0);
            state.lastSuccess = pending.endedAt;
            // Backup probes only start fresh verification once the stop is confirmed.
            if (pending.afterStop && pending.at >= stoppedAt) {
              if (!state.recovered) {
                assert.ok(pending.endedAt - faultAt <= (name === 'backup' ? 300000 : 90000), 'p1.' + name + '_recovery_timeout');
                state.withinMs = pending.endedAt - faultAt;
                state.result = pending.result;
                state.longestGapMs = Math.max(state.longestGapMs, pending.endedAt - (state.baselineAt ?? faultAt));
              }
              state.recovered = true; state.count++;
              if (name === 'backup' && pending.at >= stoppedAt + finalBackupAfter) state.finalBackup = true;
            }
          }
          state.next = pending.at + (name === 'session' || name === 'remote' ? 5000 : name === 'login' && state.recovered ? 60000 : 15000);
        }
        if (!state.recovered && stoppedAt !== undefined) {
          assert.ok(at - faultAt <= (name === 'backup' ? 300000 : 90000), 'p1.' + name + '_recovery_timeout');
        }
        if ((stoppedAt === undefined && name === 'signup') || state.pending || at < state.next) continue;
        if (name === 'signup' && state.recovered) continue;
        if (name === 'backup' && state.recovered && (state.finalBackup || at < stoppedAt + finalBackupAfter)) continue;
        launch(name);
      }
      if (replacementReady && (!reconcile || repair?.done) && states.backup.finalBackup && at >= stoppedAt + (holdMs ?? 0) &&
          names.every(name => states[name].recovered && !states[name].pending)) {
        return {samples, backupsAfterStop: states.backup.count, reconciliation: reconcile ? repair.result : 'unavailable',
          stoppedMs: stoppedAt - faultAt, offMs: at - stoppedAt,
          recovery: Object.fromEntries(names.map(name => {
            const {withinMs, longestGapMs, result} = states[name];
            return [name, {withinMs, longestGapMs, ...(holdMs !== undefined && {result})}];
          }))};
      }
      await sleep(1000);
    }
  } finally {
    for (const state of Object.values(states)) state.pending?.controller.abort();
  }
}

// Both signup endpoints and every login share the real proxy's source identity.
export function createP1Budget(now = () => performance.now()) {
  const logins = [], signups = [];
  const recent = (rows, ms, email) => rows.filter(row => now() - row.at < ms && (!email || row.email === email)).length;
  return {
    attempt(kind, email) {
      if (kind === 'login') {
        assert.ok(recent(logins, 60000) < 8, 'p1.login_budget');
        assert.ok(recent(logins, 900000, email) < 24, 'p1.email_budget');
        logins.push({at: now(), email});
      } else {
        assert.ok(recent(signups, 900000) < 8, 'p1.signup_budget');
        signups.push({at: now(), email});
      }
    },
    requireRoom(email) {
      assert.ok(recent(logins, 60000) <= 4, 'p1.login_budget');
      assert.ok(recent(logins, 900000, email) <= 18, 'p1.email_budget');
      assert.ok(recent(signups, 900000) <= 6, 'p1.signup_budget');
    },
  };
}


export function readP1Signals(input) {
  const stop = Promise.withResolvers(), replacement = Promise.withResolvers();
  // A signal can fail before the observer starts awaiting it during baseline.
  stop.promise.catch(() => {}); replacement.promise.catch(() => {});
  let buffer = '', stopped = false, replaced = false;
  const fail = () => {const error = Error('p1.signal_closed'); stop.reject(error); replacement.reject(error);};
  const data = part => {
    buffer += part;
    if (buffer.length > 128) return fail();
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line === 'P1_STOPPED' && !stopped) {stopped = true; stop.resolve();}
      else if (line === 'P1_REPLACEMENT_READY' && stopped && !replaced) {replaced = true; replacement.resolve();}
      else fail();
    }
  };
  const end = () => {if (!replaced) fail();};
  input.on('data', data); input.once('end', end); input.once('error', fail);
  return {stopped: stop.promise, replacement: replacement.promise,
    close() {input.off('data', data); input.off('end', end); input.off('error', fail); input.pause();}};
}
