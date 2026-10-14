import { validateInput } from './schema.mjs';

const requireThat = value => { if (!value) throw new Error('Invalid cloud cost model'); };
function safeError(error) {
  const message = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message')?.value : null;
  throw new Error(message === 'Invalid cloud cost evidence' ? 'Invalid cloud cost evidence' : 'Invalid cloud cost model');
}
export function priceUsage(quantity, rates) { try { return priceUsageUnchecked(quantity, rates); } catch (error) { safeError(error); } }
export function estimate(value) { try { return estimateUnchecked(value); } catch (error) { safeError(error); } }
export function retainedBytes(events, window, policy) { try { return retainedBytesUnchecked(events, window, policy); } catch (error) { safeError(error); } }
export function forecastArchives(value) { try { return forecastArchivesUnchecked(value); } catch (error) { safeError(error); } }
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const unique = values => [...new Set(values)];
const sum = values => values.includes(null) ? null : values.reduce((a, b) => a + b, 0);
const unit = value => ['count', 'Count', 'Requests', 'API Requests', 'Queries', 'Events', 'Runs', 'Message'].includes(value) ? 'count'
  : ['hours', 'hour', 'Hrs', 'Hours'].includes(value) ? 'hours' : value;
const timestamp = value => { const result = Date.parse(value); requireThat(typeof value === 'string' && Number.isFinite(result)
  && new Date(result).toISOString() === value); return result; };
function forecastArchivesUnchecked({ initial, growthPerSale, ordersPerDay, originAt, captures }) {
  initial = validateInput(initial); growthPerSale = validateInput(growthPerSale); ordersPerDay = validateInput(ordersPerDay);
  requireThat(initial.unit === 'bytes' && growthPerSale.unit === 'bytes' && ordersPerDay.unit === 'count');
  const origin = timestamp(originAt); requireThat(Array.isArray(captures) && captures.length <= 10000);
  const statuses = unique([initial.status, growthPerSale.status, ordersPerDay.status, 'assumed']);
  const gaps = [initial, growthPerSale, ordersPerDay].filter(i => i.value === null).map(i => `${i.id}:not-measured`);
  if (gaps.length > 0) return { events: null, statuses, gaps };
  const tokens = new Set();
  const events = captures.map(capture => {
    exactKeys(capture, ['token', 'at', 'retention']); requireThat(['daily', 'monthly'].includes(capture.retention));
    requireThat(typeof capture.token === 'string' && capture.token.length > 0 && !tokens.has(capture.token)); tokens.add(capture.token);
    const time = timestamp(capture.at); requireThat(time >= origin);
    const value = initial.value + growthPerSale.value * ordersPerDay.value * (time - origin) / 86400000;
    requireThat(finite(value));
    // A dated capture is one object. Selection and future growth remain caller-supplied assumptions.
    return { type: 'create', token: capture.token, at: capture.at, retention: capture.retention,
      class: capture.retention === 'monthly' ? 'monthly-archive' : 'daily-archive',
      bytes: { ...initial, id: 'archive-bytes', value, status: 'assumed', source: 'assumption:workload-assumption',
        reason: 'workload-assumption', bounds: { low: value, base: value, high: value, assumption: 'workload-assumption' } } };
  });
  return { events, statuses, gaps };
}
const exactKeys = (value, keys) => requireThat(value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(k => keys.includes(k)
    && Object.getOwnPropertyDescriptor(value, k).get === undefined));
function calendarExpiry(at, retention, policy) {
  const date = new Date(at);
  if (retention === 'daily') date.setUTCDate(date.getUTCDate() + policy.dailyDays);
  else {
    const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + policy.monthlyMonths);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  }
  return date.getTime();
}

