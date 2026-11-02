const operations = new Set(['reserve-admin', 'start-exhausted', 'bucket-exhausted', 'stop-exhausted',
  'verify-owners', 'release-admin', 'start-recovered', 'bucket-recovered', 'stop-recovered', 'cleanup']);

export function storageAdminOperations(report) {
  const started = performance.now();
  return async (operation, run) => {
    if (!operations.has(operation)) return run();
    const entered = performance.now();
    const emit = state => {
      // Fixed labels and monotonic durations locate a stalled test without retaining its inputs or errors.
      try {
        const now = performance.now();
        report('storage_admin_progress=' + JSON.stringify({operation, state,
          elapsedMs:Math.round(now - started), operationElapsedMs:Math.round(now - entered)}));
      } catch {}
    };
    emit('started');
    let waits = 0;
    const timer = setInterval(() => {
      emit(++waits === 16 ? 'waiting-limit' : 'waiting');
      if (waits === 16) clearInterval(timer);
    }, 5000);
    timer.unref();
    let state = 'refused';
    try {
      const result = await run();
      state = 'completed';
      return result;
    } finally {
      clearInterval(timer);
      emit(state);
    }
  };
}
