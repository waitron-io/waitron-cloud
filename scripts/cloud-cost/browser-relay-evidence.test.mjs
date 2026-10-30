import {test} from 'node:test';
import assert from 'node:assert/strict';
import net, {createServer, connect} from 'node:net';
import {once} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {measureRemoteBrowser} from './browser.mjs';
import {runBrowserFixture, withBrowserDiagnostics, parseBrowserDiagnostics} from './fixtures/browser-diagnostics.mjs';

// A real relay reset must remain distinguishable from a browser-only refusal.
for (const reset of [false, true]) test('browserRetainsRelayObservationBeforeCleanup_' + reset, {timeout: 3000}, async t => {
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    socket.once('data', () => socket.resetAndDestroy());
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const original = net.connect;
  net.connect = (...args) => typeof args[0] === 'object' && args[0].port === 443
    ? original({...args[0], port: server.address().port}) : original(...args);
  syncBuiltinESMExports();
  t.after(async () => {
    net.connect = original; syncBuiltinESMExports();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  let port, reconnect = false, closed = false;
  const locator = selector => ({locator: child => locator(child), first() {return this;}, or() {return this;},
    async fill() {}, async click() {}, async isVisible() {return false;}, async waitFor() {
      if (reconnect && selector.includes('takings')) throw Object.assign(Error('PRIVATE_TIMEOUT'), {name: 'TimeoutError'});
    }});
  const page = {locator, on() {}, setDefaultTimeout() {}, async evaluate() {return true;}, async goto() {}, async reload() {
    reconnect = true;
    if (reset) {
      const socket = connect(port, '127.0.0.1'); socket.on('error', () => {});
      t.after(() => socket.destroy());
      const done = new Promise(resolve => socket.once('close', resolve));
      socket.write('PRIVATE_TLS_BYTES'); await done;
    }
  }};
  const context = {async addInitScript() {},on() {}, async newPage() {return page;}, async newCDPSession() {return {async send() {}, on() {}};}};
  const chromium = {async launch(options) {
    port = Number(/127\.0\.0\.1:(\d+)/.exec(options.args.find(arg => arg.startsWith('--host-resolver-rules=')))[1]);
    return {async newContext() {return context;}, async close() {closed = true;}};
  }};
  await assert.rejects(measureRemoteBrowser({chromium, staffHostname: 'staff.generated.example.test',
    email: 'generated@example.test', password: 'PRIVATE_PASSWORD'}), error => {
    assert.equal(error.message, 'Invalid cloud cost browser journey');
    assert.equal(error.browserPhase, 'reconnect'); assert.equal(error.browserStep, 'takings');
    assert.equal(error.browserRelay, reset ? 'socket-upstream-reset' : 'none');
    assert.equal(Object.getOwnPropertyDescriptor(error, 'browserRelay').enumerable, false);
    assert.doesNotMatch(error.stack + JSON.stringify(error) + error.browserRelay, /PRIVATE|example|TLS/);
    return true;
  });
  assert.equal(closed, true);
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'); socket.once('error', reject); socket.once('connect', () => {socket.destroy(); resolve();});
  }), {code: 'ECONNREFUSED'});
});

test('browserRelayObservationCrossesRealChildWithoutErrorText', () => {
  const script = `import {withBrowserDiagnostics} from ${JSON.stringify(new URL('./fixtures/browser-diagnostics.mjs', import.meta.url).href)};
    await withBrowserDiagnostics(async () => {throw Object.assign(Error('Invalid cloud cost browser journey'), {
      browserPhase: 'reconnect', browserRelay: 'socket-upstream-reset', privateValue: 'PRIVATE_NETWORK_TEXT'
    });}, line => process.stderr.write(line + '\\n'));`;
  assert.throws(() => runBrowserFixture(process.execPath, ['--input-type=module', '-e', script], {}), error => {
    assert.equal(error.journeyRefused, true); assert.equal(error.browserRelay, 'socket-upstream-reset');
    assert.doesNotMatch(error.stack + JSON.stringify(error), /PRIVATE/); return true;
  });
});

test('browserRelayObservationRejectsPrivateOrHostileValuesAndPreservesRefusal', async () => {
  let reads = 0;
  const lines = [];
  for (const value of ['PRIVATE_NETWORK_TEXT', 'socket-upstream-PRIVATE', 'none\n', {toString() {reads++; return 'none';}}]) {
    const error = Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect', browserRelay: value});
    await assert.rejects(withBrowserDiagnostics(async () => {throw error;}, line => lines.push(line)), e => e === error);
    if (typeof value === 'string' && !value.endsWith('\n'))
      assert.equal(parseBrowserDiagnostics('cost_browser_phase=reconnect\ncost_browser_relay=' + value + '\n').browserRelay, undefined);
  }
  const error = Object.defineProperties(Error('PRIVATE'), {browserPhase: {value: 'reconnect'},
    browserRelay: {get() {reads++; throw Error('PRIVATE_GETTER');}}});
  await assert.rejects(withBrowserDiagnostics(async () => {throw error;}, line => lines.push(line)), e => e === error);
  assert.equal(reads, 0); assert.deepEqual(lines, Array(5).fill('cost_browser_phase=reconnect'));
  const original = Object.assign(Error('PRIVATE'), {browserPhase: 'reconnect', browserRelay: 'none'});
  const printed = [];
  await assert.rejects(withBrowserDiagnostics(async () => {throw original;}, line => {
    printed.push(line); if (line === 'cost_browser_relay=none') throw Error('PRIVATE_OUTPUT');
  }), e => e === original);
  assert.deepEqual(printed, ['cost_browser_phase=reconnect', 'cost_browser_relay=none']);
  assert.equal(parseBrowserDiagnostics('cost_browser_phase=login\ncost_browser_relay=none\n').browserRelay, undefined);
});
