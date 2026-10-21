import { buildLocalEvidence } from './joined-evidence.mjs';
import { validateInput } from './schema.mjs';

const fail = () => { throw Error('Invalid cloud cost projection'); };
const need = value => { if (!value) fail(); };
const exact = (value, keys) => need(value && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
const phases = ['startup', 'workload', 'idle', 'verification', 'restore'];
const ids = ['orders-per-day', 'days-per-month', 'startups-per-day', 'idle-seconds-per-day', 'workload-cadence-factor',
  'stream-restores-per-month', 'owner-sessions-per-month', 'public-api-runs-per-month',
  'mail-retry-fiscal-runs-per-month', 'signup-recovery-runs-per-month', 'archive-replay-runs-per-month'];

// Refuse hidden producer code before validation or copying can execute it.
function plain(value, ancestors = new Set(), budget = { remaining: 50000 }) {
  need(--budget.remaining >= 0);
  if (value === null || ['boolean', 'string'].includes(typeof value)) return;
  if (typeof value === 'number') { need(Number.isFinite(value)); return; }
  need(value && typeof value === 'object' && ancestors.size < 24 && !ancestors.has(value));
  const array = Array.isArray(value), keys = Reflect.ownKeys(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  if (array) need(value.length <= 10000 && keys.length === value.length + 1
    && keys.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length));
  ancestors.add(value);
  for (const key of keys) {
    need(typeof key === 'string'); const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(Object.hasOwn(descriptor, 'value')); plain(descriptor.value, ancestors, budget);
  }
  ancestors.delete(value);
}
const finite = value => need(Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
function scale(value, factor) {
  if (value === null) return null;
  if (typeof value === 'number') { const result = value * factor; finite(result); return result; }
  if (Array.isArray(value)) return value.map(row => scale(row, factor));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, row]) =>
    [key, key === 'retryOrdinal' ? row : scale(row, factor)]));
  return value;
}
const product = (...values) => values.includes(null) ? null : values.reduce((a, b) => a * b, 1);

