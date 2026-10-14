import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { validateInput, validateReceipt, exportAggregate, assertOwnedRoot } from './schema.mjs';

const instant = '2026-10-14T12:00:00.000Z';
function input(overrides = {}) {
  return { id: 'orders-per-day', value: null, status: 'unknown', source: null,
    unit: 'count', scope: 'venue', region: 'eu-south-2', observedAt: null,
    effectiveAt: null, bounds: null, reason: 'not-measured', ...overrides };
}
function price() {
  return input({ id: 's3-standard-storage', value: 0.01, status: 'list-priced',
    source: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv',
    unit: 'GB-Mo', scope: 'usage', observedAt: instant, effectiveAt: instant, reason: null,
    service: 'AmazonS3', product: 'Storage', sku: 'ABCDEFGH12345678', rateCode: 'ABCDEFGH12345678.JRTCKXETXF.6YS6EN2CT7',
    attributes: { regionCode: 'eu-south-2', storageClass: 'General Purpose' }, currency: 'USD',
    tier: { begin: 0, end: null }, minimum: { quantity: 0, unit: 'GB-Mo' },
    rounding: { quantum: null, mode: 'unknown' }, retrievedAt: instant, quote: 'Standard storage' });
}
function receipt() {
  return { schemaVersion: 1, runId: randomUUID(), cloudRevision: 'a'.repeat(40), waitronRevision: 'b'.repeat(40),
    kind: 'local-aggregate', dataBoundary: { classification: 'anonymous-aggregate', rawIncluded: false, exportSchema: 1 },
    window: { startedAt: instant, endedAt: '2026-10-14T12:01:00.000Z', elapsedSeconds: 60 },
    cadence: { mode: 'accelerated', factor: 2, coveredSeconds: 120,
      configuredSchedule: { snapshotSeconds: 86400, retentionSeconds: 604800 }, observedSchedule: null },
    inputs: [input()], accounting: { requests: [], objects: [],
      producer: { attempts: 0, bytesIn: 0, bytesOut: 0 }, observer: { attempts: 0, bytesIn: 0, bytesOut: 0 },
      discrepancy: { attempts: 0, bytesIn: 0, bytesOut: 0 } },
    checks: [{ code: 'no-raw-data', passed: true, count: 1 }],
    cleanup: { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0, ownedVolumes: 0,
      ownedObjects: 0, residualKinds: [] } };
}
const refused = fn => assert.throws(fn, { message: 'Invalid cloud cost evidence' });

