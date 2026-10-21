import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createMeter, createMeteringProxy } from './meter.mjs';

const fail = () => { throw Error('Invalid cloud cost fiscal measurement'); };
const requireThat = value => { if (!value) fail(); };
const paths = Object.freeze(Object.fromEntries(['reserve', 'consume', 'status', 'list'].map(action =>
  [action, '/api/account/fiscal-allocations/' + action]).concat([['report', '/api/installations/fiscal-allocations/report']])));

// Only named loopback fixtures are admitted. Credentials and response bodies remain with the private caller.
export async function openFiscalMeasurement({ target, clock, credentials = { cookie: '', csrfToken: '' },
  maxAttempts = 2, timeoutMs = 3000, signal }) {
  let meter, proxy;
  const expected = new Map();
  let invalid = false, closing, closed = false, active, current;
  const poison = () => { invalid = true; meter?.invalidate(); };
  try {
    const endpoint = new URL(target);
    requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === '' && endpoint.username === '' && endpoint.password === '');
    requireThat(typeof clock === 'function' && Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 3
      && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000 && !signal?.aborted);
    requireThat(credentials && Reflect.ownKeys(credentials).length === 2
      && ['cookie', 'csrfToken'].every(k => Object.hasOwn(credentials, k) && typeof credentials[k] === 'string'
        && credentials[k].length <= 8192 && !/[\r\n\x00-\x1f\x7f]/.test(credentials[k])));
    credentials = { cookie: credentials.cookie, csrfToken: credentials.csrfToken };
    meter = createMeter({ phase: 'workload', clock });
    proxy = await createMeteringProxy({ target, meter, classify: input => {
      const token = input.headers['x-cloud-cost-attempt'], pending = expected.get(token);
      requireThat(pending && !pending.observed && input.method === 'POST' && input.path === pending.path
        && input.headers['x-cloud-cost-retry'] === String(pending.ordinal)
        && input.headers['x-cloud-cost-phase'] === 'workload');
      pending.observed = true;
      return { token, phase: 'workload', operation: 'fiscal', retryOrdinal: pending.ordinal, errorCode: null, sameAccount: null };
    } });
  } catch { await proxy?.close().catch(() => {}); fail(); }
  const abort = () => { poison(); current?.destroy(Error('Cancelled fiscal measurement')); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  const attempt = (path, bytes, ordinal) => new Promise((resolve, reject) => {
    const token = randomUUID(); expected.set(token, { path, ordinal, observed: false });
    let bytesIn = 0, bytesOut = 0, expectedIn = 0, statusCode = null, settled = false, timer;
    const chunks = [];
    const finish = interrupted => {
      if (settled) return; settled = true; clearTimeout(timer); current = null; expected.delete(token);
      try {
        meter.observeAttempt({ token, channel: 'producer', phase: 'workload', operation: 'fiscal', retryOrdinal: ordinal,
          outcome: interrupted ? 'transport-error' : statusCode >= 500 ? 'server-error' : statusCode >= 300 ? 'client-error' : 'success',
          statusCode, errorCode: null, sameAccount: null, bytesIn, bytesOut,
          attemptedBytesIn: Math.max(bytesIn, expectedIn), attemptedBytesOut: bytes.length });
        if (interrupted) { poison(); reject(Error('Invalid cloud cost fiscal measurement')); }
        else resolve({ statusCode, body: Buffer.concat(chunks) });
      } catch { poison(); reject(Error('Invalid cloud cost fiscal measurement')); }
    };
    const req = request(proxy.url, { method: 'POST', path, headers: {
      host: 'localhost', 'content-type': 'application/json', 'content-length': bytes.length,
      // Machine reports authenticate their signed proof and refuse a browser Origin.
      ...(path === paths.report ? {} : { origin: 'http://localhost', cookie: credentials.cookie, 'x-csrf-token': credentials.csrfToken }),
      'x-cloud-cost-attempt': token, 'x-cloud-cost-retry': ordinal, 'x-cloud-cost-phase': 'workload',
    } }, response => {
      statusCode = response.statusCode; expectedIn = Number(response.headers['content-length'] ?? 0);
      response.on('data', chunk => {
        bytesIn += chunk.length;
        if (bytesIn > 1048576) { poison(); req.destroy(Error('Oversized fiscal response')); finish(true); }
        else chunks.push(chunk);
      });
      response.once('end', () => finish(false)); response.once('error', () => finish(true));
    });
    current = req;
    timer = setTimeout(() => { poison(); req.destroy(Error('Fiscal measurement deadline')); }, timeoutMs);
    req.once('finish', () => { bytesOut = bytes.length; });
    req.once('error', () => finish(true));
    req.end(bytes);
  });
  const send = (action, body) => {
    let bytes;
    try {
      requireThat(!invalid && !closing && !active && !signal?.aborted && Object.hasOwn(paths, action));
      bytes = Buffer.from(JSON.stringify(body)); requireThat(bytes.length > 0 && bytes.length <= 16384);
    } catch { poison(); fail(); }
    const perform = async () => {
      try {
        for (let ordinal = 0; ordinal < maxAttempts; ordinal++) {
          requireThat(!invalid && !closing && !signal?.aborted);
          const result = await attempt(paths[action], bytes, ordinal);
          if (result.statusCode < 500 || ordinal === maxAttempts - 1) return result;
        }
      } catch { poison(); fail(); }
    };
    active = perform().finally(() => { active = null; });
    return active;
  };
  const close = () => {
    if (closing) return closing;
    if (active) abort();
    closing = (async () => {
      try {
        await active?.catch(() => {}); await proxy.close();
        const result = meter.snapshot(); requireThat(!invalid && result.reconciled && result.accounting.producer.attempts > 0); closed = true;
      } catch { poison(); fail(); }
      finally { signal?.removeEventListener('abort', abort); }
    })();
    return closing;
  };
  const snapshot = () => {
    try { requireThat(closed && !invalid && !active); return meter.snapshot(); }
    catch { fail(); }
  };
  return { url: proxy.url, request: send, close, snapshot };
}