// These are expected component quantities under assumptions, never a measured
// venue day. Independent overlapping scenarios have no combined cost or clock.
export function projectUsage(input) {
  try {
    plain(input); exact(input, ['samples', 'streamTiming', 'ownerScenario', 'serviceScenarios', 'assumptions']);
    const sources = buildLocalEvidence(input.samples).experiments;
    need(sources.archive !== undefined && sources.services.length === 2);
    need(['browser', 'api'].includes(input.ownerScenario));
    exact(input.assumptions, ids);
    const assumptions = Object.fromEntries(ids.map(id => {
      const row = validateInput(input.assumptions[id]);
      need(row.id === id && ['assumed', 'unknown'].includes(row.status) && row.scope === 'venue' && row.region === 'local'
        && row.unit === (id === 'idle-seconds-per-day' ? 'seconds' : 'count'));
      if (row.value !== null) need(row.value >= row.bounds.low && row.value <= row.bounds.high);
      if (['days-per-month', 'workload-cadence-factor'].includes(id) && row.value !== null) need(row.value > 0);
      if (id === 'days-per-month' && row.value !== null) need(row.value <= 31);
      if (id === 'idle-seconds-per-day' && row.value !== null) need(row.value <= 86400);
      return [id, row];
    }));
    const timing = input.streamTiming, stream = sources.stream;
    exact(timing, ['runId', 'cloudRevision', 'phases']);
    need(timing.runId === stream.runId && timing.cloudRevision === stream.cloudRevision
      && Array.isArray(timing.phases) && timing.phases.length === phases.length);
    for (const [i, phase] of timing.phases.entries()) {
      exact(phase, ['phase', 'elapsedSeconds']);
      need(phase.phase === phases[i] && typeof phase.elapsedSeconds === 'number' && phase.elapsedSeconds > 0);
    }
    need(timing.phases.reduce((sum, row) => sum + row.elapsedSeconds, 0) <= stream.window.elapsedSeconds);
    const value = id => assumptions[id].value;
    const sales = stream.inputs.find(row => row.id === 'successful-sales').value;
    const components = [], gaps = ids.filter(id => value(id) === null).map(id => id + ':unknown');
    function component(id, source, measured, dailyFactor, monthlyFactor, drivers) {
      if (dailyFactor !== null) finite(dailyFactor);
      if (monthlyFactor !== null) finite(monthlyFactor);
      const statuses = ['measured', 'assumed', ...(drivers.some(id => value(id) === null) ? ['unknown'] : [])];
      components.push({ id, source, statuses, drivers, measured,
        dailyFactor, monthlyFactor, daily: dailyFactor === null ? null : scale(measured, dailyFactor),
        monthly: monthlyFactor === null ? null : scale(measured, monthlyFactor) });
    }
    const streamSource = 'receipt:' + stream.runId;
    const daily = {
      startup: value('startups-per-day'),
      workload: product(value('orders-per-day') === null ? null : value('orders-per-day') / sales, value('workload-cadence-factor')),
      idle: value('idle-seconds-per-day') === null ? null : value('idle-seconds-per-day') / timing.phases[2].elapsedSeconds,
    };
    const drivers = { startup: ['startups-per-day'], workload: ['orders-per-day', 'workload-cadence-factor'], idle: ['idle-seconds-per-day'] };
    for (const phase of ['startup', 'workload', 'idle']) component('stream-' + phase, streamSource,
      stream.accounting.requests.filter(row => row.phase === phase), daily[phase], product(daily[phase], value('days-per-month')),
      [...drivers[phase], 'days-per-month']);
    component('stream-restore', streamSource, stream.accounting.requests.filter(row => row.phase === 'restore'),
      null, value('stream-restores-per-month'), ['stream-restores-per-month']);
    const owner = input.ownerScenario === 'browser' ? sources.browser.measurement.snapshot.producer
      : sources.api.measurement.evidence[0].snapshot.producer;
    const ownerSource = input.ownerScenario === 'browser' ? sources.browser.source : sources.api.source;
    component('owner-' + input.ownerScenario, 'revision:' + ownerSource.cloudRevision, owner,
      null, value('owner-sessions-per-month'), ['owner-sessions-per-month']);
    component('public-api', 'revision:' + sources.api.source.cloudRevision, sources.api.measurement.evidence[1].snapshot.producer,
      null, value('public-api-runs-per-month'), ['public-api-runs-per-month']);
    exact(input.serviceScenarios, ['mail-retry-fiscal', 'signup-recovery']);
    need(new Set(Object.values(input.serviceScenarios)).size === 2);
    for (const id of ['mail-retry-fiscal', 'signup-recovery']) {
      const sample = sources.services.find(row => row.metadata.runId === input.serviceScenarios[id]);
      need(sample !== undefined);
      const driver = id + '-runs-per-month';
      component('service-' + id, 'receipt:' + sample.metadata.runId, sample.summary, null, value(driver), [driver]);
    }
    const archive = sources.archive.replay.archive;
    component('archive-capture-restore', 'revision:' + sources.archive.cloudRevision,
      { capturedBytes: archive.capturedBytes, captureSeconds: archive.captureSeconds, restoreSeconds: archive.restoreSeconds,
        restoredSales: archive.restored.sales, storageHttpBytes: null },
      null, value('archive-replay-runs-per-month'), ['archive-replay-runs-per-month']);
    return structuredClone({ schemaVersion: 1, kind: 'assumed-component-projection', costMeasured: false, complete: false,
      sources, streamTiming: timing, assumptions, ownerScenario: input.ownerScenario, serviceScenarios: input.serviceScenarios, components,
      experimentOnly: { source: streamSource,
        requests: stream.accounting.requests.filter(row => ['setup', 'observer', 'cleanup', 'verification'].includes(row.phase)) },
      dailyCost: null, monthlyCost: null, gaps,
      unmeasured: ['representative-venue-state', 'representative-remote-activity', 'public-browser-journey',
        'representative-archive-shape', 'archive-storage-http-traffic', 'workload-cadence-and-batching',
        'stream-schedule-boundaries', 'storage-retention-projection', 'ip-tcp-overhead', 'tunnel-to-provider-billing', 'provider-billing'] });
  } catch { fail(); }
}
