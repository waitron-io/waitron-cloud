import { createHash } from 'node:crypto';

const cap = 10_000_000, limit = 1024 * 1024;
const activeKey = 'd570/ledger/active.json';
const categories = ['compute', 'disk', 'storage', 'requests', 'transfer', 'events', 'lambda', 'logs', 'network', 'tax', 'contingency'];
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hashPattern = /^[a-f0-9]{64}$/, shaPattern = /^[a-f0-9]{40}$/;
const accessExpiry = Date.parse('2027-02-28T23:59:00Z');
const monthKey = month => `d570/ledger/${month}.json`;
const refuse = () => { throw new Error('D570 budget refused: s3 ledger'); };
const check = condition => { if (!condition) refuse(); };
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
function keys(value, names) {
  check(plain(value) && Object.keys(value).sort().join(',') === [...names].sort().join(','));
}
function integer(value) { check(Number.isSafeInteger(value) && value >= 0); return value; }
function time(value) {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value));
  const result = Date.parse(value);
  check(Number.isFinite(result) && new Date(result).toISOString() === value.replace('Z', '.000Z'));
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  check(value === null || ['string', 'boolean', 'number'].includes(typeof value));
  if (typeof value === 'number') integer(value);
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
function checkedScope(scope) {
  keys(scope, ['account', 'region', 'stackId']);
  check(scope.account === '462991287391' && scope.region === 'eu-north-1' && typeof scope.stackId === 'string'
    && /^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570[-a-z0-9]*\/[a-f0-9-]{36}$/.test(scope.stackId));
}
function opening(value) {
  keys(value, ['baselineMicroUsd', 'overheadMicroUsd', 'digest']);
  check(integer(value.baselineMicroUsd) + integer(value.overheadMicroUsd) < cap && matches(hashPattern, value.digest));
}
function priceEvidence(value, scope, now) {
  keys(value, ['observedAt', 'account', 'region', 'currency', 'pricesReconciled', 'billingReconciled', 'protectionHealthy', 'components', 'openings']);
  check(value.account === scope.account && value.region === scope.region && value.currency === 'USD'
    && value.pricesReconciled === true && value.billingReconciled === true && value.protectionHealthy === true);
  check(time(value.observedAt) <= now && value.observedAt.slice(0, 10) === new Date(now).toISOString().slice(0, 10));
  keys(value.components, categories);
  let total = 0;
  for (const component of Object.values(value.components)) {
    keys(component, ['upperMicroUsd', 'source', 'digest']);
    total += integer(component.upperMicroUsd); check(Number.isSafeInteger(total));
    check(typeof component.source === 'string' && component.source.length <= 2048 && matches(hashPattern, component.digest));
    let source; try { source = new URL(component.source); } catch { refuse(); }
    check(source.protocol === 'https:' && ['pricing.us-east-1.amazonaws.com', 'aws.amazon.com'].includes(source.hostname)
      && !source.username && !source.password && !source.port && !source.search && !source.hash);
  }
  check(total > 0 && total < cap && plain(value.openings) && Object.keys(value.openings).length > 0 && Object.keys(value.openings).length <= 13);
  for (const [month, item] of Object.entries(value.openings)) { check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month)); opening(item); }
  return total;
}
function checkedIdentity(identity, now) {
  keys(identity, ['uuid', 'head', 'tree', 'startedAt', 'expiry', 'liabilityUntil']);
  check(matches(uuidPattern, identity.uuid) && matches(shaPattern, identity.head) && matches(shaPattern, identity.tree));
  const start = time(identity.startedAt), expiry = time(identity.expiry), until = time(identity.liabilityUntil);
  check(start <= now && now < expiry && expiry <= accessExpiry && expiry > start && expiry - start <= 8100_000
    && until >= expiry + 30 * 86400_000 && until <= expiry + 31 * 86400_000);
  const months = []; let cursor = new Date(start); cursor.setUTCDate(1); cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= until) { months.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  check(months.length <= 3); return months;
}
async function read(store, key) {
  const result = await store.get(key);
  if (!result) return null;
  check(result.body instanceof Uint8Array && result.body.byteLength > 0 && result.body.byteLength <= limit
    && typeof result.etag === 'string' && result.etag.length > 0 && result.etag.length <= 256);
  let value; try { value = JSON.parse(Buffer.from(result.body).toString('utf8')); } catch { refuse(); }
  check(plain(value));
  if (key === activeKey) {
    const { integrity, ...payload } = value;
    check(matches(hashPattern, integrity) && digest(payload) === integrity);
    value = payload;
  }
  return { value, etag: result.etag };
}
async function write(store, key, value, etag) {
  const serial = key === activeKey ? { ...value, integrity: digest(value) } : value;
  const body = Buffer.from(canonical(serial)); check(body.byteLength <= limit);
  const result = await store.put(key, body, etag ? { ifMatch: etag } : { ifNoneMatch: '*' });
  check(typeof result?.etag === 'string' && result.etag.length > 0 && result.etag.length <= 256);
  return result.etag;
}
function checkedActive(value, scope) {
  keys(value, ['schema', 'scope', 'monthHeads', 'completed', 'active']);
  check(value.schema === 'd570-active-v1' && digest(value.scope) === digest(scope) && plain(value.monthHeads)
    && Object.keys(value.monthHeads).length <= 13 && Array.isArray(value.completed)
    && new Set(value.completed.map(row => row.uuid)).size === value.completed.length);
  for (const row of value.completed) {
    keys(row, ['uuid', 'identityHash', 'evidenceHash', 'observations']);
    check(matches(uuidPattern, row.uuid) && matches(hashPattern, row.identityHash) && matches(hashPattern, row.evidenceHash));
    checkedObservations(row.observations, row.uuid, time(row.observations.observedAt));
  }
  for (const [month, hash] of Object.entries(value.monthHeads)) check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && matches(hashPattern, hash));
  if (value.active !== null) {
    keys(value.active, ['identity', 'upperMicroUsd', 'evidenceHash', 'months', 'evidence', 'state']);
    const a = value.active;
    check(['preparing', 'reserved'].includes(a.state) && matches(hashPattern, a.evidenceHash) && integer(a.upperMicroUsd) > 0 && a.upperMicroUsd < cap);
    check(digest(checkedIdentity(a.identity, time(a.identity.startedAt))) === digest(a.months));
    check(!value.completed.some(row => row.uuid === a.identity.uuid) && digest(a.evidence) === a.evidenceHash
      && priceEvidence(a.evidence, scope, time(a.evidence.observedAt)) === a.upperMicroUsd);
    for (const month of a.months) opening(a.evidence.openings[month]);
  }
}
function checkedMonth(value, scope, month) {
  keys(value, ['schema', 'scope', 'month', 'opening', 'entries']);
  check(value.schema === 'd570-month-v1' && digest(value.scope) === digest(scope) && value.month === month && Array.isArray(value.entries));
  opening(value.opening); const seen = new Set(); let total = value.opening.baselineMicroUsd + value.opening.overheadMicroUsd;
  for (const entry of value.entries) {
    keys(entry, ['identity', 'upperMicroUsd', 'evidenceHash', 'evidence']);
    const months = checkedIdentity(entry.identity, time(entry.identity.startedAt));
    check(months.includes(month) && matches(hashPattern, entry.evidenceHash) && !seen.has(entry.identity.uuid)
      && digest(entry.evidence) === entry.evidenceHash
      && priceEvidence(entry.evidence, scope, time(entry.evidence.observedAt)) === entry.upperMicroUsd);
    seen.add(entry.identity.uuid); total += entry.upperMicroUsd; check(Number.isSafeInteger(total));
  }
  check(total < cap); return total;
}
const booking = active => ({ identity: active.identity, upperMicroUsd: active.upperMicroUsd,
  evidenceHash: active.evidenceHash, evidence: active.evidence });
