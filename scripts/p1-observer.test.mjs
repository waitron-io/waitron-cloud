import assert from 'node:assert/strict';
import test from 'node:test';
import * as remote from '../deploy/test-cloud/test-fixtures/integration-paid-remote.mjs';
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

test('the measured Kind leg reports fresh work and checks the retained backup near the end of its six-minute hold', async () => {
  let clock = 0;
  const probes = {
    session: async () => true, remote: async () => true, login: async () => true,
    backup: async () => ({verifiedAt: clock, verifier: 'verifier-process'}),
    signup: async () => ({deliveredAt: clock, worker: 'email-process'}),
  };
  const result = await api.observeP1({probes, holdMs: 360_000, now: () => clock,
    sleep: async ms => {clock += ms; await new Promise(setImmediate);},
    ready: () => {}, stopped: async () => {}, replacement: async () => {}});
  assert.ok(result.offMs >= 360_000 && result.offMs <= 362_000);
  assert.equal(result.backupsAfterStop, 2);
  assert.ok(result.samples.some(sample => sample.name === 'backup' && sample.startedMs === 300_000 && sample.ok));
  assert.deepEqual(result.recovery.backup.result, {verifiedAt: 0, verifier: 'verifier-process'});
  assert.deepEqual(result.recovery.signup.result, {deliveredAt: 0, worker: 'email-process'});
});

test('a retained backup read before stop confirmation cannot count as fresh verification', async () => {
  let clock = 0;
  const confirmed = Promise.withResolvers();
  const probes = {session: async () => true, remote: async () => true, login: async () => true,
    signup: async () => true, backup: async (_signal, fresh) => ({fresh})};
  const result = await api.observeP1({probes, holdMs: 360_000, now: () => clock,
    ready: () => {}, stopped: () => confirmed.promise, replacement: () => confirmed.promise,
    sleep: async ms => {clock += ms || 1000; if (clock >= 2000) confirmed.resolve(500); await new Promise(setImmediate);}});
  assert.equal(result.stoppedMs, 500);
  assert.deepEqual(result.recovery.backup.result, {fresh: true});
});

test('the final measured backup probe reads retained data without starting another verifier', async () => {
  let clock = 0;
  const complete = [];
  const probes = {session: async () => true, remote: async () => true, login: async () => true,
    signup: async () => true, backup: async (_signal, fresh) => {
      if (fresh) await new Promise(resolve => complete.push({at: clock + 100_000, resolve}));
      return {fresh};
    }};
  const result = await api.observeP1({probes, holdMs: 360_000, now: () => clock, ready: () => {},
    stopped: async () => {}, replacement: async () => {},
    sleep: async ms => {
      clock += ms;
      assert.ok(clock <= 390_000, 'six-minute hold exhausted its 30-second margin');
      for (const work of complete) if (work.at <= clock) work.resolve();
      await new Promise(setImmediate);
    }});
  assert.equal(complete.length, 1);
  assert.equal(result.recovery.backup.result.fresh, true);
  assert.equal(result.backupsAfterStop, 2);
});

// A recovery success cannot excuse a later failure in the same leg.
test('a scheduled outage after recovery fails the leg', async () => {
  assert.equal(typeof api.observeP1, 'function');
  let clock = 0;
  const failure = Object.assign(Error('tunnel lost'), {code: 'ECONNRESET'});
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
    if (name === 'remote' && clock >= 5000) {
      return remote.checkRemoteRoute('public', async () => {throw failure;});
    }
    return {ok: true};
  }]));
  await assert.rejects(api.observeP1({probes, now: () => clock,
    sleep: async ms => {clock += ms; await new Promise(setImmediate);},
    ready: () => {}, stopped: async () => {}, replacement: async () => {}}), error => {
    assert.match(error.message, /p1\.remote_after_recovery/);
    assert.match(error.cause?.message ?? '', /integration\.remote_route:public/);
    assert.equal(error.cause.cause, failure);
    return true;
  });
});

