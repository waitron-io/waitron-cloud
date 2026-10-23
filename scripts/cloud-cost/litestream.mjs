import { StringDecoder } from 'node:string_decoder';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { Transform, pipeline } from 'node:stream';
const fail = () => { throw Error('Invalid cloud cost Litestream audit'); };
const requireThat = value => { if (!value) fail(); };
const operations = ['put', 'get', 'head', 'list', 'delete', 'delete-many', 'multipart-create', 'multipart-upload', 'multipart-complete', 'multipart-abort'];
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];
function identity(invocation, attempt) {
  requireThat(typeof invocation === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(invocation));
  requireThat(typeof attempt === 'string');
  const match = /^attempt=([1-9]\d*); max=([1-9]\d*)$/.exec(attempt);
  requireThat(match && Number.isSafeInteger(Number(match[2])) && Number(match[1]) <= Number(match[2]));
  return { key: invocation + ':' + match[1], invocation, ordinal: Number(match[1]) - 1 };
}
// Classify producer log requests independently and require any SDK hint to agree with their shape.
function operation(line, allowBulkDeletes = false) {
  const match = /^(GET|HEAD|PUT|POST|DELETE) (\/[^ ]*) HTTP\/1\.1$/.exec(line);
  requireThat(match && !/[#\\]/.test(match[2]) && !match[2].startsWith('//'));
  const [method, path] = match.slice(1), url = new URL(path, 'http://local');
  const object = url.pathname.slice(1).split('/').slice(1).join('/') !== '';
  const q = url.searchParams, keys = [...q.keys()];
  requireThat(new Set(keys).size === keys.length && url.pathname !== '/');
  if (q.has('x-id')) {
    const hint = q.get('x-id'); q.delete('x-id');
    const name = operation(`${method} ${url.pathname}${q.size ? '?' + q.toString() : ''} HTTP/1.1`, allowBulkDeletes);
    const hints = { PutObject: 'put', GetObject: 'get', HeadObject: 'head', DeleteObject: 'delete',
      CreateMultipartUpload: 'multipart-create', UploadPart: 'multipart-upload', CompleteMultipartUpload: 'multipart-complete',
      AbortMultipartUpload: 'multipart-abort', ListObjectsV2: 'list', DeleteObjects: 'delete-many' };
    requireThat(hints[hint] === name); return name;
  }
  if (!object) {
    if (q.has('delete')) {
      requireThat(allowBulkDeletes === true && method === 'POST' && keys.length === 1 && q.get('delete') === ''); return 'delete-many';
    }
    requireThat(method === 'GET' && keys.every(k => ['list-type', 'prefix', 'delimiter', 'max-keys', 'continuation-token', 'start-after', 'encoding-type', 'marker'].includes(k)));
    return 'list';
  }
  if (q.has('uploads')) { requireThat(method === 'POST' && keys.length === 1); return 'multipart-create'; }
  if (q.has('uploadId')) {
    requireThat(q.get('uploadId') !== '');
    if (q.has('partNumber')) {
      requireThat(method === 'PUT' && keys.length === 2 && /^[1-9]\d*$/.test(q.get('partNumber')) && Number(q.get('partNumber')) <= 10000);
      return 'multipart-upload';
    }
    requireThat(keys.length === 1 && ['POST', 'DELETE'].includes(method));
    return method === 'POST' ? 'multipart-complete' : 'multipart-abort';
  }
  requireThat(keys.length === 0 || keys.length === 1 && keys[0] === 'versionId');
  const name = { GET: 'get', HEAD: 'head', PUT: 'put', DELETE: 'delete' }[method];
  requireThat(name); return name;
}

export function createLitestreamRequestAudit({ phase, allowBulkDeletes = false }) {
  requireThat(phases.includes(phase));
  const decoder = new StringDecoder('utf8'), producer = new Map(), observer = new Map(), sequences = new Map();
  let buffer = '', current = null, ended = false, invalid = false;
  const guarded = fn => (...args) => {
    try { requireThat(!invalid); return fn(...args); } catch { invalid = true; fail(); }
  };
  const line = text => {
    if (/^SDK .* DEBUG Request$/.test(text)) { requireThat(!current); current = { operation: null, invocation: null, attempt: null, size: 0 }; return; }
    if (!current) return;
    current.size += text.length; requireThat(current.size <= 65536);
    if (current.operation === null) { current.operation = operation(text, allowBulkDeletes); return; }
    if (text === '') {
      const id = identity(current.invocation, current.attempt);
      requireThat(!producer.has(id.key) && id.ordinal === (sequences.get(id.invocation) ?? -1) + 1 && producer.size < 100000);
      producer.set(id.key, { operation: current.operation, ordinal: id.ordinal }); sequences.set(id.invocation, id.ordinal);
      current = null; return;
    }
    const header = /^([^: ]+): (.*)$/.exec(text); requireThat(header);
    const name = header[1].toLowerCase();
    if (name === 'amz-sdk-invocation-id') { requireThat(current.invocation === null); current.invocation = header[2]; }
    if (name === 'amz-sdk-request') { requireThat(current.attempt === null); current.attempt = header[2]; }
  };
  const write = guarded(chunk => {
    requireThat(!ended && Buffer.isBuffer(chunk) && chunk.length <= 1048576);
    buffer += decoder.write(chunk);
    let offset;
    while ((offset = buffer.indexOf('\n')) !== -1) {
      requireThat(offset <= 65536); const text = buffer.slice(0, offset).replace(/\r$/, ''); buffer = buffer.slice(offset + 1); line(text);
    }
    requireThat(buffer.length <= 65536);
  });
  const observe = guarded(({ headers, operation: name }) => {
    requireThat(!ended && operations.includes(name) && (name !== 'delete-many' || allowBulkDeletes === true));
    const id = identity(headers?.['amz-sdk-invocation-id'], headers?.['amz-sdk-request']);
    requireThat(!observer.has(id.key) && observer.size < 100000);
    observer.set(id.key, { operation: name, ordinal: id.ordinal });
    return { token: id.key, phase, retryOrdinal: id.ordinal, operation: name, errorCode: null, sameAccount: null };
  });
  const end = guarded(() => {
    requireThat(!ended); buffer += decoder.end();
    requireThat(current === null && buffer === ''); ended = true;
  });
  const snapshot = () => {
    requireThat(!invalid && ended);
    const requestsReconciled = producer.size > 0 && producer.size === observer.size && [...producer].every(([key, p]) => {
      const o = observer.get(key); return o && p.operation === o.operation && p.ordinal === o.ordinal;
    });
    const requests = new Map();
    for (const p of producer.values()) {
      const key = p.operation + ':' + p.ordinal;
      if (!requests.has(key)) requests.set(key, { phase, operation: p.operation, retryOrdinal: p.ordinal, attempts: 0 });
      requests.get(key).attempts++;
    }
    // Header logs prove request attempts only; response bytes and retained objects require separate evidence.
    return { requestsReconciled, status: 'unknown', producerAttempts: producer.size, observerAttempts: observer.size,
      requests: [...requests.values()], gaps: [...(!requestsReconciled ? ['litestream:requests-unreconciled'] : []),
        'litestream:body-bytes-unpaired', 'litestream:object-lifetimes-unpaired'] };
  };
  return { write, observe, end, snapshot };
}

const closeStages = new Set(['replication-transport', 'restore-transport', 'cleanup-replication-transport',
  'cleanup-restore-transport', 'cleanup-replication-proxy', 'cleanup-restore-proxy', 'cleanup-admin-proxy']);
const closeReasons = new Set(['request-validation', 'lifetime-completion', 'body-accounting', 'transfer-interrupted',
  'upstream-error', 'upstream-response-interrupted', 'client-error', 'phase-change', 'active-close']);
const networkErrors = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE']);
const ioEvents = new Set(['request-pipeline', 'response-aborted', 'response-error',
  'response-headers', 'response-pipeline', 'upstream-error', 'upstream-timeout', 'client-error']);
const transportOperations = new Set(operations);
const own = (value, key) => {
  try { return value && (typeof value === 'object' || typeof value === 'function')
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined; }
  catch { return undefined; }
};

// Error text and request metadata can contain credentials; publish only closed categories and counts.
export async function withLitestreamCloseDiagnostics({ stage, close, report = line => console.error(line) }) {
  requireThat(closeStages.has(stage) && typeof close === 'function' && typeof report === 'function');
  const record = { kind: 'litestream-close', stage };
  const emit = record => { try { report(JSON.stringify(record)); } catch { /* Diagnostics cannot change cleanup or its outcome. */ } };
  emit({ ...record, status: 'started' });
  try {
    const result = await close();
    emit({ ...record, status: 'fulfilled' }); return result;
  } catch (error) {
    const raw = own(error, 'litestreamCloseDiagnostic'), reason = own(raw, 'reason');
    const diagnostic = {};
    if (closeReasons.has(reason)) diagnostic.reason = reason;
    for (const key of ['pending', 'completed', 'connections']) {
      const value = own(raw, key);
      if (Number.isSafeInteger(value) && value >= 0) diagnostic[key] = value;
    }
    const code = own(raw, 'code'); if (networkErrors.has(code)) diagnostic.code = code;
    const ioEvent = own(raw, 'ioEvent'); if (ioEvents.has(ioEvent)) diagnostic.ioEvent = ioEvent;
    const operation = own(raw, 'operation'); if (transportOperations.has(operation)) diagnostic.operation = operation;
    emit({ ...record, status: 'rejected', error: closeReasons.has(reason) ? 'transport-refused' : 'unclassified',
      ...(Object.keys(diagnostic).length ? { diagnostic } : {}) });
    throw error;
  }
}

// This first-hop counter shares no byte events with the downstream storage observer.
// It measures transferred HTTP bodies, not application consumption or TCP/TLS overhead.
export async function createLitestreamTransport({ target, meter, phase, lifetimes, allowBulkDeletes = false }) {
  let endpoint;
  try {
    endpoint = new URL(target);
    requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === '' && endpoint.username === '' && endpoint.password === '');
    requireThat(phases.includes(phase) && typeof meter?.observeAttempt === 'function' && typeof meter?.invalidate === 'function');
    requireThat(lifetimes === undefined || typeof lifetimes?.begin === 'function');
  } catch { fail(); }
  let invalid = false, closing, refusal, currentPhase = phase;
  const invocations = new Map(), pending = new Set(), connections = new Set();
  const idleWaiters = new Set();
  let completed = 0;
  const remember = (reason, error, ioEvent, operation) => {
    refusal ??= { reason, ...(ioEvent ? { ioEvent, operation } : {}) };
    if (refusal.reason === reason && !refusal.code && networkErrors.has(own(error, 'code'))) refusal.code = own(error, 'code');
  };
  const poison = (reason, error, ioEvent) => { remember(reason, error, ioEvent); invalid = true; meter.invalidate(); };
  const size = value => {
    requireThat(value === undefined || typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));
    const n = Number(value ?? 0); requireThat(Number.isSafeInteger(n)); return n;
  };
  const server = createServer(async (source, destination) => {
    let id, name, expectedOut, completeLifetime, body;
    try {
      requireThat(!invalid && !closing && !Object.hasOwn(source.headers, 'x-amz-copy-source'));
      id = identity(source.headers['amz-sdk-invocation-id'], source.headers['amz-sdk-request']);
      name = operation(`${source.method} ${source.url} HTTP/1.1`, allowBulkDeletes);
      const previous = invocations.get(id.invocation);
      requireThat(id.ordinal === (previous?.ordinal ?? -1) + 1 && (!previous || previous.name === name && previous.path === source.url)
        && invocations.size < 100000);
      expectedOut = size(source.headers['content-length']);
      invocations.set(id.invocation, { ordinal: id.ordinal, name, path: source.url });
      pending.add(id.key);
      if (name === 'delete-many' || name === 'multipart-complete' && lifetimes) {
        requireThat(expectedOut > 0 && expectedOut <= 1048576);
        // Validate bounded mutation controls before forwarding them to the backend.
        const chunks = []; let length = 0;
        for await (const chunk of source) { length += chunk.length; requireThat(length <= expectedOut); chunks.push(chunk); }
        requireThat(!closing && !invalid && length === expectedOut); body = Buffer.concat(chunks);
      }
      if (lifetimes) {
        completeLifetime = lifetimes.begin({ method: source.method, path: source.url, headers: source.headers, body });
        requireThat(typeof completeLifetime === 'function');
      }
    } catch { poison('request-validation'); if (id) pending.delete(id.key); source.resume(); destination.writeHead(400); destination.end(); return; }
    let bytesOut = 0, bytesIn = 0, expectedIn = 0, statusCode = null, responseHeaders, sent = false, received = false, settled = false;
    const responseChunks = lifetimes && ['delete-many', 'multipart-create', 'multipart-complete'].includes(name) ? [] : null;
    const finish = (interrupted, reason = 'transfer-interrupted', error, ioEvent) => {
      if (settled || !interrupted && (!sent || !received)) return;
      settled = true; pending.delete(id.key); completed++;
      // Lifetime refusal is a consequence of interrupted I/O; retain the original cause without changing invalidation.
      if (interrupted) remember(reason, error, ioEvent, name);
      let completing = 'lifetime-completion';
      try {
        completeLifetime?.({ statusCode, bytesOut, interrupted, responseHeaders,
          responseBody: responseChunks ? Buffer.concat(responseChunks) : undefined });
        completing = 'body-accounting';
        const outcome = interrupted ? 'transport-error' : statusCode >= 500 ? 'server-error' : statusCode >= 300 ? 'client-error' : 'success';
        meter.observeAttempt({ token: id.key, phase: currentPhase, operation: name, retryOrdinal: id.ordinal, channel: 'producer', outcome,
          statusCode, errorCode: null, sameAccount: null, bytesIn, bytesOut,
          attemptedBytesIn: Math.max(bytesIn, expectedIn), attemptedBytesOut: Math.max(bytesOut, expectedOut) });
      } catch { poison(completing); }
      if (interrupted) poison(reason, error);
      if (pending.size === 0) for (const waiter of idleWaiters) {
        idleWaiters.delete(waiter);
        try { requireThat(!invalid && !closing); waiter.resolve(waiter.action()); }
        catch { waiter.reject(Error('Invalid cloud cost Litestream audit')); }
      }
    };
    const upstream = request(endpoint, { method: source.method, path: source.url, headers: source.headers }, response => {
      response.once('aborted', () => remember('upstream-response-interrupted', undefined, 'response-aborted', name));
      response.on('error', error => remember('upstream-response-interrupted', error, 'response-error', name));
      try { statusCode = response.statusCode; responseHeaders = response.headers;
        expectedIn = source.method === 'HEAD' ? 0 : size(response.headers['content-length']); }
      catch (error) { finish(true, 'transfer-interrupted', error, 'response-headers'); response.destroy(); destination.destroy(); return; }
      destination.writeHead(statusCode, response.headers);
      const counter = new Transform({ transform(chunk, encoding, next) {
        bytesIn += chunk.length;
        if (responseChunks) {
          if (bytesIn > 1048576) { next(Error('Invalid cloud cost Litestream audit')); return; }
          responseChunks.push(chunk);
        }
        next(null, chunk);
      } });
      try { pipeline(response, counter, destination, error => { received = !error; finish(!!error, 'transfer-interrupted', error, 'response-pipeline'); }); }
      catch (error) { finish(true, 'transfer-interrupted', error, 'response-pipeline'); response.destroy(); destination.destroy(); }
    });
    connections.add(upstream); upstream.on('close', () => connections.delete(upstream));
    let upstreamTimedOut = false;
    upstream.setTimeout(30000, () => { upstreamTimedOut = true; upstream.destroy(); });
    upstream.on('error', error => { finish(true, 'upstream-error', error, upstreamTimedOut ? 'upstream-timeout' : 'upstream-error'); destination.destroy(); });
    if (body) { bytesOut = body.length; upstream.end(body, () => { sent = true; finish(false); }); }
    else {
      const counter = new Transform({ transform(chunk, encoding, next) { bytesOut += chunk.length; next(null, chunk); } });
      pipeline(source, counter, upstream, error => { sent = !error; finish(!!error, 'transfer-interrupted', error, 'request-pipeline'); });
    }
  });
  server.on('clientError', (error, socket) => { poison('client-error', error, 'client-error'); socket.destroy(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, whenIdle: async action => {
    requireThat(!invalid && !closing && typeof action === 'function');
    if (pending.size === 0) return action();
    return new Promise((resolve, reject) => idleWaiters.add({ action, resolve, reject }));
  }, setPhase: next => {
    try {
      // Both independent counters must see one phase for the entire transfer.
      requireThat(!invalid && !closing && pending.size === 0 && phases.includes(next));
      currentPhase = next;
    } catch { poison('phase-change'); fail(); }
  }, snapshot: () => {
    requireThat(!invalid && pending.size === 0 && completed > 0); return meter.snapshot();
  }, close: () => {
    closing ??= (async () => {
      for (const waiter of idleWaiters) waiter.reject(Error('Invalid cloud cost Litestream audit'));
      idleWaiters.clear();
      // Invalidate active transfers before asynchronous socket-close events can report an empty checkpoint.
      if (pending.size > 0) poison('active-close');
      const ended = [...connections].map(connection => new Promise(resolve => connection.once('close', resolve)));
      for (const connection of connections) connection.destroy();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      await Promise.all(ended);
      if (invalid || pending.size !== 0) {
        const error = Error('Invalid cloud cost Litestream audit');
        error.litestreamCloseDiagnostic = { ...refusal, pending: pending.size, completed, connections: connections.size };
        throw error;
      }
    })();
    return closing;
  } };
}
