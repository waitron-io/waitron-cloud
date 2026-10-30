import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {measureRemoteBrowser} from './browser.mjs';

// Browser event delivery is controlled here so headers, open callbacks and size
// completion can be separated without changing the real journey's drain.
async function probe(t, setup) {
  const events = new Map(), jobs = [];
  let stream, clock = Date.now(), reloaded = false;
  const atReload = {};
  const state = {emit: (name, value) => events.get(name)(value), jobs,
    request: (path, type = 'fetch') => ({url: () => 'https://staff.generated.example.test' + path,
      resourceType: () => type, sizes: async () => ({requestBodySize: 0, responseBodySize: 7})}),
    advanceDeadline() {t.mock.method(Date, 'now', () => clock += 4000);},
    headers(req) {state.emit('response', {request: () => req, url: req.url, status: () => 200});},
    stream() {return stream;}};
  class Stream extends EventTarget {
    readyState = 0;
    close() {this.readyState = 2;}
  }
  const sandbox = {EventSource: Stream};
  const locator = selector => ({locator: child => locator(child), first() {return this;}, or() {return this;},
    async fill() {}, async click() {}, async isVisible() {return false;},
    async waitFor() {
      if (selector.includes('overdue-empty')) {
        stream = new sandbox.EventSource('/management-api/events');
        await setup(state);
      }
    }});
  const page = {locator, on() {}, setDefaultTimeout() {}, async goto() {},
    async evaluate(fn) {await state.evaluating?.(); return runInNewContext('(' + fn.toString() + ')()', sandbox);},
    async reload() {Object.assign(atReload, state.observe?.()); reloaded = true; throw Error('controlled stop at reload');}};
  const context = {on: (name, fn) => events.set(name, fn), async newPage() {return page;},
    async addInitScript(fn) {runInNewContext('(' + fn.toString() + ')()', sandbox);},
    async newCDPSession() {return {async send() {}, on() {}};}};
  let refusal;
  try {
    await measureRemoteBrowser({chromium: {async launch() {return {async newContext() {return context;}, async close() {}};}},
      staffHostname: 'staff.generated.example.test', email: 'generated@example.test', password: 'generated'});
  } catch (error) {refusal = error;}
  finally {await Promise.all(jobs);}
  return {reloaded, refusal, atReload};
}

// Ignoring connecting streams permits navigation before their open handlers read.
test('browser waits for stream open callbacks and their resulting reads before reload', async t => {
  let readFinished = false, opened = false;
  const result = await probe(t, state => {
    state.observe = () => ({opened, readFinished});
    const live = state.request('/management-api/events', 'eventsource'); state.emit('request', live);
    state.headers(live);
    state.stream().readyState = 1; // Headers can precede the open event task.
    state.stream().addEventListener('open', () => {
      opened = true;
      const read = state.request('/management-api/alerts'); state.emit('request', read);
      state.jobs.push(new Promise(resolve => setTimeout(() => {
        readFinished = true; state.emit('requestfinished', read); resolve();
      }, 25)));
    });
    state.jobs.push(new Promise(resolve => setTimeout(() => {state.stream().dispatchEvent(new Event('open')); resolve();}, 25)));
  });
  assert.equal(result.refusal.browserPhase, 'reconnect');
  assert.equal(result.reloaded, true);
  // The callback timing is checked at navigation, before the probe joins its jobs.
  assert.equal(result.refusal.message, 'Invalid cloud cost browser journey');
  assert.deepEqual(result.atReload, {opened: true, readFinished: true});
});

// A second read can start in sizes(), after the first request leaves seen.
test('browser rechecks reads started while completed response sizes settle', async t => {
  const result = await probe(t, state => {
    state.stream().dispatchEvent(new Event('open'));
    const first = state.request('/management-api/reports/overview');
    first.sizes = () => new Promise(resolve => setImmediate(() => {
      state.emit('request', state.request('/management-api/alerts'));
      state.advanceDeadline(); resolve({requestBodySize: 0, responseBodySize: 7});
    }));
    state.emit('request', first); state.emit('requestfinished', first);
  });
  assert.equal(result.reloaded, false, 'an unfinished new read prevents navigation');
  assert.equal(result.refusal.browserPhase, 'dashboard');
});