test('a failed remote request identifies its route and keeps the transport error', async t => {
  assert.equal(typeof remote.checkRemoteRoute, 'function');
  const failure = Object.assign(Error('socket reset'), {code: 'ECONNRESET'});
  const output = t.mock.method(process.stderr, 'write', () => true);
  await assert.rejects(remote.checkRemoteRoute('public', async () => {throw failure;}), error => {
    assert.match(error.message, /integration\.remote_route:public/);
    assert.equal(error.cause, failure);
    return true;
  });
  await assert.rejects(remote.checkRemoteRoute('staff', async () => {throw Error('integration.remote_probe_timeout');}));
  assert.deepEqual(output.mock.calls.map(call => call.arguments[0]), [
    'D621 HTTPS attempt {"route":"public","error":"ECONNRESET"}\n',
    'D621 HTTPS attempt {"route":"staff","error":"integration.remote_probe_timeout"}\n',
  ]);
});

for (const lateReply of [false, true]) {
  test('a remote probe ' + (lateReply ? 'with a late reply' : 'still in flight') + ' reports its deadline after recovery', async () => {
    let clock = 0, completeRemote;
    const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name =>
      [name, async () => name === 'remote' && clock >= 5000 ?
        new Promise(resolve => {completeRemote = resolve;}) : true]));
    await assert.rejects(api.observeP1({probes, now: () => clock,
      ready: () => {}, stopped: async () => {}, replacement: async () => {},
      sleep: async ms => {
        clock += ms;
        if (lateReply && clock === 10000) {clock += 1000; completeRemote(true);}
        await new Promise(setImmediate);
      },
    }), new RegExp('p1\\.remote_after_recovery: probe took ' + (lateReply ? '6000' : '5000') + ' ms \\(limit 5000 ms\\)'));
    assert.equal(clock, lateReply ? 11000 : 10000);
  });
}

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
  for (let i = 0; i < 8; i++) budget.attempt('signup-complete');
  assert.throws(() => budget.requireRoom(), /p1.signup_budget/);
  assert.throws(() => budget.attempt('signup-complete'), /p1.signup_budget/);
  budget.attempt('signup-request', 'new@example.test');
  for (const name of ['next', 'last']) {
    clock += 60000;
    for (let i = 0; i < 7; i++) budget.attempt('login', 'owner@example.test');
  }
  clock += 60000;
  budget.attempt('login', 'owner@example.test');
  assert.throws(() => budget.attempt('login', 'owner@example.test'), /p1.email_budget/);
});

test('signup spacing reserves one confirmation request for the next service stop', () => {
  let clock = 0;
  const budget = api.createP1Budget(() => clock);
  for (let i = 0; i < 4; i++) {
    budget.attempt('signup-request', 'setup@example.test');
    clock += 1000;
  }
  budget.attempt('signup-complete');
  budget.attempt('login', 'observer@example.test');
  assert.equal(budget.signupDelayMs(), 0);
  budget.requireRoom();
  budget.attempt('signup-request', 'first-stop@example.test');
  assert.equal(budget.signupDelayMs(), 3_596_000);
  assert.throws(() => budget.requireRoom(), /p1.signup_budget/);
  assert.throws(() => budget.attempt('signup-request', 'second-stop@example.test'), /p1.signup_budget/);

  clock = 3_599_999;
  assert.equal(budget.signupDelayMs(), 1);
  clock = 3_600_000;
  assert.equal(budget.signupDelayMs(), 0);
  budget.attempt('signup-request', 'second-stop@example.test');
});

test('fragmented stop signals preserve ordering', async () => {
  assert.equal(typeof api.readP1Signals, 'function');
  const {PassThrough} = await import('node:stream');
  const input = new PassThrough(), reader = api.readP1Signals(input);
  let stopped = false, replacement = false;
  reader.stopped.then(() => {stopped = true;}); reader.replacement.then(() => {replacement = true;});
  input.write('P1_ST'); await new Promise(setImmediate); assert.equal(stopped, false);
  input.write('OPPED\n'); await reader.stopped; assert.equal(replacement, false);
  input.end('P1_REPLACEMENT_READY\n'); await reader.replacement; reader.close();

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

test('a reply started before EC2 confirmed stop cannot count as recovery', async () => {
  let clock = 0, confirm; const replies = [];
  const stopped = new Promise(resolve => {confirm = resolve;});
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
    if (name === 'remote' && clock === 5000) await new Promise(resolve => replies.push({at: 9000, resolve})); return true;
  }]));
  const result = await api.observeP1({probes, now: () => clock, ready: () => {}, stopped: () => stopped, replacement: async () => {},
    sleep: async ms => {
      clock += ms; if (clock >= 8000) confirm();
      for (const reply of replies.filter(reply => reply.at <= clock)) reply.resolve();
      await new Promise(setImmediate);
    }});
  assert.equal(result.stoppedMs, 8000);
  assert.equal(result.recovery.remote.withinMs, 11000);
  assert.ok(result.recovery.remote.longestGapMs >= 11000);
});

