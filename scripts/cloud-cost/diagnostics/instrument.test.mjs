import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer, connect} from 'node:net';
import {once} from 'node:events';
import {instrumentRemote} from './instrument.mjs';

// Missing event hooks lose the direction and byte counts that distinguish reset propagation.
test('instrumented relay preserves reset refusal and records only closed socket evidence', {timeout: 5000}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'cost-relay-trace-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const tracePath = join(root, 'trace.jsonl');
  const source = readFileSync(new URL('../remote.mjs', import.meta.url), 'utf8');
  writeFileSync(join(root, 'remote.mjs'), instrumentRemote(source).replaceAll('/tmp/cost-browser-trace.jsonl', tracePath));
  const {openRemoteMeasurement} = await import(pathToFileURL(join(root, 'remote.mjs')));
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.once('data', () => socket.resetAndDestroy());
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const meter = await openRemoteMeasurement({target: 'tcp://127.0.0.1:' + server.address().port, audience: 'staff'});
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await meter.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  });
  const socket = connect(meter.port, '127.0.0.1'); socket.on('error', () => {});
  t.after(() => socket.destroy());
  const closed = once(socket, 'close'); socket.end('PRIVATE_TRACE_PAYLOAD'); await closed;
  await assert.rejects(meter.close(), {message: 'Invalid cloud cost remote measurement'});
  assert.throws(() => meter.snapshot(), {message: 'Invalid cloud cost remote measurement'});
  assert.equal(meter.failure(), 'socket-upstream-reset');
  let output = '';
  try { output = readFileSync(tracePath, 'utf8'); } catch {}
  assert.ok(output.length > 0, 'the instrumented real relay must retain socket evidence');
  const events = output.trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e => e.event === 'error' && e.side === 'upstream' && e.code === 'reset'));
  assert.ok(events.some(e => e.event === 'poison' && e.reason === 'socket-upstream-reset'));
  assert.ok(events.some(e => e.event === 'data' && e.side === 'client' && e.length === 21));
  assert.ok(events.some(e => e.event === 'close' && Number.isSafeInteger(e.read) && Number.isSafeInteger(e.written)));
  assert.doesNotMatch(output, /PRIVATE|127\.0\.0\.1|tcp:|Error:/);
});
