import { validateInput } from './input.mjs';
import { priceUsage, forecastArchives, retainedBytes } from './model.mjs';

const fail = () => { throw Error('Invalid cloud cost calculator'); };
const need = value => { if (!value) fail(); };
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const exact = (value, keys) => need(value && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key)));
function plain(value, ancestors = new Set(), budget = { left: 100000 }) {
  need(--budget.left >= 0 && ancestors.size < 24);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { need(finite(value)); return; }
  need(value && typeof value === 'object' && !ancestors.has(value));
  const array = Array.isArray(value), keys = Reflect.ownKeys(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  if (array) need(value.length <= 10000 && keys.length === value.length + 1
    && keys.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length));
  ancestors.add(value);
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && Object.hasOwn(d, 'value')); plain(d.value, ancestors, budget); }
  ancestors.delete(value);
}

// Defaults are illustrative assumptions. A blank remains unknown, including in
// the browser; it cannot silently become zero through Number('').
export const controlLimits = {
  ordersPerDay: [0, 1000000, true], retentionMonths: [1, 36, true], sessionsPerMonth: [0, 1000000, true],
  capacity: [1, 1000000, true], databaseCapacity: [1, 1000000, true], warmCells: [0, 1000, true],
  controlDiskGB: [0, 1000000, false], gatewayDiskGB: [0, 1000000, false], databaseGB: [0, 1000000, false],
  natGateways: [0, 1000, true], platformKeys: [0, 1000000, true], venueKeys: [0, 1000, true],
  archiveBaseBytes: [0, 1073741824000, true], growthFactor: [0, 1000, false], cadenceFactor: [1, 1000, false],
  idleSeconds: [0, 86400, false], startsPerDay: [0, 1000, true], sessionOverhead: [1, 1000, false],
  egressBytesPerGB: [1, 1073741824, true], publicGB: [0, 1000000, false],
};
const controlKeys = ['region', 'topology', ...Object.keys(controlLimits)];
export function defaultControls(data) {
  validateCalculatorData(data);
  return { region: 'eu-south-2', topology: 'single', ordersPerDay: data.basis.sales, retentionMonths: 12,
    sessionsPerMonth: null, capacity: null, databaseCapacity: null, warmCells: 0,
    controlDiskGB: null, gatewayDiskGB: null, databaseGB: null, natGateways: null,
    platformKeys: null, venueKeys: 1, archiveBaseBytes: data.basis.databaseBytes,
    growthFactor: 1, cadenceFactor: 1, idleSeconds: 32228.364, startsPerDay: 1,
    sessionOverhead: 1, egressBytesPerGB: null, publicGB: null };
}
export function validateCalculatorData(data) {
  try {
    plain(data); exact(data, ['schemaVersion', 'prices', 'inventory', 'basis']); need(data.schemaVersion === 1);
    need(Array.isArray(data.prices) && Array.isArray(data.inventory) && data.inventory.length > 0);
    data.prices.forEach(rate => need(validateInput(rate).status === 'list-priced'));
    const ids = new Set();
    for (const row of data.inventory) {
      exact(row, ['id', 'inclusion']); need(/^[a-z][a-z0-9-]{1,79}$/.test(row.id) && !ids.has(row.id)); ids.add(row.id);
      need(['required', 'candidate', 'excluded'].includes(row.inclusion));
    }
    const b = data.basis;
    exact(b, ['sales', 'databaseBytes', 'growthBytes', 'archiveBytes', 'ownerBytesOut', 'idleSeconds', 'requests', 'sources']);
    for (const key of ['sales', 'databaseBytes', 'growthBytes', 'archiveBytes', 'ownerBytesOut']) need(Number.isSafeInteger(b[key]) && b[key] >= 0);
    need(b.sales > 0 && b.databaseBytes > 0 && b.archiveBytes > 0 && b.ownerBytesOut > 0 && finite(b.idleSeconds) && b.idleSeconds > 0);
    exact(b.sources, ['stream', 'archive', 'owner']);
    for (const [key, file] of [['stream', 'measurements.json'], ['archive', 'archive-replay.json'], ['owner', 'remote-owner-browser.json']]) {
      const source = b.sources[key]; exact(source, ['file', 'revision', 'observedAt']);
      need(source.file === file && /^[a-f0-9]{40}$/.test(source.revision)
        && typeof source.observedAt === 'string' && Number.isFinite(Date.parse(source.observedAt))
        && new Date(source.observedAt).toISOString() === source.observedAt);
    }
    need(Array.isArray(b.requests) && b.requests.length > 0);
    for (const row of b.requests) {
      const numeric = ['retryOrdinal', 'attempts', 'successful', 'failed', 'retried', 'bytesIn', 'bytesOut', 'attemptedBytesIn', 'attemptedBytesOut'];
      exact(row, ['phase', 'operation', 'requestClass', 'outcome', ...numeric]);
      need(numeric.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0)
        && row.successful + row.failed === row.attempts && row.retried <= row.attempts
        && row.bytesIn <= row.attemptedBytesIn && row.bytesOut <= row.attemptedBytesOut);
      need(['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'].includes(row.phase)
        && ['success', 'client-error', 'server-error', 'transport-error'].includes(row.outcome)
        && ['put', 'get', 'head', 'list', 'delete', 'delete-many', 'multipart-create', 'multipart-upload', 'multipart-complete',
          'multipart-abort', 'bucket-create', 'bucket-delete', 'bucket-inspect', 'bucket-configure'].includes(row.operation)
        && ['s3-write', 's3-read', 's3-list', 's3-delete', 's3-multipart', 's3-control'].includes(row.requestClass));
    }
    return structuredClone(data);
  } catch { fail(); }
}

