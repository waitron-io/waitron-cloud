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

const exactFields = (value, keys) => requireThat(value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(key => keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key).get === undefined));
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;

export function createLitestreamAfterStop(options) {
  exactFields(options, ['clock']); const { clock } = options; requireThat(typeof clock === 'function');
  const attempts = new Map(), sequences = new Map();
  let invalid = false, lastTime = -1, sequence = 0, acknowledged = null;
  // Two controlled list admissions plus one underway upload; this is a bound, not a measured maximum.
  const cap = 3;
  const unlabelled = () => {};
  const event = (mark = unlabelled) => {
    mark('clock');
    const time = clock(); requireThat(Number.isFinite(time) && time >= 0 && time >= lastTime);
    lastTime = time; return { time, sequence: ++sequence };
  };
  const guarded = fn => (...args) => {
    try { requireThat(!invalid); return fn(...args); } catch { invalid = true; fail(); }
  };
  const rowFor = ({ invocation, ordinal, operation: name }, mark = unlabelled) => {
    mark('row-metadata');
    requireThat(nonnegative(ordinal) && operations.includes(name));
    mark('row-identity');
    const id = identity(invocation, `attempt=${ordinal + 1}; max=${ordinal + 1}`);
    let row = attempts.get(id.key);
    if (!row) {
      mark('row-cap');
      requireThat(attempts.size < 100000);
      row = { operation: name, ordinal, issued: null, admissions: {}, settlements: {}, affected: false,
        lateAdmission: false, lateSettlement: false };
      attempts.set(id.key, row);
    }
    mark('row-operation'); requireThat(row.operation === name); return row;
  };
  const next = (source, e, mark = unlabelled) => {
    const key = source + ':' + e.invocation, prior = sequences.get(key);
    mark('retry-sequence');
    requireThat(e.ordinal === (prior?.ordinal ?? -1) + 1 && (!prior || prior.operation === e.operation));
    sequences.set(key, { ordinal: e.ordinal, operation: e.operation });
  };
  const affect = (row, mark = unlabelled) => {
    row.affected = true;
    mark('affected-cap');
    requireThat([...attempts.values()].filter(row => row.affected).length <= cap);
  };
  const acknowledgeStop = guarded(input => {
    exactFields(input, ['statusCode', 'ownedPath', 'body']);
    requireThat(!acknowledged && input.statusCode === 200 && typeof input.ownedPath === 'string'
      && input.ownedPath.startsWith('/') && Buffer.isBuffer(input.body) && input.body.length <= 1024);
    const reply = JSON.parse(input.body.toString('utf8')); exactFields(reply, ['status', 'path', 'txid']);
    requireThat(reply.status === 'stopped' && reply.path === input.ownedPath && nonnegative(reply.txid));
    acknowledged = event();
  });
  const issue = guarded(input => {
    exactFields(input, ['invocation', 'ordinal', 'operation']);
    const row = rowFor(input); requireThat(!row.issued); next('issue', input); row.issued = event();
  });
  const admitGuarded = guarded((input, mark) => {
    mark('input');
    exactFields(input, ['invocation', 'ordinal', 'operation', 'hop', 'phase']);
    mark('hop-phase');
    requireThat(['producer', 'observer'].includes(input.hop) && phases.includes(input.phase));
    const row = rowFor(input, mark); mark('duplicate-hop'); requireThat(!row.admissions[input.hop]);
    next(input.hop, input, mark);
    mark('observer-pairing');
    if (input.hop === 'observer') requireThat(row.admissions.producer && row.admissions.producer.phase === input.phase);
    if (acknowledged) {
      mark('post-stop-operation', row); requireThat(input.operation === 'list');
      mark('post-stop-ordinal'); requireThat(input.ordinal === 0);
    }
    row.admissions[input.hop] = { ...event(mark), phase: input.phase };
    if (acknowledged && input.hop === 'observer') { row.lateAdmission = true; affect(row, mark); }
  });
  let firstAdmissionFailure;
  const admit = input => {
    let guard = 'state', context;
    try { return admitGuarded(input, (name, row) => {
      guard = name;
      if (row) context = { operation: row.operation, attemptClass: row.ordinal === 0 ? 'initial' : 'retry' };
    }); }
    catch (error) {
      // Poisoned follow-up calls retain the first admission refusal without exposing request metadata.
      const failure = firstAdmissionFailure ??= { guard, ...context };
      error.litestreamAfterStopAdmissionGuard = failure.guard;
      if (failure.operation !== undefined) {
        error.litestreamAfterStopAdmissionOperation = failure.operation;
        error.litestreamAfterStopAdmissionAttemptClass = failure.attemptClass;
      }
      throw error;
    }
  };
  const attemptForToken = token => {
    requireThat(typeof token === 'string');
    const match = /^(.+):([1-9]\d*)$/.exec(token); requireThat(match);
    identity(match[1], `attempt=${match[2]}; max=${match[2]}`);
    const row = attempts.get(token); requireThat(row); return row;
  };
  // Only the real storage response supplies this witness; finishing a request body is not a commit.
  const commit = guarded(input => {
    exactFields(input, ['token', 'statusCode', 'bytesOut', 'expectedBytesOut', 'requestComplete', 'versionId', 'deleteMarker']);
    const row = attemptForToken(input.token);
    requireThat(row.operation === 'put' && !row.commit && row.admissions.producer && row.admissions.observer
      && (!acknowledged || Object.values(row.admissions).every(a => a.sequence < acknowledged.sequence))
      && (input.deleteMarker === null || input.deleteMarker === 'false')
      && input.requestComplete === true && nonnegative(input.bytesOut) && input.bytesOut === input.expectedBytesOut
      && Number.isInteger(input.statusCode) && input.statusCode >= 200 && input.statusCode < 300
      && (input.versionId === null || typeof input.versionId === 'string' && input.versionId.length > 0
        && input.versionId.length <= 1024 && !/[\x00-\x1f\x7f]/.test(input.versionId)));
    row.commit = { ...structuredClone(input), ...event() };
  });
  const beginLifetime = guarded(input => {
    exactFields(input, ['headers', 'operation', 'versioned']);
    requireThat(typeof input.versioned === 'boolean');
    const id = identity(input.headers?.['amz-sdk-invocation-id'], input.headers?.['amz-sdk-request']);
    const row = attempts.get(id.key);
    requireThat(row && row.operation === input.operation && row.admissions.producer && !row.lifetime);
    row.lifetime = { versioned: input.versioned, completed: false };
    return guarded(({ statusCode, bytesOut, interrupted, responseHeaders }) => {
      const producer = row.settlements.producer;
      requireThat(!row.lifetime.completed && producer && producer.statusCode === statusCode && producer.bytesOut === bytesOut
        && interrupted === (producer.outcome === 'transport-error'));
      row.lifetime.completed = true;
      if (row.latePut) {
        requireThat(row.commit && bytesOut === row.commit.bytesOut);
        const version = row.commit.versionId;
        requireThat(row.lifetime.versioned ? typeof version === 'string' && version !== 'null' : version === null || version === 'null');
        requireThat(responseHeaders?.['x-amz-delete-marker'] === undefined || responseHeaders['x-amz-delete-marker'] === 'false');
        requireThat(responseHeaders?.['x-amz-version-id'] === undefined || responseHeaders['x-amz-version-id'] === version);
        // Normalize storage history only. Both HTTP counters retain the actual client outcome and bytes.
        return { statusCode: row.commit.statusCode, responseHeaders: version === null ? {} : { 'x-amz-version-id': version } };
      }
      requireThat(!interrupted || row.operation === 'list' && row.lateSettlement);
      return { statusCode, responseHeaders };
    });
  });
  const settle = guarded((input, interruption = null) => {
    exactFields(input, ['token', 'channel', 'phase', 'operation', 'retryOrdinal', 'outcome', 'statusCode', 'errorCode', 'sameAccount',
      'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut']);
    requireThat(typeof input.token === 'string');
    const match = /^(.+):([1-9]\d*)$/.exec(input.token); requireThat(match);
    const row = rowFor({ invocation: match[1], ordinal: Number(match[2]) - 1, operation: input.operation });
    const hop = input.channel, admission = row.admissions[hop];
    requireThat(admission && !row.settlements[hop] && input.phase === admission.phase && input.retryOrdinal === row.ordinal);
    requireThat(['producer', 'observer'].includes(hop) && ['success', 'client-error', 'server-error', 'transport-error'].includes(input.outcome));
    requireThat(['bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'].every(key => nonnegative(input[key]))
      && input.bytesIn <= input.attemptedBytesIn && input.bytesOut <= input.attemptedBytesOut);
    requireThat(input.statusCode === null || Number.isInteger(input.statusCode) && input.statusCode >= 200 && input.statusCode <= 599);
    requireThat(input.outcome === 'transport-error' || input.outcome === 'success' && input.statusCode >= 200 && input.statusCode < 300
      || input.outcome === 'client-error' && input.statusCode >= 300 && input.statusCode < 500
      || input.outcome === 'server-error' && input.statusCode >= 500);
    requireThat(input.errorCode === null || ['AccessDenied', 'PreconditionFailed', 'NoSuchKey', 'SignatureDoesNotMatch',
      'ExpiredToken', 'AuthorizationHeaderMalformed', 'InvalidRange', 'unknown'].includes(input.errorCode));
    requireThat([true, false, null].includes(input.sameAccount));
    const interrupted = input.outcome === 'transport-error';
    if (interrupted) {
      exactFields(interruption, ['reason', 'ioEvent', 'code', 'clientClosed', 'responseHeadersSeen']);
      requireThat(acknowledged && hop === 'producer' && ['list', 'put'].includes(row.operation) && row.admissions.observer
        && interruption.reason === 'transfer-interrupted' && interruption.ioEvent === 'response-pipeline'
        && interruption.code === 'ERR_STREAM_UNABLE_TO_PIPE' && interruption.clientClosed === true
        && interruption.responseHeadersSeen === true && input.statusCode >= 200 && input.statusCode < 300);
      row.lateSettlement = true; affect(row);
    } else requireThat(interruption === null);
    if (acknowledged && input.operation !== 'list') {
      requireThat(input.operation === 'put' && row.ordinal === 0 && row.commit
        && Object.values(row.admissions).length === 2
        && Object.values(row.admissions).every(a => a.sequence < acknowledged.sequence)
        && input.bytesOut === row.commit.bytesOut && input.attemptedBytesOut === row.commit.expectedBytesOut
        && input.statusCode === row.commit.statusCode && (interrupted || input.outcome === 'success'));
      requireThat(![...attempts.values()].some(other => other !== row && other.latePut));
      row.latePut = true; row.lateSettlement = true; affect(row);
    }
    row.settlements[hop] = { ...structuredClone(input), ...event() };
    return interrupted;
  });
  const snapshot = guarded(() => {
    event();
    for (const row of attempts.values()) requireThat(row.issued && row.admissions.producer && row.admissions.observer
      && row.settlements.producer && row.settlements.observer);
    const selected = [...attempts.values()].filter(row => row.affected);
    const incompleteList = selected.some(row => row.operation === 'list' && row.lateSettlement);
    const incompletePut = selected.some(row => row.latePut && Object.values(row.settlements).some(s => s.outcome === 'transport-error'));
    const total = () => ({ attempts: 0, bytesIn: 0, bytesOut: 0 });
    const producer = total(), observer = total(), requests = new Map(); let bodiesReconciled = true;
    for (const row of selected) {
      const p = row.settlements.producer, o = row.settlements.observer;
      bodiesReconciled &&= p.outcome !== 'transport-error' && o.outcome !== 'transport-error' && ['outcome', 'statusCode', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'].every(key => p[key] === o[key]);
      for (const [hop, sum] of [['producer', producer], ['observer', observer]]) {
        const e = row.settlements[hop]; sum.attempts++; sum.bytesIn += e.bytesIn; sum.bytesOut += e.bytesOut;
        const key = [hop, e.phase, e.operation, e.retryOrdinal, e.outcome].join(':');
        if (!requests.has(key)) requests.set(key, { hop, phase: e.phase, operation: e.operation, retryOrdinal: e.retryOrdinal,
          outcome: e.outcome, attempts: 0, bytesIn: 0, bytesOut: 0, attemptedBytesIn: 0, attemptedBytesOut: 0 });
        const r = requests.get(key); r.attempts++;
        for (const k of ['bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut']) r[k] += e[k];
      }
    }
    requireThat([producer, observer].every(sum => Object.values(sum).every(nonnegative))
      && [...requests.values()].every(row => ['attempts', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'].every(key => nonnegative(row[key]))));
    return { cap, used: selected.length, lateAdmissions: selected.filter(r => r.lateAdmission).length,
      lateSettlements: selected.filter(r => r.lateSettlement).length, requests: [...requests.values()], producer, observer,
      requestsReconciled: true, bodiesReconciled, status: bodiesReconciled ? 'measured' : 'unknown',
      gaps: [...(incompleteList ? ['after-stop:list-response-interrupted'] : []),
        ...(incompletePut ? ['after-stop:put-response-interrupted'] : []),
        ...(!bodiesReconciled ? ['after-stop:body-bytes-unpaired'] : [])] };
  });
  return { acknowledgeStop, issue, admit, commit, beginLifetime, settle, snapshot, invalidate: () => { invalid = true; } };
}

// Smoke accounting is a separate, bounded subset; it never upgrades the measured-cost schema.
export function litestreamAfterStopOutput(input) {
  exactFields(input, ['cap', 'used', 'lateAdmissions', 'lateSettlements', 'requests', 'producer', 'observer',
    'requestsReconciled', 'bodiesReconciled', 'status', 'gaps']);
  requireThat(input.cap === 3 && nonnegative(input.used) && input.used <= 3
    && ['lateAdmissions', 'lateSettlements'].every(k => nonnegative(input[k]) && input[k] <= input.used)
    && input.used <= input.lateAdmissions + input.lateSettlements && input.requestsReconciled === true
    && typeof input.bodiesReconciled === 'boolean' && input.status === (input.bodiesReconciled ? 'measured' : 'unknown')
    && Array.isArray(input.requests) && input.requests.length <= 6 && Array.isArray(input.gaps));
  const totals = { producer: { attempts: 0, bytesIn: 0, bytesOut: 0 }, observer: { attempts: 0, bytesIn: 0, bytesOut: 0 } };
  const keys = new Set(); let listInterrupted = false, putInterrupted = false, putAttempts = 0, interruptedLists = 0, listAttempts = 0;
  for (const r of input.requests) {
    exactFields(r, ['hop', 'phase', 'operation', 'retryOrdinal', 'outcome', 'attempts', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut']);
    requireThat(['producer', 'observer'].includes(r.hop) && phases.includes(r.phase) && ['list', 'put'].includes(r.operation)
      && r.retryOrdinal === 0 && ['success', 'transport-error'].includes(r.outcome)
      && ['attempts', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'].every(k => nonnegative(r[k]))
      && r.attempts > 0 && r.bytesIn <= r.attemptedBytesIn && r.bytesOut <= r.attemptedBytesOut
      && (r.outcome !== 'transport-error' || r.hop === 'producer'));
    const key = [r.hop, r.phase, r.operation, r.retryOrdinal, r.outcome].join(':');
    requireThat(!keys.has(key)); keys.add(key);
    for (const k of ['attempts', 'bytesIn', 'bytesOut']) totals[r.hop][k] += r[k];
    if (r.hop === 'producer' && r.operation === 'put') putAttempts += r.attempts;
    if (r.hop === 'producer' && r.operation === 'list') {
      listAttempts += r.attempts;
      if (r.outcome === 'transport-error') interruptedLists += r.attempts;
    }
    listInterrupted ||= r.operation === 'list' && r.outcome === 'transport-error';
    putInterrupted ||= r.operation === 'put' && r.outcome === 'transport-error';
  }
  requireThat(putAttempts <= 1 && input.lateAdmissions <= listAttempts
    && input.lateSettlements === putAttempts + interruptedLists
    && (input.used > 0 || input.bodiesReconciled));
  for (const r of input.requests.filter(r => r.hop === 'producer')) {
    const paired = input.requests.filter(o => o.hop === 'observer' && o.phase === r.phase && o.operation === r.operation)
      .reduce((n, o) => n + o.attempts, 0);
    const issued = input.requests.filter(o => o.hop === 'producer' && o.phase === r.phase && o.operation === r.operation)
      .reduce((n, o) => n + o.attempts, 0);
    requireThat(paired === issued);
  }
  for (const hop of ['producer', 'observer']) {
    exactFields(input[hop], ['attempts', 'bytesIn', 'bytesOut']);
    requireThat(Object.keys(totals[hop]).every(k => nonnegative(totals[hop][k]) && input[hop][k] === totals[hop][k])
      && input[hop].attempts === input.used);
  }
  const expectedGaps = [...(listInterrupted ? ['after-stop:list-response-interrupted'] : []),
    ...(putInterrupted ? ['after-stop:put-response-interrupted'] : []),
    ...(!input.bodiesReconciled ? ['after-stop:body-bytes-unpaired'] : [])];
  requireThat(new Set(input.gaps).size === input.gaps.length && input.gaps.length === expectedGaps.length
    && input.gaps.every(g => expectedGaps.includes(g)));
  if (input.bodiesReconciled) {
    requireThat(!listInterrupted && !putInterrupted);
    for (const r of input.requests.filter(r => r.hop === 'producer')) {
      const observer = input.requests.find(o => o.hop === 'observer' && o.phase === r.phase && o.operation === r.operation && o.outcome === r.outcome);
      requireThat(observer && ['attempts', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'].every(k => observer[k] === r[k]));
    }
  }
  const afterStop = structuredClone(input);
  return { afterStop, ...(afterStop.used ? { costAccuracy: { status: 'incomplete', reason: 'after-stop',
    message: 'Cost may be a few requests short after stop.' } } : {}) };
}

export function createLitestreamRequestAudit({ phase, allowBulkDeletes = false, afterStop }) {
  requireThat(phases.includes(phase));
  const decoder = new StringDecoder('utf8'), producer = new Map(), observer = new Map(), sequences = new Map();
  let buffer = '', current = null, ended = false, invalid = false, validationStage, failure;
  const guarded = (stage, fn) => (...args) => {
    validationStage = stage;
    try { requireThat(!invalid); return fn(...args); }
    catch (error) {
      if (!failure) {
        failure = { stage: validationStage };
        if (validationStage === 'after-stop-admission') {
          Object.assign(failure, admissionDiagnostic(error));
        }
      }
      invalid = true; afterStop?.invalidate(); fail();
    }
  };
  const line = text => {
    if (/^SDK .* DEBUG Request$/.test(text)) { validationStage = 'request-start'; requireThat(!current); current = { operation: null, invocation: null, attempt: null, size: 0 }; return; }
    if (!current) return;
    validationStage = 'request-size'; current.size += text.length; requireThat(current.size <= 65536);
    if (current.operation === null) { validationStage = 'request-operation'; current.operation = operation(text, allowBulkDeletes); return; }
    if (text === '') {
      validationStage = 'request-identity';
      const id = identity(current.invocation, current.attempt);
      requireThat(!producer.has(id.key) && id.ordinal === (sequences.get(id.invocation) ?? -1) + 1 && producer.size < 100000);
      validationStage = 'after-stop-issue';
      afterStop?.issue({ invocation: id.invocation, ordinal: id.ordinal, operation: current.operation });
      producer.set(id.key, { operation: current.operation, ordinal: id.ordinal }); sequences.set(id.invocation, id.ordinal);
      current = null; return;
    }
    validationStage = 'request-header';
    const header = /^([^: ]+): (.*)$/.exec(text); requireThat(header);
    const name = header[1].toLowerCase();
    if (name === 'amz-sdk-invocation-id') { requireThat(current.invocation === null); current.invocation = header[2]; }
    if (name === 'amz-sdk-request') { requireThat(current.attempt === null); current.attempt = header[2]; }
  };
  const write = guarded('write', chunk => {
    requireThat(!ended && Buffer.isBuffer(chunk) && chunk.length <= 1048576);
    buffer += decoder.write(chunk);
    let offset;
    while ((offset = buffer.indexOf('\n')) !== -1) {
      validationStage = 'line-size'; requireThat(offset <= 65536); const text = buffer.slice(0, offset).replace(/\r$/, ''); buffer = buffer.slice(offset + 1); line(text);
    }
    validationStage = 'buffer-size'; requireThat(buffer.length <= 65536);
  });
  const observe = guarded('observe', ({ headers, operation: name }) => {
    requireThat(!ended && operations.includes(name) && (name !== 'delete-many' || allowBulkDeletes === true));
    const id = identity(headers?.['amz-sdk-invocation-id'], headers?.['amz-sdk-request']);
    requireThat(!observer.has(id.key) && observer.size < 100000);
    validationStage = 'after-stop-admission';
    afterStop?.admit({ invocation: id.invocation, ordinal: id.ordinal, operation: name, hop: 'observer', phase });
    observer.set(id.key, { operation: name, ordinal: id.ordinal });
    return { token: id.key, phase, retryOrdinal: id.ordinal, operation: name, errorCode: null, sameAccount: null };
  });
  const end = guarded('end', () => {
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
  // A refused audit cannot publish a snapshot; these counts identify its first failed boundary without SDK text.
  const checkpoint = () => ({ invalid, ended, producerAttempts: producer.size, observerAttempts: observer.size,
    ...(failure ? { failure: { ...failure } } : {}) });
  return { write, observe, end, snapshot, checkpoint };
}

const closeStages = new Set(['replication-transport', 'restore-transport', 'cleanup-replication-transport',
  'cleanup-restore-transport', 'cleanup-replication-proxy', 'cleanup-restore-proxy', 'cleanup-admin-proxy']);
const closeReasons = new Set(['request-validation', 'lifetime-completion', 'body-accounting', 'transfer-interrupted',
  'upstream-error', 'upstream-response-interrupted', 'client-error', 'phase-change', 'active-close']);
const networkErrors = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_UNABLE_TO_PIPE']);
const ioEvents = new Set(['request-pipeline', 'response-aborted', 'response-error',
  'response-headers', 'response-pipeline', 'upstream-error', 'upstream-timeout', 'client-error']);
const transportOperations = new Set(operations);
const requestValidationStages = new Set(['transport-state', 'copy-source', 'identity', 'operation', 'retry-sequence',
  'after-stop-admission', 'content-length', 'mutation-body', 'lifetime-begin', 'lifetime-callback']);
const afterStopAdmissionGuards = new Set(['state', 'input', 'hop-phase', 'row-metadata', 'row-identity', 'row-cap',
  'row-operation', 'duplicate-hop', 'retry-sequence', 'observer-pairing', 'post-stop-operation', 'post-stop-ordinal',
  'clock', 'affected-cap']);
const own = (value, key) => {
  try { return value && (typeof value === 'object' || typeof value === 'function')
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined; }
  catch { return undefined; }
};

const admissionAttemptClasses = new Set(['initial', 'retry']);
function admissionDiagnostic(error) {
  const guard = own(error, 'litestreamAfterStopAdmissionGuard');
  if (!afterStopAdmissionGuards.has(guard)) return {};
  const result = { afterStopAdmissionGuard: guard };
  const operation = own(error, 'litestreamAfterStopAdmissionOperation');
  const attemptClass = own(error, 'litestreamAfterStopAdmissionAttemptClass');
  if (transportOperations.has(operation)) result.afterStopAdmissionOperation = operation;
  if (admissionAttemptClasses.has(attemptClass)) result.afterStopAdmissionAttemptClass = attemptClass;
  return result;
}

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
    const validationStage = own(raw, 'validationStage');
    if (reason === 'request-validation' && requestValidationStages.has(validationStage)) diagnostic.validationStage = validationStage;
    const admissionGuard = own(raw, 'afterStopAdmissionGuard');
    if (diagnostic.validationStage === 'after-stop-admission' && afterStopAdmissionGuards.has(admissionGuard)) {
      diagnostic.afterStopAdmissionGuard = admissionGuard;
      const operation = own(raw, 'afterStopAdmissionOperation');
      const attemptClass = own(raw, 'afterStopAdmissionAttemptClass');
      if (transportOperations.has(operation)) diagnostic.afterStopAdmissionOperation = operation;
      if (admissionAttemptClasses.has(attemptClass)) diagnostic.afterStopAdmissionAttemptClass = attemptClass;
    }
    for (const key of ['pending', 'completed', 'connections', 'idleActionsAtAdmission', 'forwardingTransfers',
      'bytesIn', 'expectedIn', 'bytesOut', 'expectedOut']) {
      const value = own(raw, key);
      if (Number.isSafeInteger(value) && value >= 0) diagnostic[key] = value;
    }
    const statusCode = own(raw, 'statusCode');
    if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) diagnostic.statusCode = statusCode;
    for (const key of ['clientClosed', 'responseHeadersSeen', 'requestComplete', 'responseComplete', 'requestSent', 'responseReceived']) {
      const value = own(raw, key); if (typeof value === 'boolean') diagnostic[key] = value;
    }
    const code = own(raw, 'code'); if (networkErrors.has(code)) diagnostic.code = code;
    const ioEvent = own(raw, 'ioEvent'); if (ioEvents.has(ioEvent)) diagnostic.ioEvent = ioEvent;
    const operation = own(raw, 'operation'); if (transportOperations.has(operation)) diagnostic.operation = operation;
    const rawAttempt = own(raw, 'attempt'), producerAttempt = own(rawAttempt, 'producerAttempt'),
      retryOrdinal = own(rawAttempt, 'retryOrdinal'), phase = own(rawAttempt, 'phase');
    const attempt = Number.isSafeInteger(producerAttempt) && producerAttempt > 0
      && Number.isSafeInteger(retryOrdinal) && retryOrdinal >= 0 && phases.includes(phase)
      ? { producerAttempt, retryOrdinal, phase } : undefined;
    emit({ ...record, status: 'rejected', error: closeReasons.has(reason) ? 'transport-refused' : 'unclassified',
      ...(attempt ? { attempt } : {}),
      ...(Object.keys(diagnostic).length ? { diagnostic } : {}) });
    throw error;
  }
}

// This first-hop counter shares no byte events with the downstream storage observer.
// It measures transferred HTTP bodies, not application consumption or TCP/TLS overhead.
export async function createLitestreamTransport({ target, meter, phase, lifetimes, allowBulkDeletes = false, afterStop }) {
  let endpoint;
  try {
    endpoint = new URL(target);
    requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === '' && endpoint.username === '' && endpoint.password === '');
    requireThat(phases.includes(phase) && typeof meter?.observeAttempt === 'function' && typeof meter?.invalidate === 'function');
    requireThat(lifetimes === undefined || typeof lifetimes?.begin === 'function' && lifetimes.afterStop === afterStop);
    requireThat(meter.afterStop === afterStop);
  } catch { fail(); }
  let invalid = false, closing, refusal, currentPhase = phase;
  const invocations = new Map(), pending = new Set(), connections = new Set();
  const transfers = new Map();
  const socketTransfers = new WeakMap();
  const idleWaiters = new Set();
  let completed = 0, idleActionsStarted = 0, admitted = 0;
  const runIdleAction = action => { idleActionsStarted++; return action(); };
  const remember = (reason, error, ioEvent, operation, context) => {
    refusal ??= { reason, ...(ioEvent ? { ioEvent, operation, ...context } : {}) };
    if (refusal.reason === reason && !refusal.code && networkErrors.has(own(error, 'code'))) refusal.code = own(error, 'code');
  };
  const poison = (reason, error, ioEvent) => { remember(reason, error, ioEvent); invalid = true; meter.invalidate(); };
  const size = value => {
    requireThat(value === undefined || typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));
    const n = Number(value ?? 0); requireThat(Number.isSafeInteger(n)); return n;
  };
  const server = createServer(async (source, destination) => {
    const idleActionsAtAdmission = idleActionsStarted, requestPhase = currentPhase;
    let id, name, expectedOut, completeLifetime, body, producerAttempt;
    let validationStage = 'transport-state';
    try {
      requireThat(!invalid && !closing);
      validationStage = 'copy-source';
      requireThat(!Object.hasOwn(source.headers, 'x-amz-copy-source'));
      validationStage = 'identity';
      id = identity(source.headers['amz-sdk-invocation-id'], source.headers['amz-sdk-request']);
      validationStage = 'operation';
      name = operation(`${source.method} ${source.url} HTTP/1.1`, allowBulkDeletes);
      validationStage = 'retry-sequence';
      const previous = invocations.get(id.invocation);
      requireThat(id.ordinal === (previous?.ordinal ?? -1) + 1 && (!previous || previous.name === name && previous.path === source.url)
        && invocations.size < 100000);
      validationStage = 'after-stop-admission';
      afterStop?.admit({ invocation: id.invocation, ordinal: id.ordinal, operation: name, hop: 'producer', phase: requestPhase });
      validationStage = 'content-length';
      expectedOut = size(source.headers['content-length']);
      invocations.set(id.invocation, { ordinal: id.ordinal, name, path: source.url });
      pending.add(id.key); producerAttempt = ++admitted;
      if (name === 'delete-many' || name === 'multipart-complete' && lifetimes) {
        validationStage = 'mutation-body';
        requireThat(expectedOut > 0 && expectedOut <= 1048576);
        // Validate bounded mutation controls before forwarding them to the backend.
        const chunks = []; let length = 0;
        for await (const chunk of source) { length += chunk.length; requireThat(length <= expectedOut); chunks.push(chunk); }
        requireThat(!closing && !invalid && length === expectedOut); body = Buffer.concat(chunks);
      }
      if (lifetimes) {
        validationStage = 'lifetime-begin';
        completeLifetime = lifetimes.begin({ method: source.method, path: source.url, headers: source.headers, body });
        validationStage = 'lifetime-callback';
        requireThat(typeof completeLifetime === 'function');
      }
    } catch (error) {
      poison('request-validation');
      // Later requests rejected by the poisoned transport must not replace its first failing boundary.
      if (refusal.reason === 'request-validation' && !refusal.validationStage) {
        refusal.validationStage = validationStage;
        if (validationStage === 'after-stop-admission') {
          Object.assign(refusal, admissionDiagnostic(error));
        }
      }
      if (id) pending.delete(id.key); source.resume(); destination.writeHead(400); destination.end(); return;
    }
    let bytesOut = 0, bytesIn = 0, expectedIn = 0, statusCode = null, responseHeaders, upstreamResponse, sent = false, received = false, settled = false;
    const admittedAt = performance.now();
    transfers.set(id.key, () => ({ operation: name, phase: requestPhase, retryOrdinal: id.ordinal,
      elapsedMs: Math.max(0, Math.round(performance.now() - admittedAt)), bytesOut, expectedOut, bytesIn, expectedIn,
      requestSent: sent, responseReceived: received, statusCode, clientClosed: destination.destroyed }));
    // Record the first failure's ordering; an idle callback does not freeze a separate writer process.
    const rememberTransfer = (reason, error, ioEvent) => remember(reason, error, ioEvent, name, {
      attempt: { producerAttempt, retryOrdinal: id.ordinal, phase: requestPhase }, idleActionsAtAdmission,
      clientClosed: destination.destroyed, responseHeadersSeen: statusCode !== null,
      ...(ioEvent === 'response-aborted' ? { bytesIn, expectedIn, bytesOut, expectedOut, statusCode,
        requestComplete: source.complete, responseComplete: upstreamResponse?.complete ?? false,
        requestSent: sent, responseReceived: received } : {}),
    });
    const clientSocket = source.socket;
    if (!socketTransfers.has(clientSocket)) socketTransfers.set(clientSocket, new Map());
    socketTransfers.get(clientSocket).set(id.key, () => ({ operation: name, idleActionsAtAdmission,
      attempt: { producerAttempt, retryOrdinal: id.ordinal, phase: requestPhase },
      clientClosed: destination.destroyed, responseHeadersSeen: statusCode !== null,
      bytesIn, expectedIn, bytesOut, expectedOut }));
    const responseChunks = lifetimes && ['delete-many', 'multipart-create', 'multipart-complete'].includes(name) ? [] : null;
    const finish = (interrupted, reason = 'transfer-interrupted', error, ioEvent) => {
      if (settled || !interrupted && (!sent || !received)) return;
      settled = true; pending.delete(id.key); completed++;
      transfers.delete(id.key);
      socketTransfers.get(clientSocket).delete(id.key);
      let completing = 'body-accounting', acceptedInterruption = false;
      try {
        const outcome = interrupted ? 'transport-error' : statusCode >= 500 ? 'server-error' : statusCode >= 300 ? 'client-error' : 'success';
        // Record observed bytes even when a later lifetime completion refuses the evidence.
        const accepted = meter.observeAttempt({ token: id.key, phase: requestPhase, operation: name, retryOrdinal: id.ordinal, channel: 'producer', outcome,
          statusCode, errorCode: null, sameAccount: null, bytesIn, bytesOut,
          attemptedBytesIn: Math.max(bytesIn, expectedIn), attemptedBytesOut: Math.max(bytesOut, expectedOut) },
        interrupted ? { reason, ioEvent, code: own(error, 'code') ?? null,
          clientClosed: destination.destroyed, responseHeadersSeen: statusCode !== null } : null);
        acceptedInterruption = afterStop !== undefined && accepted === true;
        completing = 'lifetime-completion';
        completeLifetime?.({ statusCode, bytesOut, interrupted, responseHeaders,
          responseBody: responseChunks ? Buffer.concat(responseChunks) : undefined });
      } catch {
        if (interrupted) rememberTransfer(reason, error, ioEvent);
        poison(completing);
      }
      if (interrupted && !acceptedInterruption) { rememberTransfer(reason, error, ioEvent); poison(reason, error); }
      if (pending.size === 0) for (const waiter of idleWaiters) {
        idleWaiters.delete(waiter);
        try { requireThat(!invalid && !closing); waiter.resolve(runIdleAction(waiter.action)); }
        catch { waiter.reject(Error('Invalid cloud cost Litestream audit')); }
      }
    };
    const upstream = request(endpoint, { method: source.method, path: source.url, headers: source.headers }, response => {
      upstreamResponse = response;
      response.once('aborted', () => rememberTransfer('upstream-response-interrupted', undefined, 'response-aborted'));
      response.on('error', error => rememberTransfer('upstream-response-interrupted', error, 'response-error'));
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
  server.on('clientError', (error, socket) => {
    const active = socketTransfers.get(socket);
    // Parser errors can belong to the next message; only network errors can name a sole forwarding request.
    const { operation, ...context } = networkErrors.has(own(error, 'code')) && active?.size === 1 ? active.values().next().value() : {};
    remember('client-error', error, 'client-error', operation, { forwardingTransfers: active?.size ?? 0, ...context });
    poison('client-error', error, 'client-error'); socket.destroy();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, pendingTransfers: () => [...transfers.values()].map(snapshot => snapshot()), checkpoint: () => ({ ...refusal, pending: pending.size, completed,
    connections: connections.size, ...(meter.checkpoint ? { accounting: meter.checkpoint() } : {}) }), whenIdle: async action => {
    requireThat(!invalid && !closing && typeof action === 'function');
    if (pending.size === 0) return runIdleAction(action);
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
