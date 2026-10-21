const fail = () => { throw Error('Invalid cloud cost billing evidence'); };
const need = value => { if (!value) fail(); };
const finite = value => need(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
const date = value => { need(typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value); return Date.parse(value); };
const exact = (value, keys) => need(value && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
function plain(value, ancestors = new Set(), budget = { left: 20000 }) {
  need(--budget.left >= 0 && ancestors.size < 24);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { finite(value); return; }
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
const dimensions = ['service', 'usageType', 'region', 'operation', 'unit', 'startedAt', 'endedAt'];
function line(row, observed) {
  exact(row, ['id', ...dimensions, 'amount', 'quantity', ...(observed ? ['recordType', 'attribution'] : [])]);
  need(typeof row.id === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(row.id));
  for (const key of ['service', 'usageType', 'operation', 'unit']) need(typeof row[key] === 'string' && /^[A-Za-z0-9:._-]{1,120}$/.test(row[key]));
  need(['eu-north-1', 'eu-south-2', 'global', 'unknown'].includes(row.region));
  need(date(row.endedAt) > date(row.startedAt)); finite(row.amount); finite(row.quantity); need(row.quantity >= 0);
  if (observed) {
    need(['Usage', 'Credit'].includes(row.recordType));
    need(['exclusive-run', 'prior-key', 'other-activity', 'ambiguous'].includes(row.attribution));
  }
  need(observed && row.recordType === 'Credit' ? row.amount <= 0 : row.amount >= 0);
}
const signature = row => JSON.stringify(dimensions.map(key => row[key]));

// Account dimensions do not identify a key or lane. Attribution is a separate
// reviewed input; a shared dimension or an ambiguous line remains unmatched.
export function compareUsage(input) {
  try {
    plain(input); exact(input, ['predicted', 'observed', 'window']); exact(input.window, ['startedAt', 'endedAt']);
    need(date(input.window.endedAt) > date(input.window.startedAt));
    need(Array.isArray(input.predicted) && input.predicted.length > 0
      && (input.observed === null || Array.isArray(input.observed)));
    const predictedIds = new Set(), observedIds = new Set(), groups = new Map();
    for (const row of input.predicted) {
      line(row, false); need(!predictedIds.has(row.id)); predictedIds.add(row.id);
      need(row.startedAt === input.window.startedAt && row.endedAt === input.window.endedAt && row.region !== 'unknown');
      const key = signature(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
    }
    const unmatched = [], credits = [], accumulated = new Map();
    for (const row of input.observed ?? []) {
      line(row, true); need(!observedIds.has(row.id)); observedIds.add(row.id);
      if (row.attribution !== 'exclusive-run') { unmatched.push({ id: row.id, reason: row.attribution }); continue; }
      const candidates = groups.get(signature(row)) ?? [];
      if (candidates.length !== 1 || row.region === 'unknown') {
        unmatched.push({ id: row.id, reason: candidates.length > 1 ? 'shared-dimension' : 'dimension-or-window' }); continue;
      }
      if (row.recordType === 'Credit') { credits.push({ id: row.id, predictedId: candidates[0].id, amount: row.amount }); continue; }
      if (row.amount === 0 && row.quantity === 0) { unmatched.push({ id: row.id, reason: 'zero-pending' }); continue; }
      const id = candidates[0].id;
      if (!accumulated.has(id)) accumulated.set(id, { amount: 0, quantity: 0, rows: [] });
      const sum = accumulated.get(id); sum.amount += row.amount; sum.quantity += row.quantity; sum.rows.push(row.id);
      finite(sum.amount); finite(sum.quantity);
    }
    const matched = [], pending = [], variance = [];
    for (const row of input.predicted) {
      const sum = accumulated.get(row.id);
      if (!sum) { pending.push(row.id); continue; }
      const difference = Math.abs(sum.amount - row.amount), ratio = row.amount === 0 ? null : difference / row.amount;
      const quantityDifference = Math.abs(sum.quantity - row.quantity), quantityRatio = row.quantity === 0 ? null : quantityDifference / row.quantity;
      const exceeds = (difference, expected, actual) => expected === 0 ? actual > 0
        : difference > expected * 0.2 + Number.EPSILON * Math.max(expected, actual) * 4;
      const requiresExplanation = exceeds(difference, row.amount, sum.amount) || exceeds(quantityDifference, row.quantity, sum.quantity);
      matched.push({ id: row.id, predictedAmount: row.amount, observedAmount: sum.amount,
        predictedQuantity: row.quantity, observedQuantity: sum.quantity, observedRows: sum.rows });
      variance.push({ id: row.id, difference, ratio, quantityDifference, quantityRatio, requiresExplanation });
    }
    return { matched, unmatched, credits, pending, variance,
      complete: pending.length === 0 && unmatched.length === 0 && !variance.some(row => row.requiresExplanation) };
  } catch { fail(); }
}

// This plans one request and its required prior journal debit. It performs no
// network I/O or retries; a future caller must persist that debit before sending.
export function nextBillingCall(checkpoint, now) {
  try {
    plain(checkpoint); exact(checkpoint, ['window', 'region', 'dueAt', 'callsUsed', 'maxCalls', 'usage', 'credit', 'continuation']);
    exact(checkpoint.window, ['startedAt', 'endedAt']);
    const start = date(checkpoint.window.startedAt), end = date(checkpoint.window.endedAt);
    need(end - start === 86400000 && checkpoint.window.startedAt.endsWith('T00:00:00.000Z')
      && checkpoint.window.endedAt.endsWith('T00:00:00.000Z'));
    need(checkpoint.region === 'eu-north-1' && checkpoint.maxCalls === 3
      && Number.isSafeInteger(checkpoint.callsUsed) && checkpoint.callsUsed >= 0 && checkpoint.callsUsed <= 3);
    need(['unread', 'incomplete', 'complete'].includes(checkpoint.usage)
      && ['unread', 'incomplete', 'complete'].includes(checkpoint.credit));
    need(checkpoint.usage === 'complete' || checkpoint.credit === 'unread');
    need(checkpoint.callsUsed >= Number(checkpoint.usage !== 'unread') + Number(checkpoint.credit !== 'unread'));
    const due = date(checkpoint.dueAt); need(due >= end); const time = date(now);
    if (checkpoint.continuation !== null) {
      exact(checkpoint.continuation, ['recordType', 'token']);
      const c = checkpoint.continuation;
      need(['Usage', 'Credit'].includes(c.recordType) && checkpoint[c.recordType.toLowerCase()] === 'incomplete'
        && typeof c.token === 'string' && c.token.length > 0 && c.token.length <= 8192);
    }
    if (time < due) return { pending: true, reason: 'not-due', request: null };
    if (checkpoint.usage === 'complete' && checkpoint.credit === 'complete') return { pending: false, reason: 'reads-complete', request: null };
    if (checkpoint.callsUsed === 3) return { pending: true, reason: 'call-budget-exhausted', request: null };
    const recordType = checkpoint.continuation?.recordType ?? (checkpoint.usage !== 'complete' ? 'Usage' : 'Credit');
    const request = { TimePeriod: { Start: checkpoint.window.startedAt.slice(0, 10), End: checkpoint.window.endedAt.slice(0, 10) },
      Granularity: 'DAILY', Filter: { Dimensions: { Key: 'RECORD_TYPE', Values: [recordType] } },
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }],
      Metrics: ['UnblendedCost', 'UsageQuantity'], ...(checkpoint.continuation ? { NextPageToken: checkpoint.continuation.token } : {}) };
    return { pending: false, reason: 'planned-read', request, debitBeforeDispatch: 1, callsRemainingAfterDebit: 2 - checkpoint.callsUsed };
  } catch { fail(); }
}