const assumed = (id, value, unit, region, scope = 'usage') => ({ id, value, unit, region, scope,
  status: value === null ? 'unknown' : 'assumed', source: value === null ? null : 'assumption:workload-assumption',
  reason: value === null ? 'not-measured' : 'workload-assumption', observedAt: null, effectiveAt: null,
  bounds: value === null ? null : { low: value, base: value, high: value, assumption: 'workload-assumption' } });
const multiply = (...values) => values.includes(null) ? null : values.reduce((a, b) => a * b, 1);
const add = (...values) => values.includes(null) ? null : values.reduce((a, b) => a + b, 0);
const stamp = time => new Date(time).toISOString();

function archives(b, c, factor) {
  if ([c.archiveBaseBytes, c.ordersPerDay, c.growthFactor, c.retentionMonths].includes(null)) return null;
  const origin = Date.UTC(2027, 0, 1), firstEnd = Date.UTC(2027, 1, 1);
  const matureStart = Date.UTC(2027, c.retentionMonths + 1, 1), matureEnd = Date.UTC(2027, c.retentionMonths + 2, 1);
  const captures = [];
  for (let time = origin; time < matureEnd; time += 86400000) {
    captures.push({ token: 'daily-' + captures.length, at: stamp(time), retention: 'daily' });
    // Independent monthly copies are an explicit scenario. No shared capture or
    // production scheduler is inferred from the local archive sample.
    if (new Date(time).getUTCDate() === 1) captures.push({ token: 'monthly-' + captures.length, at: stamp(time), retention: 'monthly' });
  }
  const forecast = forecastArchives({ initial: assumed('initial-archive', c.archiveBaseBytes, 'bytes', c.region),
    growthPerSale: assumed('archive-growth', b.growthBytes / b.sales * c.growthFactor * factor, 'bytes', c.region),
    ordersPerDay: assumed('future-orders', c.ordersPerDay, 'count', c.region), originAt: stamp(origin), captures });
  const events = forecast.events.flatMap(event => [event, { type: 'verify', token: event.token, at: event.at, verified: true }]);
  const policy = { dailyDays: 30, monthlyMonths: c.retentionMonths, streamSeconds: null, noncurrentSeconds: null, steady: false };
  return { monthOneByteSeconds: retainedBytes(events, { startedAt: stamp(origin), endedAt: stamp(firstEnd) }, policy).byteSeconds,
    matureByteSeconds: retainedBytes(events, { startedAt: stamp(matureStart), endedAt: stamp(matureEnd) }, policy).byteSeconds,
    monthOneSeconds: (firstEnd - origin) / 1000, matureSeconds: (matureEnd - matureStart) / 1000,
    matureWindow: { startedAt: stamp(matureStart), endedAt: stamp(matureEnd) }, steady: false, status: 'assumed' };
}

