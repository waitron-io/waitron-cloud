import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const fail = () => { throw new Error('Invalid cloud cost meter'); };
const requireThat = condition => { if (!condition) fail(); };
const count = n => Number.isSafeInteger(n) && n >= 0;
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];
const classes = ['stream', 'snapshot', 'daily-archive', 'monthly-archive', 'protected', 'scratch'];
const requestClasses = { put: 's3-write', get: 's3-read', head: 's3-read', list: 's3-list', delete: 's3-delete', 'delete-many': 's3-delete',
  'bucket-create': 's3-control', 'bucket-delete': 's3-control', 'bucket-inspect': 's3-control', 'bucket-configure': 's3-control',
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
  if (requestClass === 's3-control') return null;
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

export function createMeter({ phase, clock, afterStop }) {
  requireThat(phases.includes(phase) && typeof clock === 'function');
  const attempts = { producer: new Map(), observer: new Map() }; const objects = new Map(); const rows = new Map();
  const pending = new Set();
  let lastTime = clock(); requireThat(Number.isFinite(lastTime) && lastTime >= 0);
  let invalid = false;
  let firstInvalidation = null, snapshotRefusal = null, advanceGuard = null;
  const invalidate = boundary => { invalid = true; firstInvalidation ??= boundary; afterStop?.invalidate(); };
  const advance = () => {
    advanceGuard = 'clock';
    const time = clock(); requireThat(Number.isFinite(time) && time >= lastTime);
    advanceGuard = 'storage-integral';
    for (const o of objects.values()) if (!o.deleted) rows.get(o.class).byteSeconds += o.bytes * (time - lastTime);
    requireThat([...rows.values()].every(r => Number.isFinite(r.byteSeconds)));
    lastTime = time;
  };
  const observeAttempt = (event, interruption = null) => {
    try {
      const e = validateAttempt(event);
      requireThat(!attempts[e.channel].has(e.token)); advance(); attempts[e.channel].set(e.token, e);
      const acceptedInterruption = afterStop?.settle(e, interruption) ?? false;
      if (e.channel === 'observer') pending.delete(e.token);
      return acceptedInterruption;
    } catch { invalidate('observe-attempt'); fail(); }
  };
  const observeObject = event => {
    try {
      exact(event, ['token', 'action', 'class', 'bytes']); token(event.token);
      requireThat(classes.includes(event.class) && count(event.bytes));
      requireThat(['create', 'noncurrent', 'current', 'delete', 'marker', 'multipart-create', 'multipart-part', 'multipart-resize', 'multipart-complete', 'multipart-abort'].includes(event.action));
      const e = structuredClone(event); const existing = objects.get(e.token);
      if (['create', 'marker', 'multipart-create'].includes(e.action)) requireThat(!existing);
      else requireThat(existing && !existing.deleted && existing.class === e.class);
      if (e.action === 'noncurrent') requireThat(existing.state === 'current' && e.bytes === 0);
      if (e.action === 'current') requireThat(existing.state === 'noncurrent' && e.bytes === 0);
      if (e.action.startsWith('multipart-') && e.action !== 'multipart-create') requireThat(existing.state === 'multipart');
      if (['delete', 'multipart-abort', 'multipart-create'].includes(e.action)) requireThat(e.bytes === 0);
      if (e.action === 'multipart-complete') requireThat(e.bytes === existing.bytes);
      advance();
      if (!rows.has(e.class)) rows.set(e.class, { class: e.class, bytes: 0, byteSeconds: 0,
        currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
      if (['create', 'marker', 'multipart-create'].includes(e.action)) objects.set(e.token, { class: e.class, bytes: e.bytes,
        state: e.action === 'marker' ? 'marker' : e.action === 'multipart-create' ? 'multipart' : 'current', deleted: false });
      else if (e.action === 'noncurrent') existing.state = 'noncurrent';
      else if (e.action === 'current') existing.state = 'current';
      else if (['delete', 'multipart-abort'].includes(e.action)) existing.deleted = true;
      else if (e.action === 'multipart-part') { requireThat(count(existing.bytes + e.bytes)); existing.bytes += e.bytes; }
      else if (e.action === 'multipart-resize') existing.bytes = e.bytes;
      else if (e.action === 'multipart-complete') existing.state = 'current';
    } catch { invalidate('observe-object'); fail(); }
  };
  const snapshot = () => {
    let guard = invalid ? 'invalidated' : 'pending-attempts';
    try {
      requireThat(!invalid && pending.size === 0);
      guard = 'advance'; advance(); guard = 'aggregation';
      const producer = totals(); const observer = totals(); const requests = new Map(); const observedRequests = new Map(); const billing = new Map(); const gaps = [];
      for (const channel of ['producer', 'observer']) for (const e of attempts[channel].values()) {
        const total = channel === 'producer' ? producer : observer;
        total.attempts++; total.bytesIn += e.bytesIn; total.bytesOut += e.bytesOut;
        const requestClass = requestClasses[e.operation]; const key = [e.phase, e.operation, e.outcome, e.retryOrdinal].join(':');
        const table = channel === 'producer' ? requests : observedRequests;
        if (!table.has(key)) table.set(key, { phase: e.phase, operation: e.operation, requestClass, outcome: e.outcome,
          retryOrdinal: e.retryOrdinal, attempts: 0, successful: 0, failed: 0, retried: 0,
          bytesIn: 0, bytesOut: 0, attemptedBytesIn: 0, attemptedBytesOut: 0 });
        const r = table.get(key); r.attempts++; r[e.outcome === 'success' ? 'successful' : 'failed']++;
        if (e.retryOrdinal > 0) r.retried++;
        for (const k of ['bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut']) r[k] += e[k];
        if (channel !== 'producer') continue;
        const billingKey = `${e.phase}:${requestClass}`;
        if (!billing.has(billingKey)) billing.set(billingKey, { phase: e.phase, requestClass, quantity: 0, status: 'measured' });
        const b = billing.get(billingKey); const quantity = billable(e);
        if (quantity === null) { b.quantity = null; b.status = 'unknown'; gaps.push('request-billing:unknown'); }
        else if (b.quantity !== null) b.quantity += quantity;
      }
      guard = 'after-stop'; const subset = afterStop?.snapshot();
      guard = 'aggregation';
      const incomplete = subset?.gaps.includes('after-stop:list-response-interrupted') === true;
      const discrepancy = Object.fromEntries(Object.keys(producer).map(k => [k, observer[k] - producer[k]]));
      const same = (p, o) => o && ['phase', 'operation', 'retryOrdinal', 'outcome', 'statusCode', 'bytesIn', 'bytesOut',
        'attemptedBytesIn', 'attemptedBytesOut'].every(k => p[k] === o[k]);
      const reconciled = attempts.producer.size === attempts.observer.size
        && [...attempts.producer].every(([id, p]) => same(p, attempts.observer.get(id)));
      if (!reconciled || incomplete) {
        if (!reconciled) gaps.push('accounting:unreconciled');
        if (incomplete) gaps.push('request-billing:unknown', 'after-stop:list-response-interrupted');
        for (const row of billing.values()) { row.quantity = null; row.status = 'unknown'; }
      }
      const aggregatedObjects = [...rows.values()].map(r => ({ ...r, bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }));
      for (const o of objects.values()) if (!o.deleted) {
        const r = aggregatedObjects.find(r => r.class === o.class); r.bytes += o.bytes;
        r[{ current: 'currentVersions', noncurrent: 'noncurrentVersions', marker: 'deleteMarkers', multipart: 'unfinishedMultipart' }[o.state]]++;
      }
      guard = 'attempt-totals'; requireThat([producer, observer].every(t => Object.values(t).every(count)));
      return { status: reconciled && !incomplete ? 'measured' : 'unknown', reconciled, gaps: [...new Set(gaps)], billing: [...billing.values()],
        observedRequests: [...observedRequests.values()],
        accounting: { requests: [...requests.values()], objects: aggregatedObjects, producer, observer, discrepancy } };
    } catch { snapshotRefusal = guard === 'advance' ? advanceGuard : guard; fail(); }
  };
  const beginAttempt = id => {
    try { token(id); requireThat(!pending.has(id) && !attempts.observer.has(id)); pending.add(id); }
    catch { invalidate('begin-attempt'); fail(); }
  };
  const checkpoint = () => {
    const producer = totals(), observer = totals(), outcomes = new Map();
    for (const hop of ['producer', 'observer']) for (const row of attempts[hop].values()) {
      const sum = hop === 'producer' ? producer : observer;
      sum.attempts++; sum.bytesIn += row.bytesIn; sum.bytesOut += row.bytesOut;
      const key = hop + ':' + row.outcome;
      if (!outcomes.has(key)) outcomes.set(key, { hop, outcome: row.outcome, attempts: 0 });
      outcomes.get(key).attempts++;
    }
    return { pending: pending.size, producer, observer, outcomes: [...outcomes.values()] };
  };
  return { observeAttempt, observeObject, snapshot, checkpoint, beginAttempt, ...(afterStop ? { afterStop } : {}),
    // Closed labels retain the first invalidation without reading event fields or advancing accounting.
    diagnostics: () => ({ firstInvalidation, snapshotRefusal, pendingAttempts: pending.size }),
    invalidate: () => invalidate('explicit') };
}

// Query names affect the S3 operation; values and object names never leave this classifier.
export function classifyStorageOperation({ method, path, copySource = false, allowBulkDeletes = false }) {
  try {
    requireThat(typeof allowBulkDeletes === 'boolean');
    requireThat(copySource === false && typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[\r\n#\\]/.test(path));
    const separator = path.indexOf('?');
    const pathname = separator === -1 ? path : path.slice(0, separator);
    const query = new URLSearchParams(separator === -1 ? '' : path.slice(separator + 1));
    const keys = [...query.keys()];
    requireThat(new Set(keys).size === keys.length);
    if (query.has('x-id')) {
      const hint = query.get('x-id'); query.delete('x-id');
      const operation = classifyStorageOperation({ method, path: pathname + (query.size ? '?' + query.toString() : ''), allowBulkDeletes });
      const hints = { CreateBucket: 'bucket-create', DeleteBucket: 'bucket-delete', HeadBucket: 'bucket-inspect',
        GetBucketLocation: 'bucket-inspect', GetBucketVersioning: 'bucket-inspect', PutBucketVersioning: 'bucket-configure',
        ListBuckets: 'list', ListObjects: 'list', ListObjectsV2: 'list', ListObjectVersions: 'list', ListMultipartUploads: 'list', ListParts: 'list',
        PutObject: 'put', GetObject: 'get', HeadObject: 'head', DeleteObject: 'delete', DeleteObjects: 'delete-many', CreateMultipartUpload: 'multipart-create',
        UploadPart: 'multipart-upload', CompleteMultipartUpload: 'multipart-complete', AbortMultipartUpload: 'multipart-abort' };
      requireThat(hints[hint] === operation); return operation;
    }
    const parts = pathname.slice(1).split('/');
    const bucket = parts[0] !== '', object = bucket && parts.slice(1).join('/') !== '';
    const has = key => query.has(key);
    if (has('delete')) {
      requireThat(allowBulkDeletes && bucket && !object && method === 'POST' && keys.length === 1 && query.get('delete') === '');
      return 'delete-many';
    }
    if (!bucket) { requireThat(method === 'GET' && keys.length === 0); return 'list'; }
    if (!object) {
      requireThat(!has('uploadId') && !has('partNumber') && !has('versionId'));
      if (has('location') || has('versioning')) {
        requireThat(keys.length === 1);
        if (method === 'GET') return 'bucket-inspect';
        requireThat(method === 'PUT' && has('versioning')); return 'bucket-configure';
      }
      if (method === 'GET') {
        const listKeys = has('uploads') ? ['uploads', 'prefix', 'delimiter', 'encoding-type', 'key-marker', 'upload-id-marker', 'max-uploads']
          : has('versions') ? ['versions', 'prefix', 'delimiter', 'encoding-type', 'key-marker', 'version-id-marker', 'max-keys']
          : ['list-type', 'prefix', 'delimiter', 'max-keys', 'continuation-token', 'start-after', 'encoding-type', 'marker'];
        requireThat(keys.every(k => listKeys.includes(k))); return 'list';
      }
      requireThat(keys.length === 0);
      const operation = { PUT: 'bucket-create', DELETE: 'bucket-delete', HEAD: 'bucket-inspect' }[method];
      requireThat(typeof operation === 'string'); return operation;
    }
    requireThat(!has('versions') && !has('location') && !has('versioning'));
    if (has('uploads')) { requireThat(method === 'POST' && keys.length === 1); return 'multipart-create'; }
    if (has('uploadId')) {
      requireThat(query.get('uploadId') !== '' && !has('versionId'));
      if (has('partNumber')) {
        requireThat(method === 'PUT' && keys.length === 2 && /^[1-9]\d*$/.test(query.get('partNumber'))
          && Number(query.get('partNumber')) <= 10000);
        return 'multipart-upload';
      }
      if (method === 'GET') { requireThat(keys.every(k => ['uploadId', 'max-parts', 'part-number-marker'].includes(k))); return 'list'; }
      requireThat(keys.length === 1);
      const operation = { POST: 'multipart-complete', DELETE: 'multipart-abort' }[method];
      requireThat(typeof operation === 'string'); return operation;
    }
    requireThat(keys.every(k => k === 'versionId'));
    const operation = { PUT: 'put', GET: 'get', HEAD: 'head', DELETE: 'delete' }[method];
    requireThat(typeof operation === 'string'); return operation;
  } catch { fail(); }
}

const storageBindings = new WeakMap();
export function assertStorageClientBinding(client, meter, phase) {
  const binding = storageBindings.get(client);
  requireThat(binding && binding.meter === meter && binding.phase === phase && binding.handler === client.config.requestHandler);
  return binding.endpoint;
}

const correlationHeaders = ['x-cloud-cost-attempt', 'x-cloud-cost-retry', 'x-cloud-cost-phase'];
export function correlatedStorageAttempt(input, { allowBulkDeletes = false } = {}) {
  const headers = input.headers;
  requireThat(headers && /^[a-f0-9-]{36}$/.test(headers[correlationHeaders[0]])
    && /^(0|[1-9]\d*)$/.test(headers[correlationHeaders[1]])
    && count(Number(headers[correlationHeaders[1]])) && phases.includes(headers[correlationHeaders[2]]));
  return { token: headers[correlationHeaders[0]], retryOrdinal: Number(headers[correlationHeaders[1]]),
    phase: headers[correlationHeaders[2]], operation: classifyStorageOperation({ ...input, allowBulkDeletes }), errorCode: null, sameAccount: null };
}

// The SDK command names are independent of the proxy's HTTP operation classifier.
const producerOperations = { PutObjectCommand: 'put', GetObjectCommand: 'get', HeadObjectCommand: 'head',
  DeleteObjectCommand: 'delete', ListBucketsCommand: 'list', ListObjectsCommand: 'list', ListObjectsV2Command: 'list', ListObjectVersionsCommand: 'list',
  ListMultipartUploadsCommand: 'list', ListPartsCommand: 'list', CreateBucketCommand: 'bucket-create',
  DeleteBucketCommand: 'bucket-delete', HeadBucketCommand: 'bucket-inspect', GetBucketLocationCommand: 'bucket-inspect',
  GetBucketVersioningCommand: 'bucket-inspect', PutBucketVersioningCommand: 'bucket-configure',
  CreateMultipartUploadCommand: 'multipart-create', UploadPartCommand: 'multipart-upload',
  CompleteMultipartUploadCommand: 'multipart-complete', AbortMultipartUploadCommand: 'multipart-abort' };

export function instrumentStorageClient({ client, meter, phase, endpoint, allowBulkDeletes = false }) {
  let target;
  try {
    requireThat(typeof allowBulkDeletes === 'boolean');
    target = new URL(endpoint);
    requireThat(target.protocol === 'http:' && ['127.0.0.1', 's3'].includes(target.hostname) && target.port !== ''
      && target.pathname === '/' && target.search === '' && target.hash === '' && target.username === '' && target.password === '');
    requireThat(phases.includes(phase) && typeof meter.observeAttempt === 'function' && typeof meter.invalidate === 'function'
      && typeof client.config.requestHandler.handle === 'function' && !client.middlewareStack.identify().includes('cloudCostProducer - initialize'));
  } catch { fail(); }
  const scope = new AsyncLocalStorage(), handler = client.config.requestHandler;
  client.middlewareStack.add((next, context) => async args => {
    const operation = context.commandName === 'DeleteObjectsCommand' && allowBulkDeletes ? 'delete-many' : producerOperations[context.commandName];
    if (typeof operation !== 'string') { meter.invalidate(); fail(); }
    return scope.run({ operation, ordinal: 0 }, () => next(args));
  }, { name: 'cloudCostProducer', step: 'initialize' });
  client.config.requestHandler = {
    metadata: handler.metadata,
    destroy: () => handler.destroy?.(),
    handle: async (input, options) => {
      const command = scope.getStore();
      if (!command || input.protocol !== target.protocol || input.hostname !== target.hostname || Number(input.port) !== Number(target.port)) {
        meter.invalidate(); fail();
      }
      const metadata = { token: randomUUID(), channel: 'producer', operation: command.operation, phase,
        retryOrdinal: command.ordinal++, errorCode: null, sameAccount: null };
      let bytesOut = 0, bytesIn = 0, statusCode = null, expectedIn = 0, completed = false;
      const expectedOut = Number(input.headers['content-length'] ?? 0);
      const finish = interrupted => {
        if (completed) return; completed = true;
        meter.observeAttempt({ ...metadata, outcome: interrupted ? 'transport-error'
          : statusCode >= 500 ? 'server-error' : statusCode >= 300 ? 'client-error' : 'success', statusCode,
          bytesIn, bytesOut, attemptedBytesIn: Math.max(bytesIn, expectedIn), attemptedBytesOut: Math.max(bytesOut, expectedOut) });
      };
      const headers = { ...input.headers, [correlationHeaders[0]]: metadata.token,
        [correlationHeaders[1]]: String(metadata.retryOrdinal), [correlationHeaders[2]]: phase };
      const originalBody = input.body;
      const body = originalBody == null ? undefined : Readable.from((async function* () {
        const source = typeof originalBody === 'string' || originalBody instanceof Uint8Array ? [originalBody] : originalBody;
        for await (const chunk of source) { bytesOut += Buffer.byteLength(chunk); yield chunk; }
      })());
      try {
        const result = await handler.handle({ ...input, headers, body }, options);
        const response = result.response; statusCode = response.statusCode;
        expectedIn = input.method === 'HEAD' ? 0 : Number(response.headers['content-length'] ?? 0);
        if (input.method === 'HEAD' || !response.body) { response.body?.resume?.(); finish(false); }
        else {
          const source = response.body;
          response.body = Readable.from((async function* () {
            let ended = false;
            try {
              for await (const chunk of source) { bytesIn += Buffer.byteLength(chunk); yield chunk; }
              ended = true;
            } finally { finish(!ended); }
          })());
          response.body.once('close', () => { if (!completed) { source.destroy(); finish(true); } });
        }
        return result;
      } catch (error) {
        body?.destroy(); finish(true);
        // Retry classification survives, while provider paths and messages stay private.
        const failure = new Error('Invalid cloud cost meter');
        if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(error.code)) failure.code = error.code;
        if (['TimeoutError', 'AbortError'].includes(error.name)) failure.name = error.name;
        throw failure;
      }
    },
  };
  storageBindings.set(client, { meter, phase, endpoint: target.href, handler: client.config.requestHandler });
}

export async function createMeteringProxy({ target, meter, classify, listenHost = '127.0.0.1', listenPort = 0 }) {
  let endpoint;
  try {
    endpoint = new URL(target);
    requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && endpoint.username === '' && endpoint.password === '' && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === '');
    requireThat(typeof classify === 'function' && typeof meter.observeAttempt === 'function' && typeof meter.invalidate === 'function'
      && typeof meter.beginAttempt === 'function');
    requireThat(['127.0.0.1', '0.0.0.0'].includes(listenHost) && count(listenPort) && listenPort <= 65535);
  } catch { fail(); }
  let failure = false;
  const server = createServer((incoming, outgoing) => {
    let metadata;
    try {
      metadata = classify({ method: incoming.method, path: incoming.url, copySource: Object.hasOwn(incoming.headers, 'x-amz-copy-source'), headers: incoming.headers });
      exact(metadata, ['token', 'retryOrdinal', 'phase', 'operation', 'errorCode', 'sameAccount']);
      validateAttempt({ ...metadata, channel: 'observer', outcome: 'transport-error', statusCode: null,
        bytesIn: 0, bytesOut: 0, attemptedBytesIn: 0, attemptedBytesOut: 0 });
      meter.beginAttempt(metadata.token);
    } catch { failure = true; meter.invalidate(); incoming.resume(); outgoing.writeHead(400); outgoing.end(); return; }
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
      statusCode = response.statusCode;
      // HEAD reports the object size but transfers no response body.
      expectedIn = incoming.method === 'HEAD' ? 0 : Number(response.headers['content-length'] ?? 0);
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
  server.listen(listenPort, listenHost); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (failure) fail();
  } };
}