test('confirmed stop immediately schedules unrecovered probes within the original bound', async () => {
  let clock = 0, confirm; const stopped = new Promise(resolve => {confirm = resolve;});
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => true]));
  const result = await api.observeP1({probes, now: () => clock, ready: () => {}, stopped: () => stopped, replacement: async () => {},
    sleep: async ms => {clock += ms; if (clock >= 80000) confirm(); await new Promise(setImmediate);}});
  assert.equal(result.recovery.login.withinMs, 81000);
});

test('a timed-out final backup fails at its deadline even when it ignores cancellation', async () => {
  let clock = 0;
  const probes = Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => {
    if (name === 'backup' && clock >= 900000) await new Promise(() => {}); return true;
  }]));
  await assert.rejects(api.observeP1({probes, now: () => clock, ready: () => {}, stopped: async () => {}, replacement: async () => {},
    sleep: async ms => {clock += ms; await new Promise(setImmediate);}}), /p1.backup_after_recovery/);
  assert.equal(clock, 1200000);
});

test('stop confirmation past the sign-in bound reports the stop rather than an application outage', async t => {
  const diagnostics = [];
  t.mock.method(process.stderr, 'write', value => {diagnostics.push(String(value)); return true;});
  let clock = 1000;
  await assert.rejects(api.observeP1({probes: Object.fromEntries(['session', 'remote', 'login', 'backup', 'signup'].map(name => [name, async () => true])),
    now: () => clock, ready: () => {}, stopped: async () => {clock = 93000;}, replacement: async () => {},
    sleep: async ms => {clock += ms; await new Promise(setImmediate);}}), /p1.stop_slower_than_bound/);
  assert.deepEqual(diagnostics.filter(row => row.startsWith('P1 timing ')), ['P1 timing observer stopped-received 92000\n']);
});

// Repair cannot replace client sampling or report success before its real observation ends.
test('repository repair starts after replacement and is retained beside the same client probes', async () => {
  let clock=0,repairAt,finishRepair;const calls=[];
  const stop=Promise.withResolvers(),replacement=Promise.withResolvers();
  const report={revisionMs:2000,driftMs:3000,refetchMs:4000};
  const probes=Object.fromEntries(['session','remote','login','backup','signup'].map(name=>[name,async()=>{calls.push([name,clock]);}]));
  const result=await api.observeP1({probes,now:()=>clock,ready:()=>{},stopped:()=>stop.promise,replacement:()=>replacement.promise,
    reconcile:async()=>{repairAt=clock;await new Promise(resolve=>{finishRepair=resolve;});return report;},
    sleep:async ms=>{clock+=ms;if(clock>=1000)stop.resolve();if(clock>=10000)replacement.resolve();
      if(clock<10000)assert.equal(repairAt,undefined);if(clock>=910000)finishRepair?.();await new Promise(setImmediate);}});
  assert.ok(repairAt>=10000&&repairAt<20000);assert.ok(clock>=910000);
  assert.ok(calls.some(([name,at])=>name==='session'&&at>repairAt&&at<20000));
  assert.deepEqual(result.reconciliation,report);
  assert.ok(result.offMs>=900000);assert.equal(result.backupsAfterStop,2);
});

test('an unexpected repository repair refusal fails the observation rather than returning client success', async () => {
  let clock=0;
  const probes=Object.fromEntries(['session','remote','login','backup','signup'].map(name=>[name,async()=>{}]));
  await assert.rejects(api.observeP1({probes,now:()=>clock,ready:()=>{},stopped:async()=>{},replacement:async()=>{},
    reconcile:async()=>{throw Error('flux.revision_timeout');},sleep:async ms=>{clock+=ms;await new Promise(setImmediate);}}),/flux.revision_timeout/);
});