export function calculateCosts(input) {
  try {
    plain(input); exact(input, ['data', 'controls']); const data = validateCalculatorData(input.data), c = input.controls;
    exact(c, controlKeys); need(['eu-south-2', 'eu-north-1'].includes(c.region) && ['single', 'redundant'].includes(c.topology));
    for (const [key, [min, max, integer]] of Object.entries(controlLimits)) need(c[key] === null
      || finite(c[key]) && c[key] >= min && c[key] <= max && (!integer || Number.isSafeInteger(c[key])));
    const gaps = [...data.inventory.filter(row => row.inclusion === 'required').map(row => 'inventory:' + row.id),
      'stream-object-lifetimes', 'scheduled-stream-boundaries', 'noncurrent-retention', 'archive-selection-and-protection',
      'operation-billing', 'provider-billing'];
    const b = data.basis, replicas = c.topology === 'single' ? 1 : 2;
    const scenarios = Object.fromEntries([['low', 0.5], ['base', 1], ['high', 2]].map(([level, factor]) => {
      const archive = archives(b, c, factor), sessionBytesPerVenue = multiply(b.ownerBytesOut, c.sessionsPerMonth, c.sessionOverhead, factor);
      const rows = [0, 1, 10, 100, 1000].map(venues => {
        const rowGaps = Object.entries(c).filter(([, value]) => value === null).map(([key]) => key + ':unknown');
        const count = (capacity, minimum) => venues === 0 ? minimum
          : capacity === null || minimum === null ? null : Math.max(minimum, Math.ceil(venues / Math.max(1, capacity / factor)));
        const cells = count(c.capacity, c.warmCells), databases = count(c.databaseCapacity, 1);
        const lines = [];
        function line(id, scope, priceId, quantity, unit, period = null) {
          if (venues === 0 && scope === 'venue') quantity = 0;
          if (quantity !== null && ['Requests', 'Keys', 'HostedZone'].includes(unit)) quantity = Math.ceil(quantity);
          const q = assumed(id, quantity, unit, c.region, scope);
          const rates = data.prices.filter(rate => rate.id === priceId && [c.region, 'global'].includes(rate.region));
          const result = quantity === 0 ? { cost: 0, statuses: ['assumed'], gaps: [] }
            : priceUsage(period === null ? q : { input: q, period: assumed('calendar-month', period, 'seconds', c.region) }, rates);
          need(result.cost === null || finite(result.cost));
          rowGaps.push(...result.gaps);
          lines.push({ id, scope, priceId, quantity, unit, ...result,
            sources: rates.map(rate => ({ source: rate.source, retrievedAt: rate.retrievedAt, effectiveAt: rate.effectiveAt,
              region: rate.region, value: rate.value, unit: rate.unit, sku: rate.sku, rateCode: rate.rateCode })) });
        }
        const gateCount = multiply(cells, replicas);
        line('control-compute', 'platform', 'ec2-t3-small', 730 * replicas, 'hours');
        line('control-disks', 'platform', 'ebs-gp3-storage', multiply(c.controlDiskGB, replicas), 'GB-Mo');
        line('gateway-compute', 'platform', 'ec2-t3-small', multiply(gateCount, 730), 'hours');
        line('gateway-disks', 'platform', 'ebs-gp3-storage', multiply(gateCount, c.gatewayDiskGB), 'GB-Mo');
        line('database-compute', 'platform', c.topology === 'single' ? 'rds-t4g-micro-single' : 'rds-t4g-micro-multi', multiply(databases, 730), 'hours');
        line('database-disks', 'platform', c.topology === 'single' ? 'rds-gp3-single' : 'rds-gp3-multi', multiply(databases, c.databaseGB), 'GB-Mo');
        line('public-addresses', 'platform', 'ipv4-active', multiply(add(replicas, gateCount), 730), 'hours');
        line('nat-hours', 'platform', 'nat-hours', multiply(c.natGateways, 730), 'hours');
        line('platform-keys', 'platform', 'kms-key', c.platformKeys, 'Keys');
        line('dns-zone', 'platform', 'dns-zone', 1, 'HostedZone');
        line('venue-keys', 'venue', 'kms-key', multiply(c.venueKeys, venues), 'Keys');
        for (const [id, classes, priceId] of [['stream-write-list', ['s3-write', 's3-list'], 's3-write'], ['stream-read', ['s3-read'], 's3-read']]) {
          const phase = name => b.requests.filter(row => row.phase === name && classes.includes(row.requestClass))
            .reduce((sum, row) => sum + row.attempts, 0);
          const daily = add(multiply(phase('startup'), c.startsPerDay),
            multiply(phase('workload') / b.sales, c.ordersPerDay, c.cadenceFactor, factor),
            multiply(phase('idle') / b.idleSeconds, c.idleSeconds));
          line(id, 'venue', priceId, multiply(daily, 31, venues), 'Requests');
        }
        line('archive-month-one', 'venue', 's3-standard-storage', multiply(archive?.monthOneByteSeconds ?? null, venues), 'byte-seconds', archive?.monthOneSeconds ?? 2678400);
        line('archive-mature', 'venue', 's3-standard-storage', multiply(archive?.matureByteSeconds ?? null, venues), 'byte-seconds', archive?.matureSeconds ?? 2678400);
        const transfer = c.egressBytesPerGB === null ? null : add(sessionBytesPerVenue === null ? null : sessionBytesPerVenue / c.egressBytesPerGB, c.publicGB);
        line('internet-transfer', 'venue', 'internet-egress', multiply(transfer, venues), 'GB');
        // The month-one and mature archive forecasts are alternative windows.
        // Only the mature window belongs in this subtotal.
        const subtotal = scope => lines.filter(line => line.scope === scope && line.id !== 'archive-month-one')
          .reduce((sum, line) => sum + (line.cost ?? 0), 0);
        const fixedSubtotal = subtotal('platform'), venueSubtotal = subtotal('venue'), total = fixedSubtotal + venueSubtotal;
        need(finite(total));
        return { venues, capacity: { cells, databases, assumed: true }, lines, fixedSubtotal, venueSubtotal,
          subtotal: total, averageSubtotal: venues === 0 ? null : total / venues,
          total: null, complete: false, gaps: [...new Set([...gaps, ...rowGaps])] };
      });
      return [level, { factor, status: 'assumed', archive, sessionBytesPerVenue, rows }];
    }));
    return { schemaVersion: 1, complete: false, scenarios, gaps, sources: data.basis.sources,
      allowancesApplied: false, creditsApplied: false, tax: null, billingValidated: false };
  } catch { fail(); }
}
