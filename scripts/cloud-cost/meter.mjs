import { createServer, request } from 'node:http';
import { once } from 'node:events';

const fail = () => { throw new Error('Invalid cloud cost meter'); };
const requireThat = condition => { if (!condition) fail(); };
const count = n => Number.isSafeInteger(n) && n >= 0;
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];
const classes = ['stream', 'snapshot', 'daily-archive', 'monthly-archive', 'protected', 'scratch'];
const requestClasses = { put: 's3-write', get: 's3-read', head: 's3-read', list: 's3-list', delete: 's3-delete',
  'multipart-create': 's3-multipart', 'multipart-upload': 's3-multipart', 'multipart-complete': 's3-multipart',
  'multipart-abort': 's3-delete', remote: 'network', email: 'smtp', fiscal: 'fiscal', kms: 'kms-symmetric' };
const attemptKeys = ['token', 'channel', 'phase', 'operation', 'retryOrdinal', 'outcome', 'statusCode', 'errorCode', 'sameAccount',
  'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'];
const exact = (value, keys) => requireThat(value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(k => keys.includes(k)
    && Object.getOwnPropertyDescriptor(value, k).get === undefined));
const totals = () => ({ attempts: 0, bytesIn: 0, bytesOut: 0 });
const token = value => requireThat(typeof value === 'string' && value.length > 0 && value.length <= 200);
function validateAttempt(e) {
  exact(e, attemptKeys); token(e.token);
  requireThat(['producer', 'observer'].includes(e.channel) && phases.includes(e.phase) && Object.hasOwn(requestClasses, e.operation));
  requireThat(['success', 'client-error', 'server-error', 'transport-error'].includes(e.outcome));
  requireThat(['retryOrdinal', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'].every(k => count(e[k])));
  requireThat(e.bytesIn <= e.attemptedBytesIn && e.bytesOut <= e.attemptedBytesOut);
  requireThat(e.statusCode === null || (Number.isInteger(e.statusCode) && e.statusCode >= 200 && e.statusCode <= 599));
  requireThat(e.outcome === 'transport-error' || (e.outcome === 'success' && e.statusCode >= 200 && e.statusCode < 300)
    || (e.outcome === 'client-error' && e.statusCode >= 300 && e.statusCode < 500) || (e.outcome === 'server-error' && e.statusCode >= 500));
  requireThat(e.errorCode === null || ['AccessDenied', 'PreconditionFailed', 'NoSuchKey', 'SignatureDoesNotMatch',
    'ExpiredToken', 'AuthorizationHeaderMalformed', 'InvalidRange', 'unknown'].includes(e.errorCode));
  requireThat([true, false, null].includes(e.sameAccount));
  return structuredClone(e);
}
function billable(e) {
  const requestClass = requestClasses[e.operation];
  if (requestClass === 's3-delete') return 0;
  if (!requestClass.startsWith('s3-')) return null;
  if (e.statusCode === null) return null;
  if (e.statusCode >= 500) return 0;
  if (e.statusCode >= 200 && e.statusCode < 300) return 1;
  // AWS documents exceptions to 4xx billing; an unknown error cannot be priced by status alone.
  if (['SignatureDoesNotMatch', 'ExpiredToken', 'AuthorizationHeaderMalformed', 'InvalidRange'].includes(e.errorCode)) return 0;
  if (e.errorCode === 'AccessDenied') return e.sameAccount === null ? null : Number(e.sameAccount);
  if (['PreconditionFailed', 'NoSuchKey'].includes(e.errorCode)) return 1;
  return null;
}

export function createMeter({ phase, clock }) {
  requireThat(phases.includes(phase) && typeof clock === 'function');
  const attempts = { producer: new Map(), observer: new Map() }; const objects = new Map(); const rows = new Map();
  let lastTime = clock(); requireThat(Number.isFinite(lastTime) && lastTime >= 0);
  let invalid = false;
  const advance = () => {
    const time = clock(); requireThat(Number.isFinite(time) && time >= lastTime);
    for (const o of objects.values()) if (!o.deleted) rows.get(o.class).byteSeconds += o.bytes * (time - lastTime);
    requireThat([...rows.values()].every(r => Number.isFinite(r.byteSeconds)));
    lastTime = time;
  };
  const observeAttempt = event => {
    try {
      const e = validateAttempt(event);
      requireThat(!attempts[e.channel].has(e.token)); advance(); attempts[e.channel].set(e.token, e);
    } catch { invalid = true; fail(); }
  };
  const observeObject = event => {
    try {
      exact(event, ['token', 'action', 'class', 'bytes']); token(event.token);
      requireThat(classes.includes(event.class) && count(event.bytes));
      requireThat(['create', 'noncurrent', 'delete', 'marker', 'multipart-create', 'multipart-part', 'multipart-complete', 'multipart-abort'].includes(event.action));
      const e = structuredClone(event); const existing = objects.get(e.token);
      if (['create', 'marker', 'multipart-create'].includes(e.action)) requireThat(!existing);
      else requireThat(existing && !existing.deleted && existing.class === e.class);
      if (e.action === 'noncurrent') requireThat(existing.state === 'current' && e.bytes === 0);
      if (e.action.startsWith('multipart-') && e.action !== 'multipart-create') requireThat(existing.state === 'multipart');
      if (['delete', 'multipart-abort', 'multipart-create'].includes(e.action)) requireThat(e.bytes === 0);
      if (e.action === 'multipart-complete') requireThat(e.bytes === existing.bytes);
      advance();
      if (!rows.has(e.class)) rows.set(e.class, { class: e.class, bytes: 0, byteSeconds: 0,
        currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
      if (['create', 'marker', 'multipart-create'].includes(e.action)) objects.set(e.token, { class: e.class, bytes: e.bytes,
        state: e.action === 'marker' ? 'marker' : e.action === 'multipart-create' ? 'multipart' : 'current', deleted: false });
      else if (e.action === 'noncurrent') existing.state = 'noncurrent';
      else if (['delete', 'multipart-abort'].includes(e.action)) existing.deleted = true;
      else if (e.action === 'multipart-part') { requireThat(count(existing.bytes + e.bytes)); existing.bytes += e.bytes; }
      else if (e.action === 'multipart-complete') existing.state = 'current';
    } catch { invalid = true; fail(); }
  };
  const snapshot = () => {
    try {
      requireThat(!invalid); advance(); const producer = totals(); const observer = totals(); const requests = new Map(); const billing = new Map(); const gaps = [];
      for (const channel of ['producer', 'observer']) for (const e of attempts[channel].values()) {
        const total = channel === 'producer' ? producer : observer;
        total.attempts++; total.bytesIn += e.bytesIn; total.bytesOut += e.bytesOut;
        if (channel !== 'producer') continue;
        const requestClass = requestClasses[e.operation]; const key = [e.phase, e.operation, e.outcome, e.retryOrdinal].join(':');
        if (!requests.has(key)) requests.set(key, { phase: e.phase, operation: e.operation, requestClass, outcome: e.outcome,
          retryOrdinal: e.retryOrdinal, attempts: 0, successful: 0, failed: 0, retried: 0,
          bytesIn: 0, bytesOut: 0, attemptedBytesIn: 0, attemptedBytesOut: 0 });
        const r = requests.get(key); r.attempts++; r[e.outcome === 'success' ? 'successful' : 'failed']++;
        if (e.retryOrdinal > 0) r.retried++;
        for (const k of ['bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut']) r[k] += e[k];
        const billingKey = `${e.phase}:${requestClass}`;
        if (!billing.has(billingKey)) billing.set(billingKey, { phase: e.phase, requestClass, quantity: 0, status: 'measured' });
        const b = billing.get(billingKey); const quantity = billable(e);
        if (quantity === null) { b.quantity = null; b.status = 'unknown'; gaps.push('request-billing:unknown'); }
        else if (b.quantity !== null) b.quantity += quantity;
      }
      const discrepancy = Object.fromEntries(Object.keys(producer).map(k => [k, observer[k] - producer[k]]));
      const same = (p, o) => o && ['phase', 'operation', 'retryOrdinal', 'outcome', 'statusCode', 'bytesIn', 'bytesOut',
        'attemptedBytesIn', 'attemptedBytesOut'].every(k => p[k] === o[k]);
      const reconciled = attempts.producer.size === attempts.observer.size
        && [...attempts.producer].every(([id, p]) => same(p, attempts.observer.get(id)));
      if (!reconciled) {
        gaps.push('accounting:unreconciled');
        for (const row of billing.values()) { row.quantity = null; row.status = 'unknown'; }
      }
      const aggregatedObjects = [...rows.values()].map(r => ({ ...r, bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }));
      for (const o of objects.values()) if (!o.deleted) {
        const r = aggregatedObjects.find(r => r.class === o.class); r.bytes += o.bytes;
        r[{ current: 'currentVersions', noncurrent: 'noncurrentVersions', marker: 'deleteMarkers', multipart: 'unfinishedMultipart' }[o.state]]++;
      }
      requireThat([producer, observer].every(t => Object.values(t).every(count)));
      return { status: reconciled ? 'measured' : 'unknown', reconciled, gaps: [...new Set(gaps)], billing: [...billing.values()],
        accounting: { requests: [...requests.values()], objects: aggregatedObjects, producer, observer, discrepancy } };
    } catch { fail(); }
  };
  return { observeAttempt, observeObject, snapshot };
}

export async function createMeteringProxy({ target, meter, classify }) {
  let endpoint;
  try {
    endpoint = new URL(target);
    requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && endpoint.username === '' && endpoint.password === '' && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === '');
    requireThat(typeof classify === 'function' && typeof meter.observeAttempt === 'function');
  } catch { fail(); }
  let failure = false;
  const server = createServer((incoming, outgoing) => {
    let metadata;
    try {
      metadata = classify({ method: incoming.method, path: incoming.url });
      exact(metadata, ['token', 'retryOrdinal', 'phase', 'operation', 'errorCode', 'sameAccount']);
      validateAttempt({ ...metadata, channel: 'observer', outcome: 'transport-error', statusCode: null,
        bytesIn: 0, bytesOut: 0, attemptedBytesIn: 0, attemptedBytesOut: 0 });
    } catch { failure = true; incoming.resume(); outgoing.writeHead(400); outgoing.end(); return; }
    let bytesIn = 0; let bytesOut = 0; let expectedIn = 0; let statusCode = null; let finished = false;
    const expectedOut = Number(incoming.headers['content-length'] ?? 0);
    const finish = interrupted => {
      if (finished) return; finished = true;
      const outcome = interrupted ? 'transport-error' : statusCode >= 500 ? 'server-error' : statusCode >= 300 ? 'client-error' : 'success';
      try { meter.observeAttempt({ ...metadata, channel: 'observer', outcome, statusCode, bytesIn, bytesOut,
        attemptedBytesIn: Math.max(bytesIn, expectedIn), attemptedBytesOut: Math.max(bytesOut, expectedOut) }); }
      catch { failure = true; }
    };
    // Pipes preserve backpressure; only byte counts and closed metadata survive the request.
    const upstream = request(endpoint, { method: incoming.method, path: incoming.url, headers: incoming.headers }, response => {
      statusCode = response.statusCode; expectedIn = Number(response.headers['content-length'] ?? 0);
      outgoing.writeHead(statusCode, response.headers);
      response.on('data', chunk => { bytesIn += chunk.length; });
      response.on('end', () => finish(false));
      response.on('error', () => { finish(true); outgoing.destroy(); });
      response.pipe(outgoing);
    });
    upstream.on('error', () => { finish(true); outgoing.destroy(); });
    incoming.on('data', chunk => { bytesOut += chunk.length; });
    incoming.on('aborted', () => { upstream.destroy(); finish(true); outgoing.destroy(); });
    outgoing.on('close', () => { if (!finished) { upstream.destroy(); finish(true); } });
    incoming.pipe(upstream);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (failure) fail();
  } };
}
