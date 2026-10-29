import { createMeter, createMeteringProxy, instrumentStorageClient, correlatedStorageAttempt, classifyStorageOperation } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';
import { openLitestreamHistories } from './storage-lifetimes.mjs';
import { openLitestreamVersionHistories } from './stream-versions.mjs';

const fail = () => { throw Error('Invalid cloud cost stream measurement'); };
const need = value => { if (!value) fail(); };
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'cleanup'];

// The caller owns an empty local bucket and stops its writer before finishing.
// This session owns only its listeners/client; inventories never delete stored data.
export async function openStreamMeasurement({ target, sdk, bucket, versioned, clock,
  allowBulkDeletes = false, allowMultipart = false, resolveMultipartReplies = false, signal, onDiagnostic }) {
  let admin, observer, front, client, history, meter, disposal, finishing, evidence;
  let invalid = false, state = 'opening', phase = 'startup', phaseStart, last = -Infinity;
  let nativeCompleted = 0, nativeUploaded = false;
  const activityWaiters = new Set();
  const windows = [];
  const now = () => {
    const value = clock(); need(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value >= last);
    last = value; return value;
  };
  const poison = () => { invalid = true; meter?.invalidate(); fail(); };
  const dispose = () => disposal ??= (async () => {
    for (const waiter of activityWaiters) waiter.reject(Error('Invalid cloud cost stream measurement'));
    activityWaiters.clear();
    const failures = [];
    const attempt = async fn => { try { await fn(); } catch { failures.push(true); } };
    await attempt(() => front?.close());
    await attempt(() => client?.destroy());
    await attempt(() => observer?.close());
    await attempt(() => admin?.close());
    signal?.removeEventListener('abort', abort);
    state = 'closed';
    if (failures.length) { invalid = true; fail(); }
  })();
  const abort = () => { invalid = true; meter?.invalidate(); dispose().catch(() => {}); };
  const switchPhase = next => {
    try {
      need(!invalid && state === 'active' && phases.includes(next));
      front.setPhase(next);
      const time = now(); windows.push({ phase, elapsedSeconds: time - phaseStart });
      phase = next; phaseStart = time;
    } catch { poison(); }
  };
  try {
    const endpoint = new URL(target);
    need(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password);
    need(typeof versioned === 'boolean' && typeof clock === 'function'
      && typeof bucket === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket));
    need(typeof allowBulkDeletes === 'boolean' && typeof allowMultipart === 'boolean'
      && typeof resolveMultipartReplies === 'boolean' && (!resolveMultipartReplies || allowMultipart));
    need(signal === undefined || signal instanceof AbortSignal); need(!signal?.aborted);
    need(typeof sdk?.S3Client === 'function');
    phaseStart = now();
    meter = createMeter({ phase: 'observer', clock: now });
    admin = await createMeteringProxy({ target, meter, classify: correlatedStorageAttempt });
    client = new sdk.S3Client({ endpoint: admin.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter, phase: 'observer', endpoint: admin.url });
    history = await (versioned ? openLitestreamVersionHistories : openLitestreamHistories)({
      client, sdk, meter, bucket, clock: now, allowBulkDeletes, allowMultipart, resolveMultipartReplies,
    });
    need(!signal?.aborted);
    observer = await createMeteringProxy({ target, meter, classify: input => {
      // Independently derive retry identity at the physical hop, without recording headers.
      const invocation = input.headers['amz-sdk-invocation-id'];
      const match = /^attempt=([1-9]\d*); max=([1-9]\d*)$/.exec(input.headers['amz-sdk-request']);
      need(typeof invocation === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(invocation)
        && match && Number.isSafeInteger(Number(match[2])) && Number(match[1]) <= Number(match[2]));
      return { token: invocation + ':' + match[1], retryOrdinal: Number(match[1]) - 1, phase,
        operation: classifyStorageOperation({ ...input, allowBulkDeletes }), errorCode: null, sameAccount: null };
    } });
    front = await createLitestreamTransport({ target: observer.url, meter, phase, allowBulkDeletes,
      lifetimes: { begin: input => {
        need(state === 'active'); const complete = history.begin(input);
        const upload = classifyStorageOperation({ ...input, allowBulkDeletes }) === 'put';
        return event => {
          complete(event); need(!event.interrupted); nativeCompleted++;
          const uploaded = upload && event.statusCode >= 200 && event.statusCode < 300;
          if (uploaded) nativeUploaded = true;
          for (const waiter of activityWaiters) if (nativeCompleted > waiter.after && (!waiter.upload || uploaded)) {
            activityWaiters.delete(waiter); waiter.resolve(nativeCompleted);
          }
        };
      } } });
    need(!signal?.aborted); state = 'active';
    signal?.addEventListener('abort', abort, { once: true });
  } catch {
    invalid = true;
    await dispose().catch(() => {}); fail();
  }
  return {
    url: front.url,
    activity: () => { need(!invalid && state === 'active'); return nativeCompleted; },
    waitForActivity: async after => {
      need(!invalid && state === 'active' && !signal?.aborted && Number.isSafeInteger(after) && after >= 0 && after <= nativeCompleted);
      if (nativeCompleted > after) return nativeCompleted;
      return new Promise((resolve, reject) => activityWaiters.add({ after, resolve, reject }));
    },
    waitForUpload: async () => {
      need(!invalid && state === 'active' && !signal?.aborted);
      if (nativeUploaded) return;
      return new Promise((resolve, reject) => activityWaiters.add({ after: 0, upload: true, resolve, reject }));
    },
    whenIdle: async action => {
      need(!invalid && state === 'active' && !signal?.aborted);
      return front.whenIdle(action);
    },
    changePhase: async next => {
      try {
        need(!invalid && state === 'active' && !signal?.aborted && phases.includes(next));
        await front.whenIdle(() => switchPhase(next));
      } catch { invalid = true; await dispose().catch(() => {}); fail(); }
    },
    checkpoint: async () => {
      let stage = 'checkpoint-admission';
      try {
        need(!invalid && state === 'active' && !signal?.aborted);
        // A quiescent producer is required; a racing request poisons both counters.
        front.setPhase(phase); state = 'checking';
        stage = 'checkpoint-inventory'; await history.verify();
        stage = 'checkpoint-accounting';
        need(!invalid && !signal?.aborted);
        const storage = history.snapshot(), requests = meter.snapshot();
        need(requests.reconciled === true && requests.status === 'measured');
        state = 'active'; return { requests, storage };
      } catch {
        // Fixed operation codes preserve the first refusal without publishing private storage errors.
        try { Promise.resolve(onDiagnostic?.({ kind: 'measurement-refusal', stage })).catch(() => {}); } catch { /* Reporting cannot prevent resource collection. */ }
        invalid = true; await dispose().catch(() => {}); fail();
      }
    },
    setPhase: switchPhase,
    finish: async () => {
      if (evidence && !invalid) return structuredClone(evidence);
      if (!finishing) finishing = (async () => {
        let result;
        try {
          need(!invalid && state === 'active' && !signal?.aborted); state = 'finishing';
          // No further mutation may enter while the independent inventory is read.
          await front.close(); await history.verify();
          need(!invalid && !signal?.aborted);
          // Cleanup must resume at the history's clock, before later reporting or listener collection.
          const storage = history.snapshot(), storageEndedAt = last, requests = meter.snapshot(), time = now();
          need(requests.reconciled === true && requests.status === 'measured');
          result = { status: 'measured', scope: 'native-stream-session',
            phases: [...windows, { phase, elapsedSeconds: time - phaseStart }], requests, storage, storageEndedAt,
            cleanup: { listeners: 0, clients: 0 } };
        } catch { invalid = true; fail(); }
        finally { await dispose(); }
        need(!invalid); evidence = result; return result;
      })();
      try { return structuredClone(await finishing); } catch { fail(); }
    },
    close: async () => { await dispose(); },
  };
}