test('unknownIsNotZero', () => {
  assert.equal(validateInput(input()).value, null);
  refused(() => validateInput(input({ value: 0 })));
  refused(() => validateInput(input({ status: 'measured' })));
  refused(() => validateInput(input({ value: -1, status: 'assumed' })));
});
test('priceNeedsRegionSkuUnitDate', () => {
  assert.equal(validateInput(price()).value, 0.01);
  for (const key of ['sku', 'rateCode', 'region', 'unit', 'retrievedAt', 'effectiveAt', 'source']) {
    const p = price(); p[key] = null; refused(() => validateInput(p));
  }
  const p = price(); p.attributes.regionCode = 'eu-north-1'; refused(() => validateInput(p));
});
test('extraFieldAndRawCanaryRefused', () => {
  for (const target of [r => r, r => r.window, r => r.cadence, r => r.inputs[0],
    r => r.accounting, r => r.accounting.observer, r => r.checks[0], r => r.cleanup, r => r.dataBoundary]) {
    const r = receipt(); target(r).rawCanary = 'PRIVATE_SYNTHETIC_CANARY';
    refused(() => validateReceipt(r)); refused(() => exportAggregate(r));
  }
});
test('knownFieldsCannotCarryRawNamesPathsOrErrors', () => {
  for (const [key, value] of [['id', 'PRIVATE_SYNTHETIC_CANARY'], ['reason', 'PRIVATE_SYNTHETIC_CANARY'],
    ['source', '/private/example/venue.db'], ['source', 'https://aws.amazon.com/s3/pricing/?name=PRIVATE_SYNTHETIC_CANARY']]) {
    const r = receipt(); r.inputs[0][key] = value; refused(() => exportAggregate(r));
  }
  const r = receipt(); r.checks[0].code = 'PRIVATE_SYNTHETIC_CANARY'; refused(() => exportAggregate(r));
});
test('validAnonymousExportIsDetached', () => {
  const r = receipt(); const exported = exportAggregate(r);
  assert.deepEqual(exported, r); assert.notEqual(exported, r);
  r.inputs[0].value = 123; assert.equal(exported.inputs[0].value, null);
});
test('windowAndCadenceAreHonest', () => {
  const r = receipt(); r.window.elapsedSeconds = 0; refused(() => validateReceipt(r));
  r.window.elapsedSeconds = 60; r.cadence.factor = 0; refused(() => validateReceipt(r));
  r.cadence.factor = 2; r.window.endedAt = 'not-a-date'; refused(() => validateReceipt(r));
});
function roots(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-schema-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const source = join(parent, 'source'); const root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'); const path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, root, source, ownershipToken: token }), { mode: 0o600 });
  return { source, root, journal: { path, token }, parent };
}
test('sourceOverlapAndSymlinkRefused', t => {
  const args = roots(t); assert.doesNotThrow(() => assertOwnedRoot(args));
  refused(() => assertOwnedRoot({ ...args, root: args.source }));
  refused(() => assertOwnedRoot({ ...args, source: args.parent }));
  symlinkSync(args.source, join(args.root, 'escape')); refused(() => assertOwnedRoot(args));
});
test('privatePermissionsAndOwnershipRequired', t => {
  const args = roots(t); chmodSync(args.root, 0o755); refused(() => assertOwnedRoot(args));
  chmodSync(args.root, 0o700); chmodSync(args.journal.path, 0o644); refused(() => assertOwnedRoot(args));
  chmodSync(args.journal.path, 0o600); refused(() => assertOwnedRoot({ ...args, journal: { ...args.journal, token: 'c'.repeat(64) } }));
});
test('attemptsRetriesVersionsAndDiscrepancyArePreserved', () => {
  const r = receipt(); r.accounting.requests.push({ phase: 'workload', operation: 'put', requestClass: 's3-write',
    outcome: 'success', retryOrdinal: 1, attempts: 1, successful: 1, failed: 0, retried: 1,
    bytesIn: 0, bytesOut: 32, attemptedBytesIn: 0, attemptedBytesOut: 32 });
  r.accounting.objects.push({ class: 'stream', bytes: 32, byteSeconds: 1920, currentVersions: 1,
    noncurrentVersions: 1, deleteMarkers: 1, unfinishedMultipart: 1 });
  r.accounting.producer = { attempts: 1, bytesIn: 0, bytesOut: 32 };
  r.accounting.observer = { attempts: 2, bytesIn: 0, bytesOut: 32 };
  r.accounting.discrepancy = { attempts: 1, bytesIn: 0, bytesOut: 0 };
  assert.deepEqual(exportAggregate(r), r);
  r.accounting.discrepancy.attempts = 0; refused(() => validateReceipt(r));
});
test('malformedAndNonfiniteEvidenceRefusedWithoutEcho', () => {
  for (const value of [null, [], 'PRIVATE_SYNTHETIC_CANARY', {}, { ...receipt(), unexpected: 1 }]) refused(() => validateReceipt(value));
  for (const value of [NaN, Infinity, -1]) {
    const r = receipt(); r.accounting.producer.bytesIn = value; refused(() => validateReceipt(r));
  }
  const r = receipt(); r.accounting.requests.push({ key: 'PRIVATE_SYNTHETIC_CANARY' }); refused(() => exportAggregate(r));
});
test('journalSymlinkAndNestedLinkRefused', t => {
  const args = roots(t); const aliased = join(args.parent, 'alias'); symlinkSync(args.root, aliased);
  refused(() => assertOwnedRoot({ ...args, root: aliased }));
  symlinkSync(args.journal.path, join(args.root, 'journal-alias'));
  refused(() => assertOwnedRoot({ ...args, journal: { ...args.journal, path: join(args.root, 'journal-alias') } }));
});
test('scratchInsideCheckoutRefused', t => {
  const args = roots(t); mkdirSync(join(args.root, '.git'));
  refused(() => assertOwnedRoot(args));
});
test('producerTotalsMatchEveryAttempt', () => {
  const r = receipt(); r.accounting.producer.attempts = 1; r.accounting.observer.attempts = 1;
  refused(() => validateReceipt(r));
});
test('invalidAccessorsDoNotEchoRawException', () => {
  const p = input(); Object.defineProperty(p, 'status', { get() { throw new Error('PRIVATE_SYNTHETIC_CANARY'); }, enumerable: true });
  refused(() => validateInput(p));
});
test('providerUnitsRemainExact', () => {
  for (const unit of ['GiBps-mo', 'IOPS-Mo', 'HostedZone', 'Mo', 'Events', 'Runs', 'Budget-days', 'Message']) {
    const p = price(); p.unit = unit; p.minimum.unit = unit; assert.doesNotThrow(() => validateInput(p)); assert.equal(validateInput(p).unit, unit);
  }
});
test('inventoryCoversRuntimeAndRequiredCapabilitiesWithNamedGaps', () => {
  const path = new URL('../../docs/cost-model/inventory.json', import.meta.url);
  assert.ok(existsSync(path), 'public inventory must exist');
  const inventory = JSON.parse(readFileSync(path, 'utf8'));
  const compose = readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8');
  const services = [...compose.split('services:\n')[1].split('\nvolumes:')[0].matchAll(/^  ([a-z-]+):$/gm)].map(m => m[1]);
  assert.deepEqual(inventory.runtimeRoles.map(r => r.role).sort(), services.sort());
  for (const capability of ['control-plane', 'database', 'ingress', 'networking', 'dns-identity', 'keys',
    'storage', 'recovery', 'operations', 'email-external', 'optional-product']) {
    assert.ok(inventory.rows.some(r => r.capability === capability), capability);
  }
  const ids = new Set(inventory.rows.map(r => r.id)); assert.equal(ids.size, inventory.rows.length);
  for (const row of inventory.rows) {
    assert.ok(row.reason && row.driver && row.dimensions.length && row.sources.length);
    assert.ok(['required', 'candidate', 'excluded'].includes(row.inclusion));
    assert.ok(['platform', 'cell', 'venue', 'usage', 'external'].includes(row.scope));
    for (const dependency of row.dependsOn) assert.ok(ids.has(dependency));
    assert.ok(row.priceIds.length || row.gap, row.id);
  }
  for (const s of inventory.scenarios) {
    assert.equal(s.status, 'assumed'); assert.equal(s.capacity.value, null);
    assert.equal(s.capacity.status, 'unknown'); assert.ok(s.reason);
  }
});
test('publicPricesValidateAndQuotesStayWithinSourceBudget', () => {
  const path = new URL('../../docs/cost-model/prices.json', import.meta.url);
  assert.ok(existsSync(path), 'dated regional prices must exist');
  const prices = JSON.parse(readFileSync(path, 'utf8')); const quotes = new Map();
  assert.ok(prices.records.length > 0);
  for (const p of prices.records) {
    assert.doesNotThrow(() => validateInput(p), p.id);
    quotes.set(p.source, (quotes.get(p.source) ?? 0) + p.quote.trim().split(/\s+/).length);
  }
  for (const [url, words] of quotes) assert.ok(words <= 25, `quote budget ${url}`);
  for (const region of ['eu-south-2', 'eu-north-1']) {
    for (const id of ['ec2-t3-small', 'rds-t4g-micro-single', 's3-standard-storage', 's3-write', 's3-read', 'kms-key', 'kms-symmetric']) {
      assert.ok(prices.records.some(p => p.id === id && p.region === region), `${region} ${id}`);
    }
  }
  assert.ok(prices.unavailable.some(v => v.service === 'AmazonSES' && v.region === 'eu-south-2'));
  assert.ok(prices.external.some(v => v.id === 'external-mail' && v.status === 'unknown' && v.value === null));
  assert.equal(prices.accounting.grossBeforeAllowancesCreditsTax, true);
});
test('priceAttributesAreClosedPublicDimensions', () => {
  const p = price(); p.attributes.payload = 'PRIVATE_SYNTHETIC_CANARY'; refused(() => validateInput(p));
});
test('fractionalCountsAndContradictoryEvidenceRefused', () => {
  const r = receipt(); r.inputs[0] = input({ value: 1.5, status: 'assumed',
    source: 'assumption:workload-assumption', reason: 'workload-assumption',
    bounds: { low: 1, base: 1.5, high: 2, assumption: 'workload-assumption' } });
  refused(() => validateReceipt(r));
});
test('allowedSyntaxStillNeedsAnonymousId', () => {
  const r = receipt(); r.inputs[0].id = 'private-synthetic-canary'; refused(() => exportAggregate(r));
});
test('markerAndJournalMustIndependentlyMatch', t => {
  const args = roots(t);
  writeFileSync(join(args.root, '.cloud-cost-owner'), 'c'.repeat(64)); refused(() => assertOwnedRoot(args));
  writeFileSync(join(args.root, '.cloud-cost-owner'), args.journal.token);
  for (const patch of [{ ownershipToken: 'c'.repeat(64) }, { root: args.source }, { source: args.root }, { schemaVersion: 2 }]) {
    writeFileSync(args.journal.path, JSON.stringify({ schemaVersion: 1, root: args.root, source: args.source, ownershipToken: args.journal.token, ...patch }));
    refused(() => assertOwnedRoot(args));
  }
});
test('everyReceiptFieldHasBoundedTypes', () => {
  const mutations = [r => r.schemaVersion = 2, r => r.runId = 'private-synthetic-canary',
    r => r.cloudRevision = 'private-synthetic-canary', r => r.waitronRevision = null,
    r => r.kind = 'real-data', r => r.dataBoundary.rawIncluded = true,
    r => r.cadence.mode = 'whole-day', r => r.cadence.configuredSchedule.snapshotSeconds = -1,
    r => r.cadence.observedSchedule = { payload: 'private-synthetic-canary' },
    r => r.cleanup.ownedContainers = -1, r => r.cleanup.residualKinds = ['private-synthetic-canary'],
    r => r.checks[0].passed = 'yes', r => r.checks[0].count = -1,
    r => r.inputs.push(structuredClone(r.inputs[0])), r => r.accounting.discrepancy.bytesIn = NaN,
    r => r.accounting.observer.attempts = -1];
  for (const mutate of mutations) { const r = receipt(); mutate(r); refused(() => exportAggregate(r)); }
});
test('measuredAndAssumedInputsNeedTheirEvidence', () => {
  const measured = input({ status: 'measured', value: 2, source: `receipt:${randomUUID()}`, observedAt: instant });
  assert.equal(validateInput(measured).value, 2);
  refused(() => validateInput({ ...measured, source: null }));
  refused(() => validateInput({ ...measured, observedAt: null }));
  const assumed = input({ status: 'assumed', value: 2, reason: 'workload-assumption', source: 'assumption:workload-assumption',
    bounds: { low: 1, base: 2, high: 3, assumption: 'workload-assumption' } });
  assert.equal(validateInput(assumed).value, 2);
  refused(() => validateInput({ ...assumed, bounds: null }));
  refused(() => validateInput({ ...assumed, source: null }));
  refused(() => validateInput({ ...assumed, bounds: { ...assumed.bounds, low: 4 } }));
  refused(() => validateInput({ ...assumed, id: 'idle-bytes', unit: 'bytes', value: NaN }));
});
test('consistentJournalCannotAuthoriseSourceOverlap', t => {
  const args = roots(t);
  writeFileSync(args.journal.path, JSON.stringify({ schemaVersion: 1, root: args.root, source: args.parent, ownershipToken: args.journal.token }));
  refused(() => assertOwnedRoot({ ...args, source: args.parent }));
});
test('consistentJournalCannotAuthoriseAliasedAncestor', t => {
  const args = roots(t); const alias = join(args.parent, 'alias'); symlinkSync(args.parent, alias);
  const root = join(alias, 'owned'); const path = join(root, 'journal.json');
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, root, source: args.source, ownershipToken: args.journal.token }));
  refused(() => assertOwnedRoot({ ...args, root, journal: { ...args.journal, path } }));
});
test('inputMetadataAndRangesRejectInvalidValues', () => {
  for (const patch of [{ status: 'estimated', value: 0 }, { scope: 'customer' }, { region: 'eu-west-1' }, { unit: 'rows' }]) {
    refused(() => validateInput(input(patch)));
  }
  const mutations = [p => p.status = 'estimated', p => p.scope = 'customer', p => p.region = 'eu-west-1',
    p => p.unit = 'rows', p => p.id = 'PRIVATE_SYNTHETIC_CANARY', p => p.reason = 'private-synthetic-canary',
    p => p.observedAt = '2026-02-30T12:00:00.000Z', p => p.effectiveAt = '2026-10-14',
    p => p.attributes.regionCode = 'eu-north-1', p => p.sku = 'invalid', p => p.rateCode = 'OTHER.JRTCKXETXF',
    p => p.currency = 'EUR', p => p.tier.begin = -1, p => p.tier.end = -1,
    p => p.minimum.quantity = -1, p => p.rounding.quantum = 0, p => p.rounding.mode = 'down', p => p.quote = ''];
  for (const mutate of mutations) { const p = price(); mutate(p); refused(() => validateInput(p)); }
});
test('nestedAccessorCannotLeakPrivateError', () => {
  const p = price(); Object.defineProperty(p.attributes, 'regionCode', { get() { throw new Error('PRIVATE_SYNTHETIC_CANARY'); }, enumerable: true });
  refused(() => validateInput(p));
  const r = receipt(); Object.defineProperty(r.window, 'startedAt', { get() { throw new Error('PRIVATE_SYNTHETIC_CANARY'); }, enumerable: true });
  refused(() => exportAggregate(r));
});
test('arrayAccessorCannotLeakPrivateError', () => {
  const r = receipt(); Object.defineProperty(r.inputs, '0', { get() { throw new Error('PRIVATE_SYNTHETIC_CANARY'); }, enumerable: true });
  refused(() => validateReceipt(r)); refused(() => exportAggregate(r));
});