function checkedObservations(observations, uuid, now) {
  keys(observations, ['uuid', 'observedAt', 'terminated', 'volumesAbsent', 'interfacesAbsent', 'billingReconciled', 'protectionHealthy', 'actualMicroUsd']);
  check(matches(uuidPattern, uuid) && observations.uuid === uuid && time(observations.observedAt) <= now
    && ['terminated', 'volumesAbsent', 'interfacesAbsent', 'billingReconciled', 'protectionHealthy'].every(key => observations[key] === true));
  integer(observations.actualMicroUsd);
}

async function verifyHistory(ledger, store) {
  const active = ledger.active, completed = new Map(ledger.completed.map(row => [row.uuid, row]));
  const months = [...new Set([...Object.keys(ledger.monthHeads), ...(active?.months ?? [])])];
  const inventory = await store.list();
  check(Array.isArray(inventory) && new Set(inventory).size === inventory.length && inventory.includes(activeKey)
    && inventory.every(key => key === activeKey || months.some(month => monthKey(month) === key)));
  const records = new Map(), originals = new Map();
  for (const month of months) {
    const saved = await read(store, monthKey(month)), previous = ledger.monthHeads[month];
    if (!saved) { check(!previous && active?.state === 'preparing' && active.months.includes(month)); continue; }
    checkedMonth(saved.value, ledger.scope, month); records.set(month, saved.value);
    const own = saved.value.entries.find(entry => entry.identity.uuid === active?.identity.uuid);
    if (previous && digest(saved.value) !== previous) {
      check(active?.state === 'preparing' && active.months.includes(month) && own && digest(own) === digest(booking(active)));
      const before = { ...saved.value, entries: saved.value.entries.filter(entry => entry !== own) };
      check(digest(before) === previous);
    } else if (!previous) {
      check(active?.state === 'preparing' && active.months.includes(month) && saved.value.entries.length === 1 && own
        && digest(saved.value.opening) === digest(active.evidence.openings[month]));
    }
    for (const entry of saved.value.entries) {
      const id = entry.identity.uuid, prior = originals.get(id); check(!prior || digest(prior) === digest(entry)); originals.set(id, entry);
      if (id === active?.identity.uuid) check(digest(entry) === digest(booking(active)));
      else {
        const owner = completed.get(id);
        check(owner && owner.identityHash === digest(entry.identity) && owner.evidenceHash === entry.evidenceHash
          && owner.observations.actualMicroUsd <= entry.upperMicroUsd && time(owner.observations.observedAt) >= time(entry.identity.startedAt));
      }
    }
  }
  for (const id of [...completed.keys(), ...(active?.state === 'reserved' ? [active.identity.uuid] : [])]) {
    const original = originals.get(id); check(original);
    for (const month of checkedIdentity(original.identity, time(original.identity.startedAt))) {
      const entry = records.get(month)?.entries.find(row => row.identity.uuid === id);
      check(entry && digest(entry) === digest(original));
    }
  }
  return records;
}

