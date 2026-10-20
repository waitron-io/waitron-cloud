import { StringDecoder } from 'node:string_decoder';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { Transform, pipeline } from 'node:stream';
const fail = () => { throw Error('Invalid cloud cost Litestream audit'); };
const requireThat = value => { if (!value) fail(); };
const operations = ['put', 'get', 'head', 'list', 'delete', 'multipart-create', 'multipart-upload', 'multipart-complete', 'multipart-abort'];
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];
function identity(invocation, attempt) {
  requireThat(typeof invocation === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(invocation));
  requireThat(typeof attempt === 'string');
  const match = /^attempt=([1-9]\d*); max=([1-9]\d*)$/.exec(attempt);
  requireThat(match && Number.isSafeInteger(Number(match[2])) && Number(match[1]) <= Number(match[2]));
  return { key: invocation + ':' + match[1], invocation, ordinal: Number(match[1]) - 1 };
}
// Classify producer log requests independently and require any SDK hint to agree with their shape.
function operation(line) {
  const match = /^(GET|HEAD|PUT|POST|DELETE) (\/[^ ]*) HTTP\/1\.1$/.exec(line);
  requireThat(match && !/[#\\]/.test(match[2]) && !match[2].startsWith('//'));
  const [method, path] = match.slice(1), url = new URL(path, 'http://local');
  const object = url.pathname.slice(1).split('/').slice(1).join('/') !== '';
  const q = url.searchParams, keys = [...q.keys()];
  requireThat(new Set(keys).size === keys.length && url.pathname !== '/');
  if (q.has('x-id')) {
    const hint = q.get('x-id'); q.delete('x-id');
    const name = operation(`${method} ${url.pathname}${q.size ? '?' + q.toString() : ''} HTTP/1.1`);
    const hints = { PutObject: 'put', GetObject: 'get', HeadObject: 'head', DeleteObject: 'delete',
      CreateMultipartUpload: 'multipart-create', UploadPart: 'multipart-upload', CompleteMultipartUpload: 'multipart-complete',
      AbortMultipartUpload: 'multipart-abort', ListObjectsV2: 'list' };
    requireThat(hints[hint] === name); return name;
  }
  if (!object) {
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

export function createLitestreamRequestAudit({ phase }) {
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
    if (current.operation === null) { current.operation = operation(text); return; }
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
    requireThat(!ended && operations.includes(name));
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

// This first-hop counter shares no byte events with the downstream storage observer.
// It measures transferred HTTP bodies, not application consumption or TCP/TLS overhead.
export async function createLitestreamTransport({ target, meter, phase, lifetimes }) {
  let endpoint;
  try {
    endpoint = new URL(target);
    requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === '' && endpoint.username === '' && endpoint.password === '');
    requireThat(phases.includes(phase) && typeof meter?.observeAttempt === 'function' && typeof meter?.invalidate === 'function');
    requireThat(lifetimes === undefined || typeof lifetimes?.begin === 'function');
  } catch { fail(); }
  let invalid = false, closing;
  const invocations = new Map(), pending = new Set(), connections = new Set();
  let completed = 0;
  const poison = () => { invalid = true; meter.invalidate(); };
  const size = value => {
    requireThat(value === undefined || typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));
    const n = Number(value ?? 0); requireThat(Number.isSafeInteger(n)); return n;
  };
  const server = createServer((source, destination) => {
    let id, name, expectedOut, completeLifetime;
    try {
      requireThat(!invalid && !closing && !Object.hasOwn(source.headers, 'x-amz-copy-source'));
      id = identity(source.headers['amz-sdk-invocation-id'], source.headers['amz-sdk-request']);
      name = operation(`${source.method} ${source.url} HTTP/1.1`);
      const previous = invocations.get(id.invocation);
      requireThat(id.ordinal === (previous?.ordinal ?? -1) + 1 && (!previous || previous.name === name && previous.path === source.url)
        && invocations.size < 100000);
      expectedOut = size(source.headers['content-length']);
      if (lifetimes) {
        completeLifetime = lifetimes.begin({ method: source.method, path: source.url, headers: source.headers });
        requireThat(typeof completeLifetime === 'function');
      }
      invocations.set(id.invocation, { ordinal: id.ordinal, name, path: source.url });
      pending.add(id.key);
    } catch { poison(); source.resume(); destination.writeHead(400); destination.end(); return; }
    let bytesOut = 0, bytesIn = 0, expectedIn = 0, statusCode = null, responseHeaders, sent = false, received = false, settled = false;
    const finish = interrupted => {
      if (settled || !interrupted && (!sent || !received)) return;
      settled = true; pending.delete(id.key); completed++;
      try {
        completeLifetime?.({ statusCode, bytesOut, interrupted, responseHeaders });
        const outcome = interrupted ? 'transport-error' : statusCode >= 500 ? 'server-error' : statusCode >= 300 ? 'client-error' : 'success';
        meter.observeAttempt({ token: id.key, phase, operation: name, retryOrdinal: id.ordinal, channel: 'producer', outcome,
          statusCode, errorCode: null, sameAccount: null, bytesIn, bytesOut,
          attemptedBytesIn: Math.max(bytesIn, expectedIn), attemptedBytesOut: Math.max(bytesOut, expectedOut) });
      } catch { poison(); }
      if (interrupted) poison();
    };
    const upstream = request(endpoint, { method: source.method, path: source.url, headers: source.headers }, response => {
      try { statusCode = response.statusCode; responseHeaders = response.headers;
        expectedIn = source.method === 'HEAD' ? 0 : size(response.headers['content-length']); }
      catch { finish(true); response.destroy(); destination.destroy(); return; }
      destination.writeHead(statusCode, response.headers);
      const counter = new Transform({ transform(chunk, encoding, next) { bytesIn += chunk.length; next(null, chunk); } });
      pipeline(response, counter, destination, error => { received = !error; finish(!!error); });
    });
    connections.add(upstream); upstream.on('close', () => connections.delete(upstream));
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on('error', () => { finish(true); destination.destroy(); });
    const counter = new Transform({ transform(chunk, encoding, next) { bytesOut += chunk.length; next(null, chunk); } });
    pipeline(source, counter, upstream, error => { sent = !error; finish(!!error); });
  });
  server.on('clientError', (error, socket) => { poison(); socket.destroy(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, snapshot: () => {
    requireThat(!invalid && pending.size === 0 && completed > 0); return meter.snapshot();
  }, close: () => {
    closing ??= (async () => {
      // Invalidate active transfers before asynchronous socket-close events can report an empty checkpoint.
      if (pending.size > 0) poison();
      const ended = [...connections].map(connection => new Promise(resolve => connection.once('close', resolve)));
      for (const connection of connections) connection.destroy();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      await Promise.all(ended); requireThat(!invalid && pending.size === 0);
    })();
    return closing;
  } };
}
