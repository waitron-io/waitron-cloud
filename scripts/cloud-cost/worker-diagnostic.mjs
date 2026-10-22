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
      && Object.getOwnPropertyDescriptor(value, key).get === undefined));
  };
  need(Array.isArray(value) && value.length <= 32);
  for (const event of value) {
    need(event && Object.getPrototypeOf(event) === Object.prototype
      && Object.getOwnPropertyDescriptor(event, 'kind')?.get === undefined);
    if (['replay', 'replay-refusal', 'stream', 'stream-refusal'].includes(event.kind)) {
      exact(event, ['kind', 'stage']);
      const stages = event.kind.startsWith('replay')
        ? ['configuration', 'input', 'adapter-open', 'selection', 'stream-open', 'startup', 'workload', 'idle', 'verification', 'stream-finish', 'archive', 'restore', 'cleanup']
        : ['admission', 'measurement-open', 'version', 'replicate', 'phase', 'quiesce', 'restore', 'restore-file', 'restore-integrity', 'restore-sales', 'accounting', 'cleanup'];
      need(stages.includes(event.stage));
    } else {
      exact(event, ['kind', 'operation', 'code', 'signal', 'stderrBytes', 'stderrFlags']);
      need(event.kind === 'native' && ['version', 'replicate', 'restore'].includes(event.operation));
      need(event.code === null || Number.isSafeInteger(event.code) && event.code >= 0 && event.code <= 255);
      need(event.signal === null || ['SIGTERM', 'SIGKILL', 'SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGPIPE', 'SIGINT'].includes(event.signal));
      need(Number.isSafeInteger(event.stderrBytes) && event.stderrBytes >= 0 && event.stderrBytes <= 1000000000);
      need(Array.isArray(event.stderrFlags) && event.stderrFlags.length <= 6
        && event.stderrFlags.every(flag => ['error', 'checksum', 'sqlite', 'wal', 'snapshot', 'compaction'].includes(flag))
        && new Set(event.stderrFlags).size === event.stderrFlags.length);
    }
  }
  return structuredClone(value);
}
