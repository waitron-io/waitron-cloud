import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import * as diagnostic from './instrument.mjs';

// Removing the signal listener loses the distinction between application abort and navigation.
test('application trace follows a real fetch cancellation without exporting its URL or reason', async t => {
  assert.equal(typeof diagnostic.installApplicationTrace, 'function', 'application cancellation observation exists');
  const server = createServer((req, res) => { res.writeHead(200); res.write('generated'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const rows = [], events = new EventTarget();
  const sandbox = {fetch, Request, URL, EventSource: class extends EventTarget {},
    location: {href: 'http://127.0.0.1:' + server.address().port + '/'}, performance,
    console: {debug: value => rows.push(JSON.parse(value.slice('cost_application='.length)))},
    addEventListener: events.addEventListener.bind(events)};
  runInNewContext('(' + diagnostic.installApplicationTrace.toString() + ')()', sandbox);
  const controller = new AbortController();
  const response = await sandbox.fetch(sandbox.location.href + 'management-api/alerts?PRIVATE_QUERY', {signal: controller.signal});
  controller.abort('PRIVATE_REASON');
  await assert.rejects(response.text());
  events.dispatchEvent(new Event('beforeunload'));
  assert.deepEqual(rows.map(row => row.event), ['fetch-start', 'fetch-response', 'fetch-abort', 'beforeunload']);
  assert.equal(rows[0].route, 'alerts');
  assert.equal(rows[2].id, rows[0].id);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|127\.0\.0\.1|http:|generated/);
});

// Closing a CONNECTING stream is different from cancelling an established stream on reload.
test('application trace retains live stream state and preserves the real close call', () => {
  assert.equal(typeof diagnostic.installApplicationTrace, 'function', 'application cancellation observation exists');
  const rows = [], events = new EventTarget(); let closes = 0;
  class Stream extends EventTarget {
    readyState = 0;
    close() { closes++; this.readyState = 2; }
  }
  const sandbox = {fetch, Request, URL, EventSource: Stream, location: {href:'https://staff.generated.example.test/manage/'},
    performance, console: {debug:value => rows.push(JSON.parse(value.slice('cost_application='.length)))},
    addEventListener: events.addEventListener.bind(events)};
  runInNewContext('(' + diagnostic.installApplicationTrace.toString() + ')()', sandbox);
  const stream = new sandbox.EventSource('/management-api/events?PRIVATE_INTERESTS', {withCredentials:true});
  stream.close();
  assert.equal(closes, 1); assert.equal(stream.readyState, 2);
  assert.deepEqual(rows.map(row => [row.event, row.state]), [['stream-create', 0], ['stream-close', 0]]);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|https:|events\?/);
});
