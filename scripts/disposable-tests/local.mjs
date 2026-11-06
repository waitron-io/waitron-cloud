import assert from 'node:assert/strict';

// A transport settles only after its owned subprocess has stopped. Cleanup must
// never race a cancelled transfer or preparation that can still create resources.
export async function runLocal({leases, transport, request, durationMs = 3300000, signal}) {
  if (signal?.aborted) return {code:143,reason:'cancelled-before-admission'};
  const admission = AbortSignal.timeout(8000);
  let healthy;
  try { healthy = await transport.healthy({signal: signal ? AbortSignal.any([signal, admission]) : admission}); }
  catch { return signal?.aborted ? {code: 143, reason: 'cancelled-before-admission'} : {code: 75, reason: 'host-unavailable'}; }
  if (signal?.aborted) return {code: 143, reason: 'cancelled-before-admission'};
  const reserved = leases.reserveLocal(request, {healthy, durationMs});
  if (reserved.code !== 0) return reserved;
  if (!reserved.created) return {code: 75, reason: 'turn-already-owned'};
  const lease = reserved.lease;
  if (!leases.start(lease)) return {code: 75, reason: 'lease-not-started'};
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('Turn deadline exceeded')), Math.max(0, lease.deadline - Date.now()));
  const work = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let code = 125, error;
  try {
    for (const stage of ['transfer', 'prepare', 'execute']) {
      work.throwIfAborted();
      const result = await transport[stage](lease, {signal: work});
      work.throwIfAborted();
      if (stage === 'execute') {
        assert.ok(Number.isInteger(result) && result >= 0 && result <= 255, 'Invalid command exit status');
        code = result;
      }
    }
  } catch (failure) {
    code = signal?.aborted ? 143 : deadline.signal.aborted ? 124 : 125;
    error = failure.message;
  } finally { clearTimeout(timer); }
  // Work cancellation does not cancel cleanup. Only a fresh observed absence
  // for this generation can release its capacity, even after a lost connection.
  const cleanupDeadline = AbortSignal.timeout(120000);
  let released = false;
  try {
    await transport.destroy(lease, {signal: cleanupDeadline});
    const observation = await transport.inspect(lease, {signal: cleanupDeadline});
    released = leases.release(lease, observation);
  } catch (failure) { error = failure.message; }
  if (!released) {
    leases.release(lease, undefined);
    return {code: 125, cleanup: 'quarantined', lease, error};
  }
  return {code, cleanup: 'absent', lease, ...(error ? {error} : {})};
}