function retainedBytesUnchecked(events, window, policy) {
  exactKeys(window, ['startedAt', 'endedAt']); const start = timestamp(window.startedAt); const end = timestamp(window.endedAt);
  requireThat(end > start && Array.isArray(events));
  exactKeys(policy, ['dailyDays', 'monthlyMonths', 'streamSeconds', 'noncurrentSeconds', 'steady']);
  requireThat(Number.isSafeInteger(policy.dailyDays) && policy.dailyDays > 0
    && Number.isSafeInteger(policy.monthlyMonths) && policy.monthlyMonths > 0 && typeof policy.steady === 'boolean');
  requireThat(['streamSeconds', 'noncurrentSeconds'].every(k => policy[k] === null || (finite(policy[k]) && policy[k] > 0)));
  const statuses = ['assumed']; const gaps = []; const states = new Map(); const classes = new Map();
  const ordered = events.map((event, index) => {
    requireThat(['create', 'delete', 'verify', 'reference', 'release', 'noncurrent'].includes(event.type));
    exactKeys(event, event.type === 'create' ? ['type', 'token', 'at', 'class', 'bytes', 'retention']
      : event.type === 'verify' ? ['type', 'token', 'at', 'verified'] : ['type', 'token', 'at']);
    requireThat(typeof event.token === 'string' && event.token.length > 0 && event.token.length <= 200);
    if (event.type === 'create') {
      requireThat(['stream', 'snapshot', 'daily-archive', 'monthly-archive', 'scratch'].includes(event.class));
      requireThat(['daily', 'monthly', null].includes(event.retention));
      const size = validateInput(event.bytes); requireThat(size.unit === 'bytes'); statuses.push(size.status);
    }
    if (event.type === 'verify') requireThat(typeof event.verified === 'boolean');
    return { ...event, time: timestamp(event.at), index };
  }).sort((a, b) => a.time - b.time || a.index - b.index);
  const expiries = ordered.filter(e => e.type === 'create').map(e => e.class === 'stream'
    ? e.time + (policy.streamSeconds ?? Infinity) * 1000
    : e.retention === null ? Infinity : calendarExpiry(e.time, e.retention, policy));
  const versionExpiries = ordered.filter(e => e.type === 'noncurrent').map(e => e.time + (policy.noncurrentSeconds ?? Infinity) * 1000);
  const times = unique([start, end, ...ordered.map(e => e.time), ...expiries, ...versionExpiries]).filter(t => t <= end && Number.isFinite(t)).sort((a, b) => a - b);
  let cursor = 0; let unbounded = false;
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    while (cursor < ordered.length && ordered[cursor].time === time) {
      const e = ordered[cursor++];
      if (e.type === 'create') {
        requireThat(!states.has(e.token));
        const size = validateInput(e.bytes);
        if (size.value === null) gaps.push(`${size.id}:not-measured`);
        states.set(e.token, { class: e.class, bytes: size.value, created: time, ordinal: e.index,
          expiry: e.class === 'stream' ? time + (policy.streamSeconds ?? Infinity) * 1000
            : e.retention === null ? Infinity : calendarExpiry(time, e.retention, policy),
          verified: false, references: 0, noncurrent: false, deleted: false });
      } else {
        const s = states.get(e.token); requireThat(s && !s.deleted);
        if (e.type === 'delete') s.deleted = true;
        if (e.type === 'verify' && e.verified) s.verified = true;
        if (e.type === 'reference') s.references++;
        if (e.type === 'release') { requireThat(s.references > 0); s.references--; }
        if (e.type === 'noncurrent') { requireThat(!s.noncurrent); s.noncurrent = true;
          s.expiry = time + (policy.noncurrentSeconds ?? Infinity) * 1000;
          if (policy.noncurrentSeconds === null) unbounded = true; }
      }
    }
    // The last verified capture wins; until one exists, preserve the most recent capture.
    const protectedObject = [...states.values()].filter(s => !s.deleted && !s.noncurrent
      && ['snapshot', 'daily-archive', 'monthly-archive'].includes(s.class))
      .sort((a, b) => Number(b.verified) - Number(a.verified) || b.created - a.created || b.ordinal - a.ordinal)[0];
    for (const s of states.values()) if (!s.deleted && s.expiry <= time && s !== protectedObject && s.references === 0) s.deleted = true;
    const seconds = (Math.min(times[i + 1] ?? end, end) - Math.max(time, start)) / 1000;
    for (const s of states.values()) {
      if (!classes.has(s.class)) classes.set(s.class, { class: s.class, bytes: 0, byteSeconds: 0,
        currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
      if (!s.deleted && seconds > 0 && s.bytes !== null) classes.get(s.class).byteSeconds += s.bytes * seconds;
    }
  }
  for (const s of states.values()) if (!s.deleted) {
    const row = classes.get(s.class); row.bytes += s.bytes ?? 0; row[s.noncurrent ? 'noncurrentVersions' : 'currentVersions']++;
  }
  if (policy.steady && unbounded) { gaps.push('noncurrent:unbounded-retention'); statuses.push('unknown'); }
  if (policy.steady && policy.streamSeconds === null && ordered.some(e => e.type === 'create' && e.class === 'stream')) {
    gaps.push('stream:unbounded-retention'); statuses.push('unknown');
  }
  let byteSeconds = gaps.length > 0 ? null : [...classes.values()].reduce((sum, c) => sum + c.byteSeconds, 0);
  if (byteSeconds !== null && !finite(byteSeconds)) { byteSeconds = null; gaps.push('storage:arithmetic-overflow'); statuses.push('unknown'); }
  return { byteSeconds, classes: [...classes.values()], statuses: unique(statuses), gaps: unique(gaps) };
}

function priceUsageUnchecked(quantity, rates) {
  const task = quantity?.duration !== undefined;
  const input = validateInput(task ? quantity.resources : quantity?.input ?? quantity);
  const statuses = [input.status]; const gaps = [];
  const gap = code => { gaps.push(`${input.id}:${code}`); return { cost: null, statuses: unique([...statuses, 'unknown']), gaps: unique(gaps) }; };
  if (rates === null || rates === undefined || (Array.isArray(rates) && rates.length === 0)) return gap('not-priced');
  rates = (Array.isArray(rates) ? rates : [rates]).map(validateInput).sort((a, b) => (a.tier?.begin ?? 0) - (b.tier?.begin ?? 0));
  statuses.push(...rates.map(r => r.status));
  if (input.value === null || rates.some(r => r.status !== 'list-priced')) return gap('not-priced');
  if (rates.some(r => r.region !== input.region && r.region !== 'global')) return gap('unsupported-region');
  const first = rates[0];
  if (rates.some(r => r.id !== first.id || r.unit !== first.unit || r.region !== first.region
    || JSON.stringify(r.attributes) !== JSON.stringify(first.attributes))) return gap('incompatible-tiers');
  if (['minimumObjectBytes', 'minimumDurationDays', 'standardMetadataBytes', 'archiveMetadataBytes'].some(k => first.attributes[k] !== undefined)) return gap('object-lifecycle-required');
  let amount = input.value;
  if (task) {
    const duration = validateInput(quantity.duration); statuses.push(duration.status);
    const minimum = Number(first.attributes.minimumDurationSeconds); const round = Number(first.attributes.billingDurationRoundSeconds);
    if (duration.value === null || duration.unit !== 'seconds' || duration.region !== input.region
      || !['vCPU-hour', 'GB-hour'].includes(first.attributes.quantityDimension)
      || !finite(minimum) || !finite(round) || round === 0
      || input.unit !== (first.attributes.quantityDimension === 'vCPU-hour' ? 'vCPU' : 'GB')) return gap('task-dimensions');
    amount *= Math.max(minimum, Math.ceil(duration.value / round) * round) / 3600;
  } else if (first.attributes.minimumDurationSeconds !== undefined) return gap('task-duration-required');
  else if (input.unit === 'bytes' && ['GB', 'GiB'].includes(first.unit)) {
    const divisor = Number(first.attributes.billingBytesPerUnit);
    if (!finite(divisor) || divisor === 0) return gap('billing-byte-unit');
    amount /= divisor;
  } else if (input.unit === 'byte-seconds' && ['GB-Mo', 'GB-month'].includes(first.unit)) {
    if (!quantity.period) return gap('billing-period');
    const period = validateInput(quantity.period); statuses.push(period.status);
    const divisor = Number(first.attributes.billingBytesPerUnit);
    if (period.value === null || period.value === 0 || period.unit !== 'seconds' || !finite(divisor) || divisor === 0) return gap('billing-period');
    amount /= divisor * period.value;
  } else if (unit(input.unit) !== unit(first.unit)) return gap('unsupported-unit');
  if (!task) {
    if (first.minimum.quantity === null || first.rounding.mode === 'unknown') return gap('billing-terms');
    if (first.minimum.unit !== first.unit) return gap('billing-minimum-unit');
    if (amount > 0) amount = Math.max(amount, first.minimum.quantity);
    if (first.rounding.mode === 'ceil') {
      if (first.rounding.quantum === null) return gap('billing-rounding');
      amount = Math.ceil(amount / first.rounding.quantum) * first.rounding.quantum;
    }
  }
  let position = 0; let cost = 0;
  for (const r of rates) {
    if (r.tier.begin !== position) return gap('tier-gap-or-overlap');
    const end = r.tier.end ?? Infinity;
    cost += Math.max(0, Math.min(amount, end) - position) * r.value;
    position = end;
  }
  if (amount > position) return gap('tier-gap-or-overlap');
  if (!finite(amount) || !finite(cost)) return gap('arithmetic-overflow');
  return { cost, statuses: unique(statuses), gaps };
}

function estimateUnchecked({ inputs, prices, scenario, venues, horizon }) {
  requireThat(Number.isSafeInteger(venues) && venues >= 0);
  inputs = inputs.map(validateInput); prices = prices.map(validateInput);
  requireThat(new Set(inputs.map(i => i.id)).size === inputs.length);
  requireThat(['eu-south-2', 'eu-north-1'].includes(scenario.region));
  const indexed = new Map(inputs.map(i => [i.id, i]));
  const statuses = []; const gaps = []; const steps = [];
  const selected = id => {
    const value = indexed.get(id);
    if (!value) { gaps.push(`${id}:not-measured`); statuses.push('unknown'); return null; }
    statuses.push(value.status); if (value.value === null) gaps.push(`${id}:not-measured`); return value;
  };
  const lineCost = (line, multiplier) => {
    const q = selected(line.quantity); const r = prices.filter(p => p.id === line.price && (p.region === scenario.region || p.region === 'global'));
    if (multiplier === 0) return 0;
    if (r.length === 0) { gaps.push(`${line.price}:not-priced`); statuses.push('unknown'); return null; }
    if (q === null || q.value === null || multiplier === null) return null;
    // Scaling a measured operation into a future workload is an assumption, not a new measurement.
    const value = q.value * multiplier;
    if (!finite(value)) { gaps.push(`${q.id}:arithmetic-overflow`); statuses.push('unknown'); return null; }
    const scaled = { ...q, value, region: scenario.region };
    if (multiplier !== 1) {
      scaled.status = 'assumed'; scaled.reason = 'workload-assumption'; scaled.source = 'assumption:workload-assumption';
      scaled.bounds = { low: value, base: value, high: value, assumption: 'workload-assumption' };
      statuses.push('assumed');
    }
    const result = priceUsage(q.unit === 'byte-seconds' ? { input: scaled, period: horizon } : scaled, r);
    statuses.push(...result.statuses); gaps.push(...result.gaps); return result.cost;
  };
  const counts = (step, n) => {
    const capacity = selected(step.capacity); const warm = selected(step.warm);
    if (!capacity || capacity.value === null || !warm || warm.value === null) { gaps.push(`${step.id}:not-measured`); return null; }
    if (capacity.status !== 'assumed' || capacity.reason !== 'topology-assumption'
      || capacity.unit !== 'count' || capacity.bounds === null || capacity.value <= 0
      || warm.status !== 'assumed' || warm.reason !== 'topology-assumption' || warm.unit !== 'count') {
      gaps.push(`${step.capacity}:capacity-assumption-required`); statuses.push('unknown'); return null;
    }
    return Math.max(warm.value, Math.ceil(n / capacity.value));
  };
  const fixedFor = (n, recordSteps = false) => {
    const amounts = scenario.lines.filter(l => l.scope === 'platform').map(l => lineCost(l, 1));
    for (const step of scenario.steps) {
      const count = counts(step, n);
      if (recordSteps) steps.push({ id: step.id, count, status: count === null ? 'unknown' : 'assumed' });
      amounts.push(...step.lines.map(l => lineCost(l, count)));
    }
    return sum(amounts);
  };
  requireThat(scenario.lines.every(l => ['platform', 'venue'].includes(l.scope)));
  const fixedAtZero = fixedFor(0); const fixed = fixedFor(venues, true);
  const venue = sum(scenario.lines.filter(l => l.scope === 'venue').map(l => lineCost(l, venues)));
  let total = sum([fixed, venue]);
  if (total !== null && !finite(total)) { total = null; gaps.push('total:arithmetic-overflow'); statuses.push('unknown'); }
  return { fixedAtZero, fixed, venue, total, average: total === null || venues === 0 ? null : total / venues,
    steps, statuses: unique(statuses), gaps: unique(gaps) };
}
