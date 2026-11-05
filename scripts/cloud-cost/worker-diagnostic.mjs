import { isProxy } from 'node:util/types';

const nativeSignals = ['SIGTERM', 'SIGKILL', 'SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGPIPE', 'SIGINT', 'other'];
export const nativeFailureSignal = signal => signal === null || nativeSignals.includes(signal) ? signal : 'other';

const transportReasons = ['request-validation', 'lifetime-completion', 'body-accounting', 'transfer-interrupted',
  'upstream-error', 'upstream-response-interrupted', 'client-error', 'phase-change', 'active-close', 'unknown'];
const transportValidationStages = ['transport-state', 'copy-source', 'identity', 'operation', 'retry-sequence',
  'after-stop-admission', 'content-length', 'mutation-body', 'lifetime-begin', 'lifetime-callback', 'unknown'];
const transportDetails = {
  code: value => ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_UNABLE_TO_PIPE'].includes(value),
  ioEvent: value => ['request-pipeline', 'response-aborted', 'response-error', 'response-headers', 'response-pipeline',
    'upstream-error', 'upstream-timeout', 'client-error'].includes(value),
  operation: value => ['put', 'get', 'head', 'list', 'delete', 'delete-many',
    'multipart-create', 'multipart-upload', 'multipart-complete', 'multipart-abort'].includes(value),
  idleActionsAtAdmission: value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000,
  forwardingTransfers: value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000,
  clientClosed: value => typeof value === 'boolean',
  responseHeadersSeen: value => typeof value === 'boolean',
};

// Checkpoint metadata can be private; publish only fixed codes, bounded counts and boolean flags.
export function checkpointTransportDiagnostic(snapshot) {
  const reason = transportReasons.includes(snapshot.reason) ? snapshot.reason : 'unknown';
  const details = {};
  for (const [key, valid] of Object.entries(transportDetails)) {
    const value = Object.getOwnPropertyDescriptor(snapshot, key)?.value;
    if (valid(value)) details[key] = value;
  }
  return { kind: 'checkpoint-transport', reason,
    validationStage: reason === 'request-validation'
      ? transportValidationStages.includes(snapshot.validationStage) ? snapshot.validationStage : 'unknown' : 'none',
    pending: snapshot.pending, completed: snapshot.completed, ...details };
}

// Diagnostic stages are fixed codes. Raw worker errors never cross this boundary.
export function workerFailureStage(value) {
  const fail = () => { throw Error('Invalid cloud cost worker diagnostic'); };
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => !['schemaVersion', 'stage'].includes(key)
    || Object.getOwnPropertyDescriptor(value, key).get !== undefined)) fail();
  if (value.schemaVersion !== 1 || !['configuration', 'storage-open', 'replay', 'storage-cleanup', 'result'].includes(value.stage)) fail();
  return value.stage;
}

// Only fixed stage codes and bounded numeric native outcomes may leave the private worker.
export function workerFailureTrace(value) {
  const need = value => { if (!value) throw Error('Invalid cloud cost worker diagnostic'); };
  const exact = (value, keys) => {
    need(value && Object.getPrototypeOf(value) === Object.prototype);
    const found = Reflect.ownKeys(value);
    need(found.length === keys.length && found.every(key => keys.includes(key)
      && Object.getOwnPropertyDescriptor(value, key).enumerable
      && Object.getOwnPropertyDescriptor(value, key).get === undefined));
  };
  const array = (value, limit) => {
    need(!isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
    need(value.length <= limit && Reflect.ownKeys(value).length === value.length + 1);
    // Copying omits hidden indices; visible own data indices preserve validated values.
    for (let i = 0; i < value.length; i++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(i));
      need(entry?.enumerable && Object.hasOwn(entry, 'value'));
    }
  };
  array(value, 32);
  for (const event of value) {
    need(event && !isProxy(event) && Object.getPrototypeOf(event) === Object.prototype
      && Object.getOwnPropertyDescriptor(event, 'kind')?.get === undefined);
    if (event.kind === 'checkpoint-transport') {
      const details = Object.keys(transportDetails).filter(key => Object.hasOwn(event, key));
      exact(event, ['kind', 'reason', 'validationStage', 'pending', 'completed', ...details]);
      for (const key of details) need(transportDetails[key](event[key]));
      need(transportReasons.includes(event.reason));
      need(event.reason === 'request-validation' ? transportValidationStages.includes(event.validationStage) : event.validationStage === 'none');
      for (const key of ['pending', 'completed'])
        need(Number.isSafeInteger(event[key]) && event[key] >= 0 && event[key] <= 1000000000);
    } else if (event.kind === 'measurement-refusal') {
      exact(event, ['kind', 'stage']);
      need(['checkpoint-admission', 'checkpoint-inventory', 'checkpoint-traffic', 'checkpoint-accounting'].includes(event.stage));
    } else if (event.kind === 'storage-refusal') {
      exact(event, ['kind', 'stage']);
      need(['storage-health', 'finish-input', 'cleanup-client-open', 'bucket-ownership', 'bucket-inventory',
        'bucket-present', 'multipart-list', 'object-list', 'retained-inventory', 'abort-upload', 'delete-object',
        'delete-bucket', 'accounting', 'retained-accounting', 'client-close', 'proxy-close', 'process-collect', 'root-remove'].includes(event.stage));
    } else if (['replay', 'replay-refusal', 'stream', 'stream-refusal'].includes(event.kind)) {
      exact(event, ['kind', 'stage']);
      const stages = event.kind.startsWith('replay')
        ? ['configuration', 'input', 'adapter-open', 'selection', 'stream-open', 'startup', 'workload', 'idle', 'verification', 'stream-finish', 'archive', 'restore', 'cleanup', 'storage-finish-input', 'storage-finish-result']
        : ['admission', 'measurement-open', 'version', 'replicate', 'phase', 'quiesce', 'quiesce-idle', 'quiesce-stop', 'quiesce-stop-result', 'quiesce-health', 'quiesce-checkpoint', 'restore-admission', 'restore', 'restore-file', 'restore-integrity', 'restore-sales', 'accounting', 'cleanup'];
      need(stages.includes(event.stage));
    } else {
      exact(event, ['kind', 'operation', 'code', 'signal', 'stderrBytes', 'stderrFlags']);
      need(event.kind === 'native' && ['version', 'replicate', 'restore'].includes(event.operation));
      need(event.code === null || Number.isSafeInteger(event.code) && event.code >= 0 && event.code <= 255);
      need(event.signal === null || nativeSignals.includes(event.signal));
      need(Number.isSafeInteger(event.stderrBytes) && event.stderrBytes >= 0 && event.stderrBytes <= 1000000000);
      array(event.stderrFlags, 6);
      need(event.stderrFlags.every(flag => ['error', 'checksum', 'sqlite', 'wal', 'snapshot', 'compaction'].includes(flag))
        && new Set(event.stderrFlags).size === event.stderrFlags.length);
    }
  }
  return structuredClone(value);
}
