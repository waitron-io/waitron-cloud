import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { isDeepStrictEqual } from 'node:util';

const fail = () => { throw Error('Invalid cloud cost remote measurement'); };
const need = value => { if (!value) fail(); };
const totals = () => ({ connections: 0, bytesToGateway: 0, bytesFromGateway: 0 });

// The relay never terminates TLS or reads application fields. Socket payload counts
// include encrypted records, but IP, TCP and WireGuard overhead needs separate evidence.
export async function openRemoteMeasurement(options) {
  let endpoint, audience, signal, maxConnections, maxBytes, timeoutMs, windowMs;
  try {
    const keys = ['target', 'audience', 'signal', 'maxConnections', 'maxBytes', 'timeoutMs', 'windowMs'];
    need(options && Object.getPrototypeOf(options) === Object.prototype
      && Reflect.ownKeys(options).every(key => keys.includes(key) && !Object.getOwnPropertyDescriptor(options, key).get));
    ({ audience, signal, maxConnections = 1000, maxBytes = 67108864, timeoutMs = 30000, windowMs = 600000 } = options);
    need(typeof options.target === 'string'); endpoint = new URL(options.target);
    need(endpoint.protocol === 'tcp:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && Number(endpoint.port) > 0 && ['', '/'].includes(endpoint.pathname)
      && !endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password);
    need(['staff', 'public'].includes(audience));
    for (const [value, limit] of [[maxConnections, 1000], [maxBytes, 67108864], [timeoutMs, 30000], [windowMs, 600000]])
      need(Number.isSafeInteger(value) && value > 0 && value <= limit);
    need(signal === undefined || (signal instanceof AbortSignal && !signal.aborted));
  } catch { fail(); }
  const sockets = new Set(), settled = [], producer = totals(), observer = totals();
  let invalid = false, closing, closed = false, connections = 0, transferred = 0, timer, failure = 'none';
  const poison = reason => {
    // The first refusal explains the lost measurement; destruction can emit later errors.
    if (failure === 'none') failure = reason;
    invalid = true;
    for (const socket of sockets) socket.destroy();
    void close().catch(() => {});
  };
  const server = createServer({ allowHalfOpen: true }, client => {
    if (invalid || closing || ++connections > maxConnections) { client.destroy(); poison('admission-refused'); return; }
    const upstream = connect({ host: '127.0.0.1', port: Number(endpoint.port), allowHalfOpen: true });
    let remaining = 2, connected = false;
    upstream.once('connect', () => { connected = true; });
    for (const [side, socket] of [['client', client], ['upstream', upstream]]) {
      sockets.add(socket);
      socket.on('error', error => {
        let code;
        try { code = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch {}
        const kind = code === 'ECONNRESET' ? 'reset' : code === 'ECONNREFUSED' ? 'refused'
          : code === 'EPIPE' ? 'pipe' : 'other';
        poison('socket-' + side + '-' + kind);
      });
      socket.setTimeout(timeoutMs, () => poison('timeout-' + side));
      socket.on('data', bytes => { transferred += bytes.length; if (transferred > maxBytes) poison('byte-limit'); });
      socket.once('close', () => {
        sockets.delete(socket);
        if (!invalid && (!socket.readableEnded || !socket.writableFinished)) poison('incomplete-' + side);
        if (--remaining !== 0 || invalid) return;
        if (!connected || client.bytesRead === 0 || upstream.bytesRead === 0) { poison('empty-exchange'); return; }
        producer.connections++; producer.bytesToGateway += client.bytesRead; producer.bytesFromGateway += client.bytesWritten;
        observer.connections++; observer.bytesToGateway += upstream.bytesWritten; observer.bytesFromGateway += upstream.bytesRead;
        if (!isDeepStrictEqual(producer, observer)) poison('counter-mismatch');
      });
      settled.push(new Promise(resolve => socket.once('close', resolve)));
    }
    client.pipe(upstream); upstream.pipe(client);
  });
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      await new Promise(resolve => server.close(resolve));
      // The listener tracks incoming connections only; outgoing close callbacks
      // must finish before their independent counters can be reconciled.
      await Promise.all(settled);
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      try {
        need(!invalid && producer.connections > 0 && producer.connections === connections
          && sockets.size === 0 && isDeepStrictEqual(producer, observer));
        closed = true;
      } catch { invalid = true; if (failure === 'none') failure = 'final-accounting'; fail(); }
    })();
    return closing;
  };
  const abort = () => poison('cancelled');
  server.on('error', () => poison('listener-error'));
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    need(!invalid && !signal?.aborted);
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => poison('window'), windowMs);
  } catch { poison('listener-error'); await close().catch(() => {}); fail(); }
  const port = server.address().port;
  const snapshot = () => {
    need(closed && !invalid);
    return structuredClone({ scope: 'gateway-tcp-stream', audience, status: 'measured', reconciled: true,
      producer, observer, discrepancy: totals(), excludedOverhead: ['ip', 'tcp', 'wireguard'] });
  };
  return { port, close, snapshot, failure: () => failure };
}
