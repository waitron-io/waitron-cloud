import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, mock } from 'node:test';

const target = new URL('./prices.mjs', import.meta.url);
const prices = await import(target.href).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === target.href) return {};
  throw error;
});
const fixtures = JSON.parse(readFileSync(new URL('./test-fixtures/prices.json', import.meta.url)));
const now = '2026-11-06T15:00:00Z';
const source = service => `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/eu-south-2/index.json`;
const body = service => Buffer.from(JSON.stringify(fixtures[service]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function read(service = 'AmazonEC2', doc = fixtures[service], changes = {}) {
  assert.equal(typeof prices.readPriceCatalogue, 'function', 'missing official price reader');
  return prices.readPriceCatalogue({ service, body: Buffer.from(JSON.stringify(doc)), observedAt: now, now, ...changes });
}
const firstProduct = doc => Object.values(doc.products)[0];
const firstTerm = doc => Object.values(Object.values(doc.terms.OnDemand)[0])[0];
const firstDimension = doc => Object.values(firstTerm(doc).priceDimensions)[0];

for (const [service, expected] of [
  ['AmazonEC2', { compute: ['Hrs', '3636000000'], disk: ['GB-Mo', '880000000'] }],
  ['AWSLambda', { lambdaDuration: ['Lambda-GB-Second', '166667'], lambdaRequests: ['Requests', '2000'] }],
  ['AmazonS3', { storage: ['GB-Mo', '230000000'], put: ['Requests', '53000'], get: ['Requests', '4000'] }],
  ['AmazonCloudWatch', { logIngest: ['GB', '5700000000'], logStorage: ['GB-Mo', '300000000'] }],
]) test(`${service} retains exact regional public rates and source-byte identity`, () => {
  const result = read(service);
  assert.equal(result.source, source(service));
  assert.equal(result.digest, hash(body(service)));
  assert.equal(result.version, fixtures[service].version);
  assert.equal(result.publicationDate, fixtures[service].publicationDate);
  assert.equal(result.observedAt, now);
  assert.deepEqual(Object.keys(result.rates).sort(), Object.keys(expected).sort());
  for (const [name, [unit, numerator]] of Object.entries(expected)) {
    assert.equal(result.rates[name].unit, unit);
    assert.equal(result.rates[name].usdNumerator, numerator);
    assert.equal(result.rates[name].usdDenominator, '10000000000');
    assert.ok(result.rates[name].sku);
    assert.ok(result.rates[name].termCode.endsWith('.JRTCKXETXF'));
    assert.ok(result.rates[name].rateCodes.length);
  }
});

test('all Lambda tiers are considered and a later higher rate cannot hide behind tier zero', () => {
  const doc = structuredClone(fixtures.AWSLambda);
  const sku = Object.keys(doc.products).find(s => doc.products[s].attributes.usagetype === 'EUS2-Lambda-GB-Second');
  const term = Object.values(doc.terms.OnDemand[sku])[0];
  Object.values(term.priceDimensions).at(-1).pricePerUnit.USD = '0.0000200000';
  assert.equal(read('AWSLambda', doc).rates.lambdaDuration.usdNumerator, '200000');
});

for (const [label, mutate] of [
  ['foreign offer', d => d.offerCode = 'AmazonS3'],
  ['unknown format', d => d.formatVersion = 'v2'],
  ['missing version', d => delete d.version],
  ['future publication', d => d.publicationDate = '2026-11-07T00:00:00Z'],
  ['invalid publication', d => d.publicationDate = '2026-02-30T00:00:00Z'],
  ['wrong region', d => firstProduct(d).attributes.regionCode = 'us-east-1'],
  ['missing product', d => delete d.products[Object.keys(d.products)[0]]],
  ['wrong instance', d => firstProduct(d).attributes.instanceType = 'm7g.4xlarge'],
  ['wrong tenancy', d => firstProduct(d).attributes.tenancy = 'Dedicated'],
  ['wrong operating system', d => firstProduct(d).attributes.operatingSystem = 'Windows'],
  ['ambiguous product', d => { const p = structuredClone(firstProduct(d)); p.sku = 'DUPLICATE'; d.products.DUPLICATE = p; }],
  ['mismatched SKU', d => firstProduct(d).sku = 'FOREIGN'],
  ['missing terms', d => delete d.terms.OnDemand[Object.keys(d.products)[0]]],
  ['ambiguous terms', d => Object.values(d.terms.OnDemand)[0].extra = structuredClone(firstTerm(d))],
  ['future effective date', d => firstTerm(d).effectiveDate = '2026-11-07T00:00:00Z'],
  ['restricted terms', d => firstTerm(d).termAttributes.Restriction = 'free-tier'],
  ['wrong term SKU', d => firstTerm(d).sku = 'FOREIGN'],
  ['wrong term code', d => firstTerm(d).offerTermCode = 'FOREIGN'],
  ['wrong rate code', d => firstDimension(d).rateCode = 'FOREIGN'],
  ['wrong currency', d => firstDimension(d).pricePerUnit = { EUR: '0.1' }],
  ['mixed currencies', d => firstDimension(d).pricePerUnit.EUR = '0.1'],
  ['negative price', d => firstDimension(d).pricePerUnit.USD = '-0.1'],
  ['exponent price', d => firstDimension(d).pricePerUnit.USD = '1e-7'],
  ['numeric price', d => firstDimension(d).pricePerUnit.USD = 0.1],
  ['free price', d => firstDimension(d).pricePerUnit.USD = '0.0000000000'],
  ['wrong units', d => firstDimension(d).unit = 'Seconds'],
  ['restricted dimension', d => firstDimension(d).appliesTo = ['FOREIGN']],
  ['missing first tier', d => firstDimension(d).beginRange = '1'],
  ['missing final tier', d => firstDimension(d).endRange = '1'],
  ['empty dimensions', d => firstTerm(d).priceDimensions = {}],
]) test(`${label} refuses instead of supplying a cheaper substitute`, () => {
  const doc = structuredClone(fixtures.AmazonEC2); mutate(doc);
  assert.throws(() => read('AmazonEC2', doc), /price/i);
});

for (const [label, changes] of [
  ['unknown service', { service: 'Other' }],
  ['stale observation', { observedAt: '2026-11-05T15:00:00Z' }],
  ['future observation', { observedAt: '2026-11-06T15:00:01Z' }],
  ['invalid current time', { now: '2026-02-30T15:00:00Z' }],
  ['invalid JSON', { body: Buffer.from('{') }],
]) test(`${label} refuses the price evidence`, () => assert.throws(() => read('AmazonEC2', fixtures.AmazonEC2, changes), /price/i));

test('an observation from yesterday refuses even when its catalogue was already published', () => {
  assert.throws(() => read('AmazonEC2', fixtures.AmazonEC2, { now: '2026-11-07T15:00:00Z' }), /price/i);
});

function transport(overrides = {}) {
  const retained = [], calls = [], bytes = body('AmazonEC2');
  const request = async (url, options) => {
    calls.push({ url, options });
    return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { retained, calls, options: { fetch: request, clock: () => Date.parse(now), retain: async value => { retained.push(value); }, ...overrides } };
}
async function acquire(options) {
  assert.equal(typeof prices.acquirePriceCatalogue, 'function', 'missing bounded official acquisition');
  return prices.acquirePriceCatalogue('AmazonEC2', options);
}
test('acquisition fixes the official URL, refuses redirects and retains original bytes before returning evidence', async () => {
  const t = transport(); const result = await acquire(t.options);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, source('AmazonEC2'));
  assert.equal(t.calls[0].options.redirect, 'error');
  assert.equal(t.calls[0].options.credentials, 'omit');
  assert.ok(t.calls[0].options.signal instanceof AbortSignal);
  assert.equal(t.retained.length, 1);
  assert.deepEqual(t.retained[0].body, body('AmazonEC2'));
  assert.equal(t.retained[0].digest, result.digest);
  assert.equal(t.retained[0].source, result.source);
});

test('the official octet-stream content type still requires a valid regional JSON catalogue', async () => {
  const t = transport({ fetch: async () => new Response(body('AmazonEC2'), { headers: { 'content-type': 'application/octet-stream' } }) });
  assert.equal((await acquire(t.options)).rates.compute.usdNumerator, '3636000000');
  const bad = transport({ fetch: async () => new Response('<html>', { headers: { 'content-type': 'application/octet-stream' } }) });
  await assert.rejects(acquire(bad.options), /price/i);
  assert.equal(bad.retained.length, 0);
});

test('ordinary millisecond wall clocks produce a whole-second UTC observation', async () => {
  const t = transport({ clock: () => Date.parse(now) + 123 });
  assert.equal((await acquire(t.options)).observedAt, now);
});

for (const [label, response] of [
  ['HTTP refusal', () => new Response('{}', { status: 503 })],
  ['redirect response', () => new Response('{}', { status: 302 })],
  ['HTML response', () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
  ['JSON bytes with unsupported content type', () => new Response(body('AmazonEC2'), { headers: { 'content-type': 'text/plain' } })],
  ['oversized declared response', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(256 * 1024 * 1024 + 1) } })],
  ['truncated response', () => new Response(body('AmazonEC2'), { headers: { 'content-type': 'application/json', 'content-length': '9999999' } })],
]) test(`${label} cancels the owned body and retains no evidence`, async () => {
  const r = response(), t = transport({ fetch: async () => r });
  await assert.rejects(acquire(t.options), /price/i);
  assert.equal(t.retained.length, 0);
  assert.equal(r.body.locked, false);
});
test('failed raw retention cannot return usable price evidence', async () => {
  const t = transport({ retain: async () => { throw new Error('disk full'); } });
  await assert.rejects(acquire(t.options), /disk full/);
});
test('a day change while saving raw evidence refuses its freshness', async () => {
  let at = now;
  const t = transport({ clock: () => Date.parse(at), retain: async () => { at = '2026-11-07T00:00:00Z'; } });
  await assert.rejects(acquire(t.options), /price/i);
});

