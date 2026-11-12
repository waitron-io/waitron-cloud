import assert from 'node:assert/strict';
import test from 'node:test';
const api = await import('./p1-observer.mjs').catch(error => {if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};});

// Counting an in-flight pre-stop reply as recovery would hide the entire outage.
test('same clients are sampled through confirmed stop and the second backup after fifteen minutes', async () => {
  assert.equal(typeof api.observeP1, 'function');
  let clock = 0, readyAt, stoppedAt, finishedAt;
  const calls = [], probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
    calls.push([name, clock]); return {ok: true};
  }]));
  const result = await api.observeP1({probes, now: () => clock,
    sleep: async ms => {clock += ms; await new Promise(setImmediate);},
    ready: () => {readyAt = clock;}, stopped: async () => {stoppedAt = clock;},
    replacement: async () => {}, signal: new AbortController().signal});
  finishedAt = clock;
  assert.equal(readyAt, 0); assert.equal(stoppedAt, 0);
  assert.ok(finishedAt >= 900000);
  assert.ok(calls.filter(([name]) => name === 'backup').length >= 3);
  assert.ok(calls.some(([name, at]) => name === 'backup' && at >= 900000));
  assert.equal(calls.filter(([name]) => name === 'signup').length, 1);
  assert.deepEqual(calls.filter(([name]) => name === 'login').slice(0, 4), [['login', 0], ['login', 0], ['login', 60000], ['login', 120000]]);
  assert.ok(calls.some(([name, at]) => name === 'session' && at === 5000));
  assert.equal(result.reconciliation, 'unavailable');
  assert.equal(result.backupsAfterStop, 2);
});

// A recovery success cannot excuse a later failure in the same leg.
test('a scheduled outage after recovery fails the leg', async () => {
  assert.equal(typeof api.observeP1, 'function');
  let clock = 0;
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
    if (name === 'remote' && clock >= 5000) throw Error('tunnel lost'); return {ok: true};
  }]));
  await assert.rejects(api.observeP1({probes, now: () => clock,
    sleep: async ms => {clock += ms; await new Promise(setImmediate);},
    ready: () => {}, stopped: async () => {}, replacement: async () => {}}), /p1.remote_after_recovery/);
});

// Hung stop confirmation must end instead of keeping the paid experiment alive.
test('withheld stop confirmation fails within the existing command budget', async () => {
  assert.equal(typeof api.observeP1, 'function');
  let clock = 0;
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => true]));
  await assert.rejects(api.observeP1({probes, now: () => clock,
    sleep: async ms => {clock += ms; await new Promise(setImmediate);},
    ready: () => {}, stopped: () => new Promise(() => {}), replacement: async () => {}}), /p1.stop_timeout/);
  assert.equal(clock, 300000);
});

// A late HTTP success must not turn a missed deadline into a healthy sample.
test('late replies and a missing replacement signal cannot qualify a leg', async () => {
  for (const late of [true, false]) {
    let clock = 0, remoteCalls = 0; const replies = [];
    const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
      if (late && name === 'remote' && ++remoteCalls > 1) await new Promise(resolve => replies.push({at: clock + 6000, resolve})); return true;
    }]));
    await assert.rejects(api.observeP1({probes, now: () => clock,
      sleep: async ms => {clock += ms; for (const reply of replies.filter(reply => reply.at <= clock)) reply.resolve(); await new Promise(setImmediate);},
      ready: () => {}, stopped: async () => {}, replacement: late ? async () => {} : () => new Promise(() => {})}),
    late ? /p1.remote_recovery_timeout/ : /p1.leg_timeout/);
  }
});

// Forgetting setup attempts or per-address allowance permits an invalid injection.
test('request budgets include setup, both signup endpoints and the original source address', () => {
  assert.equal(typeof api.createP1Budget, 'function');
  let clock = 0;
  const budget = api.createP1Budget(() => clock);
  for (let i = 0; i < 8; i++) budget.attempt('login', 'owner@example.test');
  assert.throws(() => budget.attempt('login', 'another@example.test'), /p1.login_budget/);
  clock = 60000;
  budget.attempt('login', 'owner@example.test');
  for (let i = 0; i < 8; i++) budget.attempt('signup', 'new@example.test');
  assert.throws(() => budget.requireRoom(), /p1.signup_budget/);
  for (const name of ['next', 'last']) {
    clock += 60000;
    for (let i = 0; i < 7; i++) budget.attempt('login', 'owner@example.test');
  }
  clock += 60000;
  budget.attempt('login', 'owner@example.test');
  assert.throws(() => budget.attempt('login', 'owner@example.test'), /p1.email_budget/);
});

// Stopping too near scheduled deletion cannot qualify the full observation window.
test('insufficient expiry refuses readiness and fragmented stop signals preserve ordering', async () => {
  assert.equal(typeof api.readP1Signals, 'function');
  const {PassThrough} = await import('node:stream');
  const input = new PassThrough(), reader = api.readP1Signals(input);
  let stopped = false, replacement = false;
  reader.stopped.then(() => {stopped = true;}); reader.replacement.then(() => {replacement = true;});
  input.write('P1_ST'); await new Promise(setImmediate); assert.equal(stopped, false);
  input.write('OPPED\n'); await reader.stopped; assert.equal(replacement, false);
  input.end('P1_REPLACEMENT_READY\n'); await reader.replacement; reader.close();
  let ready = false, clock = 0;
  await assert.rejects(api.observeP1({probes: Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => true])),
    ready: () => {ready = true;}, stopped: async () => {}, replacement: async () => {},
    expiresAt: 2399999, wallNow: () => 0, now: () => clock, sleep: async ms => {clock += ms; await new Promise(setImmediate);}}), /p1.expiry/);
  assert.equal(ready, false);
});

test('pre-stop successes are recorded while only post-stop operations establish recovery', async () => {
  let clock = 0, confirm;
  const stopped = new Promise(resolve => {confirm = resolve;});
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => true]));
  const result = await api.observeP1({probes, now: () => clock, ready: () => {}, stopped: () => stopped, replacement: async () => {},
    sleep: async ms => {clock += ms; if (clock >= 10000) confirm(); await new Promise(setImmediate);}});
  assert.ok(result.samples.some(sample => sample.name === 'remote' && sample.startedMs === 0));
  assert.equal(result.backupsAfterStop, 2);
  assert.ok(result.samples.some(sample => sample.name === 'backup' && sample.startedMs >= 910000));
});

test('a first successful operation completing past the recovery bound fails', async () => {
  let clock = 0, calls = 0;
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
    if (name === 'remote' && ++calls > 1 && clock < 90000) throw Error('not recovered'); return true;
  }]));
  await assert.rejects(api.observeP1({probes, now: () => clock, ready: () => {}, stopped: async () => {}, replacement: async () => {},
    sleep: async ms => {clock += ms; await new Promise(setImmediate);}}), /p1.remote_recovery_timeout/);
});

test('the final backup cannot hide an unfinished scheduled remote probe', async () => {
  let clock = 0; const failures = [];
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
    if (name === 'remote' && clock >= 900000) await new Promise((resolve, reject) => failures.push({at: clock + 4000, reject})); return true;
  }]));
  await assert.rejects(api.observeP1({probes, now: () => clock, ready: () => {}, stopped: async () => {}, replacement: async () => {},
    sleep: async ms => {clock += ms; for (const failure of failures.filter(failure => failure.at <= clock)) failure.reject(Error('final tunnel lost')); await new Promise(setImmediate);}}), /p1.remote_after_recovery/);
});