// Reading the bill never replaces the opening or releases an outstanding booking.
export async function inspectBudget({ scope, now, billingMicroUsd, store }) {
  scope = structuredClone(scope); checkedScope(scope);
  const observed = time(now), month = now.slice(0, 7);
  check(integer(billingMicroUsd) < cap);
  const saved = await read(store, activeKey); check(saved); checkedActive(saved.value, scope);
  const ledger = saved.value, records = await verifyHistory(ledger, store);
  const current = records.get(month); check(current);
  for (const row of ledger.completed) check(time(row.observations.observedAt) <= observed);
  if (ledger.active) check(time(ledger.active.identity.startedAt) <= observed);
  let bookedMicroUsd = 0, completedMicroUsd = 0;
  const completed = new Map(ledger.completed.map(row => [row.uuid, row.observations.actualMicroUsd]));
  for (const entry of current.entries) {
    bookedMicroUsd += entry.upperMicroUsd;
    completedMicroUsd += completed.get(entry.identity.uuid) ?? 0;
  }
  const { baselineMicroUsd, overheadMicroUsd } = current.opening;
  check(billingMicroUsd <= baselineMicroUsd + overheadMicroUsd + bookedMicroUsd);
  const latest = await read(store, activeKey);
  check(latest && latest.etag === saved.etag && digest(latest.value) === digest(ledger));
  return { month, baselineMicroUsd, overheadMicroUsd, bookedMicroUsd, completedMicroUsd,
    billingMicroUsd, activeUuid: ledger.active?.identity.uuid ?? null };
}

