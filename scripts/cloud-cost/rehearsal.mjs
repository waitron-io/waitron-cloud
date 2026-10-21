import { projectUsage } from './projection.mjs';

// A partial request projection can prove a cap breach. It cannot prove that a
// trial fits: omitted schedules, objects and retries still have unknown bounds.
export function assessStorageRehearsal(input) {
  const projection = projectUsage(input);
  const { assumptions, sources, streamTiming } = projection;
  const requests = sources.stream.accounting.requests;
  const phaseAttempts = phase => requests.filter(row => row.phase === phase).reduce((sum, row) => sum + row.attempts, 0);
  const sales = sources.stream.inputs.find(row => row.id === 'successful-sales').value;
  const idleSeconds = streamTiming.phases.find(row => row.phase === 'idle').elapsedSeconds;
  const scenarios = Object.fromEntries(['low', 'base', 'high'].map(level => {
    const value = id => assumptions[id].bounds?.[level] ?? null;
    const multiply = (...values) => values.includes(null) ? null : values.reduce((a, b) => a * b, 1);
    const startupAttempts = multiply(phaseAttempts('startup'), value('startups-per-day'));
    const workloadAttempts = multiply(phaseAttempts('workload') / sales, value('orders-per-day'), value('workload-cadence-factor'));
    const idleAttempts = multiply(phaseAttempts('idle') / idleSeconds, value('idle-seconds-per-day'));
    const counts = [startupAttempts, workloadAttempts, idleAttempts];
    const knownComponentAttempts = counts.includes(null) ? null : counts.reduce((a, b) => a + b, 0);
    if (counts.some(n => n !== null && (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER))) throw Error('Invalid cloud cost projection');
    return [level, { status: 'assumed', startupAttempts, workloadAttempts, idleAttempts, knownComponentAttempts }];
  }));
  const reasons = ['object-size-lifetimes-unknown', 'scheduled-boundaries-unknown', 'retry-ceilings-unknown',
    'operation-billing-unknown', ...projection.gaps];
  if (scenarios.high.knownComponentAttempts > 10000) reasons.unshift('assumed-high-components-exceed-s3-cap');
  return structuredClone({ schemaVersion: 1, kind: 'storage-rehearsal-assessment', status: 'stopped-before-provision',
    providerAuthorised: false, trialRun: false, billingReadRequired: false, dailyVectorComplete: false,
    completeDailyAttempts: null, completeDailyBytes: null, s3AttemptCap: 10000,
    syntheticReplaySeconds: 900, syntheticTimingStatus: 'assumed', scenarios, assumptions,
    sourceRequests: requests, sources: { streamRunId: sources.stream.runId, cloudRevision: sources.stream.cloudRevision,
      waitronRevision: sources.stream.waitronRevision, window: sources.stream.window }, reasons,
    unmeasured: projection.unmeasured });
}