for (const [label, mutate] of [
  ['overlapping tiers', d => { const term = Object.values(d.terms.OnDemand).flatMap(Object.values).find(t => Object.keys(t.priceDimensions).length === 3); Object.values(term.priceDimensions)[1].beginRange = '1'; }],
  ['gap between tiers', d => { const term = Object.values(d.terms.OnDemand).flatMap(Object.values).find(t => Object.keys(t.priceDimensions).length === 3); Object.values(term.priceDimensions)[1].beginRange = '6000000001'; }],
]) test(`${label} refuses the whole catalogue`, () => {
  const d = structuredClone(fixtures.AWSLambda); mutate(d);
  assert.throws(() => read('AWSLambda', d), /price/i);
});

test('an undeclared oversized chunk is refused before copying and cancels its reader', async () => {
  let cancelled = 0, released = 0;
  const t = transport({ fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({
    read: async () => ({ done: false, value: Buffer.allocUnsafe(256 * 1024 * 1024 + 1) }),
    cancel: async () => { cancelled++; }, releaseLock: () => { released++; },
  }) } }) });
  await assert.rejects(acquire(t.options), /price/i);
  assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(t.retained.length, 0);
});

for (const stage of ['headers', 'body', 'retention', 'cancellation']) test(`the single absolute deadline also bounds stalled ${stage}`, { timeout: 2000 }, async () => {
  const realTimeout = AbortSignal.timeout;
  const replacement = mock.method(AbortSignal, 'timeout', ms => {
    assert.equal(ms, 30000); return realTimeout(5);
  });
  let cancelled = 0, released = 0;
  const reader = { read: () => new Promise(() => {}), cancel: async () => { cancelled++; }, releaseLock: () => { released++; } };
  const t = transport(stage === 'headers' ? { fetch: () => new Promise(() => {}) }
    : stage === 'body' ? { fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => reader } }) }
    : stage === 'retention' ? { retain: () => new Promise(() => {}) }
    : { fetch: async () => ({ status: 503, body: { cancel: () => new Promise(() => {}) } }) });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(acquire(t.options), stage === 'cancellation' ? /price/i : /timeout|abort/i);
    assert.equal(t.retained.length, 0);
    if (stage === 'body') { assert.equal(cancelled, 1); assert.equal(released, 1); }
  } finally { clearTimeout(keepAlive); replacement.mock.restore(); }
});