async function completeBookings(ledger, store) {
  const active = ledger.active, { identity, months } = active, scope = ledger.scope;
  const entry = booking(active), heads = { ...ledger.monthHeads };
  for (const month of months) {
    const saved = await read(store, monthKey(month));
    const value = saved?.value ?? { schema: 'd570-month-v1', scope, month, opening: active.evidence.openings[month], entries: [] };
    checkedMonth(value, scope, month);
    const retained = value.entries.find(e => e.identity.uuid === identity.uuid);
    if (retained) {
      check(digest(retained) === digest(entry));
      if (active.state === 'reserved') check(digest(value) === ledger.monthHeads[month]);
      else {
        const before = { ...value, entries: value.entries.filter(e => e.identity.uuid !== identity.uuid) };
        check(ledger.monthHeads[month] ? digest(before) === ledger.monthHeads[month]
          : before.entries.length === 0 && digest(before.opening) === digest(active.evidence.openings[month]));
      }
    } else {
      check(active.state === 'preparing');
      check(ledger.monthHeads[month] ? saved && digest(value) === ledger.monthHeads[month] : !saved);
      value.entries.push(entry); checkedMonth(value, scope, month);
      await write(store, monthKey(month), value, saved?.etag);
    }
    heads[month] = digest(value);
  }
  return heads;
}

// Initialization is a setup operation. Runtime never recreates lost history.
export async function initializeLedger({ scope, now, evidence, store }) {
  scope = structuredClone(scope); evidence = structuredClone(evidence); checkedScope(scope);
  priceEvidence(evidence, scope, time(now));
  const existing = await store.list(); check(Array.isArray(existing) && existing.length === 0);
  const active = { schema: 'd570-active-v1', scope, monthHeads: {}, completed: [], active: null };
  for (const month of Object.keys(evidence.openings).sort()) {
    const value = { schema: 'd570-month-v1', scope, month, opening: evidence.openings[month], entries: [] };
    await write(store, monthKey(month), value); active.monthHeads[month] = digest(value);
  }
  await write(store, activeKey, active);
}

export async function reserveRun({ scope, identity, evidence, now, store, clock = Date.now }) {
  scope = structuredClone(scope); identity = structuredClone(identity); evidence = structuredClone(evidence);
  checkedScope(scope); const instant = time(now); check(instant < accessExpiry);
  const initialObservation = clock(); check(Number.isSafeInteger(initialObservation) && initialObservation >= instant);
  const upperMicroUsd = priceEvidence(evidence, scope, initialObservation), months = checkedIdentity(identity, initialObservation);
  for (const month of months) opening(evidence.openings[month]);
  const row = await read(store, activeKey); check(row); checkedActive(row.value, scope);
  const ledger = row.value;
  check(new Set([...Object.keys(ledger.monthHeads), ...months]).size <= 13);
  await verifyHistory(ledger, store);
  const desired = { identity, upperMicroUsd, evidenceHash: digest(evidence), months,
    evidence, state: 'preparing' };
  if (ledger.active) check(digest({ ...ledger.active, state: 'preparing' }) === digest(desired));
  else {
    check(!ledger.completed.some(row => row.uuid === identity.uuid));
    // Verify every remembered month, so deleting an old bill cannot reset usage.
    for (const [month, hash] of Object.entries(ledger.monthHeads)) {
      const saved = await read(store, monthKey(month)); check(saved); checkedMonth(saved.value, scope, month); check(digest(saved.value) === hash);
    }
    for (const month of months) {
      const saved = await read(store, monthKey(month));
      if (ledger.monthHeads[month]) {
        check(saved && checkedMonth(saved.value, scope, month) + upperMicroUsd < cap);
        check(evidence.openings[month].baselineMicroUsd <= saved.value.opening.baselineMicroUsd
          && evidence.openings[month].overheadMicroUsd <= saved.value.opening.overheadMicroUsd);
      }
      else { check(!saved); check(evidence.openings[month].baselineMicroUsd + evidence.openings[month].overheadMicroUsd + upperMicroUsd < cap); }
    }
    ledger.active = desired;
    row.etag = await write(store, activeKey, ledger, row.etag);
  }
  const active = ledger.active, heads = await completeBookings(ledger, store);
  if (active.state === 'preparing') {
    ledger.monthHeads = heads; active.state = 'reserved';
    row.etag = await write(store, activeKey, ledger, row.etag);
  }
  const current = await read(store, activeKey);
  check(current && current.etag === row.etag && current.value.active?.state === 'reserved'
    && digest(current.value.active.identity) === digest(identity));
  const observed = clock();
  check(Number.isSafeInteger(observed) && observed >= instant);
  checkedIdentity(identity, observed); priceEvidence(evidence, scope, observed);
  return structuredClone({ ...identity, upperMicroUsd, months, evidenceHash: active.evidenceHash });
}