for (const mode of ['connecting', 'sizes'])
test('browser retains the three second deadline for ' + mode, async t => {
  const result = await probe(t, state => {
    if (mode === 'sizes') {
      state.stream().dispatchEvent(new Event('open'));
      const read = state.request('/management-api/reports/overview');
      read.sizes = () => new Promise(resolve => {
        state.jobs.push(new Promise(done => setTimeout(() => {resolve({requestBodySize: 0, responseBodySize: 7}); done();}, 50)));
      });
      state.emit('request', read); state.emit('requestfinished', read);
    }
    state.jobs.push(new Promise(resolve => setTimeout(() => {state.advanceDeadline(); resolve();}, 15)));
  });
  assert.equal(result.reloaded, false);
  assert.equal(result.refusal.browserPhase, 'dashboard');
});

test('browser keeps established streams open while preparing reload', async t => {
  let stream;
  const result = await probe(t, state => {stream = state.stream(); stream.readyState = 1; stream.dispatchEvent(new Event('open'));});
  assert.equal(result.reloaded, true);
  assert.equal(stream.readyState, 1, 'measurement never closes the established application stream');
});

// Stream callbacks alone cannot stand in for the request's observed response.
test('browser refuses a live request that never receives response headers', async t => {
  const result = await probe(t, state => {
    state.stream().readyState = 1; state.stream().dispatchEvent(new Event('open'));
    state.emit('request', state.request('/management-api/events', 'eventsource'));
    state.jobs.push(new Promise(resolve => setImmediate(() => {state.advanceDeadline(); resolve();})));
  });
  assert.equal(result.reloaded, false);
  assert.equal(result.refusal.browserPhase, 'dashboard');
});

for (const end of ['close', 'closed-error'])
test('browser permits a deliberately closed connecting stream_' + end, async t => {
  const result = await probe(t, state => {
    if (end === 'close') state.stream().close();
    else {state.stream().readyState = 2; state.stream().dispatchEvent(new Event('error'));}
  });
  assert.equal(result.reloaded, true);
  assert.equal(result.refusal.browserPhase, 'reconnect');
});

test('browser waits again when an established stream starts reconnecting', async t => {
  const result = await probe(t, state => {
    state.stream().readyState = 1; state.stream().dispatchEvent(new Event('open'));
    state.stream().readyState = 0; state.stream().dispatchEvent(new Event('error'));
    state.jobs.push(new Promise(resolve => setImmediate(() => {state.advanceDeadline(); resolve();})));
  });
  assert.equal(result.reloaded, false);
  assert.equal(result.refusal.browserPhase, 'dashboard');
});

// A slow page reply must not turn an expired deadline into a successful drain.
test('browser refuses readiness delivered after the drain deadline', async t => {
  const result = await probe(t, state => {
    state.stream().dispatchEvent(new Event('open'));
    state.evaluating = () => {state.advanceDeadline(); Date.now();};
  });
  assert.equal(result.reloaded, false);
  assert.equal(result.refusal.browserPhase, 'dashboard');
});

// Removing the timer race, or changing its 3000 ms limit, must fail this boundary.
test('browser refuses a blocked page evaluation at exactly three seconds', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout']});
  const started = Promise.withResolvers(), blocked = Promise.withResolvers();
  let done = false;
  const journey = probe(t, state => {
    state.stream().dispatchEvent(new Event('open'));
    state.evaluating = () => {started.resolve(); return blocked.promise;};
  }).then(result => {done = true; return result;});
  const turn = () => new Promise(resolve => setImmediate(resolve));
  try {
    await started.promise;
    t.mock.timers.tick(2999); await turn();
    assert.equal(done, false, 'the page retains the full three-second allowance');
    t.mock.timers.tick(1); await turn();
    assert.equal(done, true, 'the stalled page refuses at 3000 ms without a reply');
    const result = await journey;
    assert.equal(result.reloaded, false);
    assert.equal(result.refusal.browserPhase, 'dashboard');
    assert.equal(result.refusal.message, 'Invalid cloud cost browser journey');
  } finally {blocked.resolve(); await journey;}
});