// Cleanup releases exclusivity, never the month's conservative cost booking.
export async function reconcileRun({ scope, uuid, observations, now, store }) {
  scope = structuredClone(scope); observations = structuredClone(observations); checkedScope(scope);
  checkedObservations(observations, uuid, time(now));
  const saved = await read(store, activeKey); check(saved); checkedActive(saved.value, scope);
  const ledger = saved.value, active = ledger.active;
  await verifyHistory(ledger, store);
  const prior = ledger.completed.find(row => row.uuid === uuid);
  if (prior) { check(digest(prior.observations) === digest(observations)); return; }
  check(active && ['preparing', 'reserved'].includes(active.state) && active.identity.uuid === uuid && time(observations.observedAt) >= time(active.identity.startedAt)
    && integer(observations.actualMicroUsd) <= active.upperMicroUsd);
  if (active.state === 'preparing') ledger.monthHeads = await completeBookings(ledger, store);
  for (const [month, hash] of Object.entries(ledger.monthHeads)) {
    const record = await read(store, monthKey(month)); check(record); checkedMonth(record.value, scope, month); check(digest(record.value) === hash);
  }
  ledger.completed.push({ uuid, identityHash: digest(active.identity), evidenceHash: active.evidenceHash, observations }); ledger.active = null;
  await write(store, activeKey, ledger, saved.etag);
}

// The SDK/client stays in trusted control code. Candidate bytes never supply it.
export function createS3LedgerStore({ bucket, aws }) {
  check(typeof bucket === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) && typeof aws?.call === 'function');
  const validKey = key => check(typeof key === 'string' && (key === activeKey || /^d570\/ledger\/\d{4}-(0[1-9]|1[0-2])\.json$/.test(key)));
  const validEtag = etag => check(typeof etag === 'string' && /^"[\x21\x23-\x7e]{1,254}"$/.test(etag));
  const call = (operation, input) => aws.call(operation, { Bucket: bucket, ExpectedBucketOwner: '462991287391', ...input });
  return {
    async list() {
      const found = new Set(), tokens = new Set(); let token;
      for (let page = 0; page < 20; page++) {
        const result = await call('ListObjectsV2', { Prefix: 'd570/ledger/', MaxKeys: 100, ...(token ? { ContinuationToken: token } : {}) });
        check(Array.isArray(result?.Contents ?? []) && (result.Contents ?? []).length <= 100 && typeof result.IsTruncated === 'boolean');
        for (const row of result.Contents ?? []) { validKey(row.Key); check(!found.has(row.Key)); found.add(row.Key); }
        if (!result.IsTruncated) { check(!result.NextContinuationToken); return [...found]; }
        token = result.NextContinuationToken;
        check(typeof token === 'string' && token.length > 0 && token.length <= 2048 && !tokens.has(token)); tokens.add(token);
      }
      refuse();
    },
    async get(key) {
      validKey(key); let result;
      try { result = await call('GetObject', { Key: key }); }
      catch (error) { if (error.name === 'NoSuchKey' && error.$metadata?.httpStatusCode === 404) return null; throw error; }
      let complete = false;
      try {
        validEtag(result?.ETag); check(Number.isSafeInteger(result.ContentLength) && result.ContentLength > 0 && result.ContentLength <= limit);
        const parts = []; let size = 0;
        const stream = result.Body instanceof Uint8Array ? [result.Body] : result.Body;
        check(stream && (stream[Symbol.asyncIterator] || stream[Symbol.iterator]));
        for await (const part of stream) { check(part instanceof Uint8Array); size += part.byteLength; check(size <= limit); parts.push(Buffer.from(part)); }
        check(size === result.ContentLength);
        complete = true; return { body: Buffer.concat(parts), etag: result.ETag };
      } finally { if (!complete && typeof result?.Body?.destroy === 'function') result.Body.destroy(); }
    },
    async put(key, body, condition) {
      validKey(key); check(body instanceof Uint8Array && body.byteLength > 0 && body.byteLength <= limit && plain(condition));
      let headers;
      if (condition.ifNoneMatch === '*') { keys(condition, ['ifNoneMatch']); headers = { IfNoneMatch: '*' }; }
      else { keys(condition, ['ifMatch']); validEtag(condition.ifMatch); headers = { IfMatch: condition.ifMatch }; }
      const result = await call('PutObject', { Key: key, Body: body, ContentType: 'application/json', ServerSideEncryption: 'AES256', ...headers });
      validEtag(result?.ETag); return { etag: result.ETag };
    },
  };
}
