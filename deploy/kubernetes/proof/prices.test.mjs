import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, mock } from 'node:test';
import { spawnSync } from 'node:child_process';

const target = new URL('./prices.mjs', import.meta.url);
const prices = await import(target.href).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === target.href) return {};
  throw error;
});
const fixtures = JSON.parse(readFileSync(new URL('./test-fixtures/prices.json', import.meta.url)));
const now = '2026-11-06T15:00:00Z';
function shortDeadline() {
  const original = globalThis.setTimeout;
  return mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => original(fn, ms === 30000 ? 5 : ms, ...args));
}
const source = service => `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/eu-north-1/index.json`;
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
  ['AmazonEC2', { compute: ['Hrs', '3468000000'], disk: ['GB-Mo', '836000000'] }],
  ['AWSLambda', { lambdaDuration: ['Lambda-GB-Second', '133334'], lambdaRequests: ['Requests', '2000'] }],
  ['AmazonS3', { storage: ['GB-Mo', '230000000'], put: ['Requests', '50000'], get: ['Requests', '4000'] }],
  ['AmazonCloudWatch', { logIngest: ['GB', '5400000000'], logStorage: ['GB-Mo', '280000000'] }],
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
  const sku = Object.keys(doc.products).find(s => doc.products[s].attributes.usagetype === 'EUN1-Lambda-GB-Second-ARM');
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

for (const [service, usage, field, wrong] of [
  ['AmazonEC2', 'EUN1-BoxUsage:m7g.2xlarge', 'servicecode', 'Other'],
  ['AmazonEC2', 'EUN1-BoxUsage:m7g.2xlarge', 'preInstalledSw', 'SQL Web'],
  ['AmazonEC2', 'EUN1-BoxUsage:m7g.2xlarge', 'capacitystatus', 'UnusedCapacityReservation'],
  ['AmazonEC2', 'EUN1-BoxUsage:m7g.2xlarge', 'operation', 'RunInstances:0002'],
  ['AmazonEC2', 'EUN1-EBS:VolumeUsage.gp3', 'volumeApiName', 'gp2'],
  ['AmazonS3', 'EUN1-TimedStorage-ByteHrs', 'storageClass', 'Infrequent Access'],
  ['AmazonS3', 'EUN1-TimedStorage-ByteHrs', 'volumeType', 'Standard - Infrequent Access'],
  ['AWSLambda', 'EUN1-Lambda-GB-Second-ARM', 'group', 'AWS-Lambda-Duration'],
]) test(`a different ${service} ${field} cannot substitute for the approved product`, () => {
  const doc = structuredClone(fixtures[service]);
  Object.values(doc.products).find(p => p.attributes.usagetype === usage).attributes[field] = wrong;
  assert.throws(() => read(service, doc), /price/i);
});

for (const duplicate of ['"USD":"9.9999999999","USD":"0.0000000001"', '"USD":"9.9999999999","U\\u0053D":"0.0000000001"']) {
  test(`duplicate decoded currency keys cannot hide a higher price: ${duplicate}`, () => {
    const bytes = Buffer.from(body('AmazonEC2').toString().replace('"USD":"0.3468000000"', duplicate));
    assert.throws(() => read('AmazonEC2', fixtures.AmazonEC2, { body: bytes }), /price/i);
  });
}
test('braces, commas and escaped quotes inside a description are ordinary string content', () => {
  const doc = structuredClone(fixtures.AmazonEC2);
  firstDimension(doc).description = 'A string: {"USD":"one","USD":"two"}, [not keys]';
  assert.equal(read('AmazonEC2', doc).rates.compute.usdNumerator, '3468000000');
});
test('invalid UTF-8 cannot silently change catalogue text', () => {
  const doc = structuredClone(fixtures.AmazonEC2); firstDimension(doc).description = 'invalid-byte-marker';
  const bytes = Buffer.from(JSON.stringify(doc)); bytes[bytes.indexOf('invalid-byte-marker')] = 255;
  assert.throws(() => read('AmazonEC2', doc, { body: bytes }), /price/i);
});
test('a zero-width tier cannot precede the otherwise complete paid range', () => {
  const doc = structuredClone(fixtures.AmazonEC2), term = firstTerm(doc), dimension = firstDimension(doc);
  dimension.endRange = '0';
  const code = dimension.rateCode + '.SECOND';
  term.priceDimensions[code] = { ...structuredClone(dimension), rateCode: code, endRange: 'Inf' };
  assert.throws(() => read('AmazonEC2', doc), /price/i);
});
test('internally matching product and term IDs still require the catalogue SKU shape', () => {
  const doc = structuredClone(fixtures.AmazonEC2), old = Object.keys(doc.products)[0], sku = 'BAD';
  doc.products[sku] = { ...doc.products[old], sku }; delete doc.products[old];
  const term = firstTerm(doc), replacement = { ...term, sku, priceDimensions: {} };
  for (const [key, value] of Object.entries(term.priceDimensions)) {
    const code = key.replace(old, sku); replacement.priceDimensions[code] = { ...value, rateCode: code };
  }
  delete doc.terms.OnDemand[old]; doc.terms.OnDemand[sku] = { [`${sku}.${term.offerTermCode}`]: replacement };
  assert.throws(() => read('AmazonEC2', doc), /price/i);
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
  assert.equal((await acquire(t.options)).rates.compute.usdNumerator, '3468000000');
  const bad = transport({ fetch: async () => new Response('<html>', { headers: { 'content-type': 'application/octet-stream' } }) });
  await assert.rejects(acquire(bad.options), /price/i);
  assert.equal(bad.retained.length, 0);
});

test('ordinary millisecond wall clocks produce a whole-second UTC observation', async () => {
  const t = transport({ clock: () => Date.parse(now) + 123 });
  assert.equal((await acquire(t.options)).observedAt, now);
});
test('decoded gzip bytes use the decoded size rather than the compressed content length', async () => {
  const t = transport({ fetch: async () => new Response(body('AmazonEC2'), { headers: {
    'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '123',
  } }) });
  assert.equal((await acquire(t.options)).rates.compute.usdNumerator, '3468000000');
});
test('the measured Stockholm response length fits while decoded price checks remain required', async () => {
  const t = transport({ fetch: async () => new Response(body('AmazonEC2'), { headers: {
    'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '270696312',
  } }) });
  assert.equal((await acquire(t.options)).rates.compute.usdNumerator, '3468000000');
});

for (const [field, value] of [['url', 'https://example.com/catalogue.json'], ['redirected', true]]) {
  test(`an unexpected response ${field} refuses even with valid JSON bytes`, async () => {
    const response = new Response(body('AmazonEC2'), { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, field, { value });
    const t = transport({ fetch: async () => response });
    await assert.rejects(acquire(t.options), /price/i); assert.equal(t.retained.length, 0);
  });
}

for (const [label, response] of [
  ['HTTP refusal', () => new Response('{}', { status: 503 })],
  ['redirect response', () => new Response('{}', { status: 302 })],
  ['HTML response', () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
  ['JSON bytes with unsupported content type', () => new Response(body('AmazonEC2'), { headers: { 'content-type': 'text/plain' } })],
  ['oversized declared response', () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(320 * 1024 * 1024 + 1) } })],
  ['truncated response', () => new Response(body('AmazonEC2'), { headers: { 'content-type': 'application/json', 'content-length': '9999999' } })],
]) test(`${label} cancels the owned body and retains no evidence`, async () => {
  const r = response(), t = transport({ fetch: async () => r });
  const cancellation = mock.method(r.body, 'cancel');
  const reader = mock.method(r.body, 'getReader');
  await assert.rejects(acquire(t.options), /price/i);
  assert.equal(t.retained.length, 0);
  assert.equal(r.body.locked, false);
  if (label !== 'truncated response') { assert.equal(cancellation.mock.callCount(), 1); assert.equal(reader.mock.callCount(), 0); }
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
test('a backwards wall clock during retention refuses', async () => {
  let at = Date.parse(now);
  const t = transport({ clock: () => at, retain: async () => { at -= 1000; } });
  await assert.rejects(acquire(t.options), /price/i);
});
test('the documented same-UTC-day policy permits a later observation within that day', async () => {
  let at = Date.parse(now);
  const t = transport({ clock: () => at, retain: async () => { at += 8 * 3600000; } });
  assert.equal((await acquire(t.options)).observedAt, now);
});

test('synchronous retention cannot return evidence after the elapsed-time deadline', async () => {
  let elapsed = 0;
  const probe = mock.method(performance, 'now', () => elapsed);
  const t = transport({ retain: async () => { elapsed = 30001; } });
  try { await assert.rejects(acquire(t.options), /price|timeout/i); }
  finally { probe.mock.restore(); }
});

test('decoded input is labelled separately from acquired and retained input', async () => {
  assert.equal(read().kind, 'd570-price-decoded-v1');
  assert.equal((await acquire(transport().options)).kind, 'd570-price-acquired-v1');
});

test('a late transport response is cancelled after its deadline was caught', async () => {
  let complete, cancelled = 0;
  const probe = shortDeadline();
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const t = transport({ fetch: () => new Promise(resolve => { complete = resolve; }) });
    await assert.rejects(acquire(t.options), /timeout|abort/i);
    complete({ body: { cancel: async () => { cancelled++; } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, 1);
  } finally { clearTimeout(keepAlive); probe.mock.restore(); }
});

for (const mode of ['idle-process', 'rejected-cancellation']) test(`${mode} exits only after a clean caught deadline`, () => {
  const script = `
    import { acquirePriceCatalogue } from ${JSON.stringify(target.href)};
    const nativeTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => nativeTimeout(5);
    const original = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === 30000 ? 5 : ms, ...args);
    const keepAlive = ${mode === 'idle-process' ? 'null' : 'original(() => {}, 100)'};
    const response = {status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>Promise.reject(new Error('cancel rejected')),releaseLock(){}})}};
    try { await acquirePriceCatalogue('AmazonEC2',{fetch:()=>${mode === 'idle-process' ? 'new Promise(()=>{})' : 'Promise.resolve(response)'},retain:async()=>{}}); throw Error('unexpected success'); }
    catch(error) { if(error.name!=='TimeoutError') throw error; console.log('caught deadline'); }
    await new Promise(resolve=>setImmediate(resolve)); console.log('cleanup continued');
    clearTimeout(keepAlive);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 2000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /caught deadline[\s\S]*cleanup continued/);
  assert.equal(result.stderr, '');
});

for (const [label, mutate] of [
  ['overlapping tiers', d => { const sku = Object.keys(d.products).find(s => d.products[s].attributes.usagetype === 'EUN1-Lambda-GB-Second-ARM'); const term = Object.values(d.terms.OnDemand[sku])[0]; Object.values(term.priceDimensions)[1].beginRange = '1'; }],
  ['gap between tiers', d => { const sku = Object.keys(d.products).find(s => d.products[s].attributes.usagetype === 'EUN1-Lambda-GB-Second-ARM'); const term = Object.values(d.terms.OnDemand[sku])[0]; Object.values(term.priceDimensions)[1].beginRange = '7500000001'; }],
]) test(`${label} refuses the whole catalogue`, () => {
  const d = structuredClone(fixtures.AWSLambda); mutate(d);
  assert.throws(() => read('AWSLambda', d), /price/i);
});

test('an undeclared oversized chunk is refused before copying and cancels its reader', async () => {
  let cancelled = 0, released = 0, copied = false;
  const original = Buffer.from;
  const copy = mock.method(Buffer, 'from', (input, ...args) => {
    if (input instanceof Uint8Array && input.byteLength > 320 * 1024 * 1024) { copied = true; throw Error('oversized copy'); }
    return original(input, ...args);
  });
  const t = transport({ fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({
    read: async () => ({ done: false, value: Buffer.allocUnsafe(320 * 1024 * 1024 + 1) }),
    cancel: async () => { cancelled++; }, releaseLock: () => { released++; },
  }) } }) });
  try {
    await assert.rejects(acquire(t.options), /price/i);
    assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(t.retained.length, 0); assert.equal(copied, false);
  } finally { copy.mock.restore(); }
});

test('mutating a returned stream chunk cannot replace the retained source bytes', async () => {
  const chunk = body('AmazonEC2'); let reads = 0;
  const t = transport({ fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({
    read: async () => { if (reads++ === 0) return { done: false, value: chunk }; chunk.fill(0); return { done: true }; },
    cancel: async () => {}, releaseLock() {},
  }) } }) });
  assert.equal((await acquire(t.options)).digest, hash(body('AmazonEC2')));
  assert.deepEqual(t.retained[0].body, body('AmazonEC2'));
});

test('the exported reader refuses oversized bytes before decoding them', () => {
  let decoded = false;
  const probe = mock.method(TextDecoder.prototype, 'decode', () => { decoded = true; throw Error('unexpected decode'); });
  try {
    assert.throws(() => read('AmazonEC2', fixtures.AmazonEC2, { body: Buffer.allocUnsafe(320 * 1024 * 1024 + 1) }), /price/i);
    assert.equal(decoded, false);
  } finally { probe.mock.restore(); }
});

for (const stage of ['headers', 'body', 'retention', 'cancellation', 'reader-cancellation']) test(`the single absolute deadline also bounds stalled ${stage}`, { timeout: 2000 }, async () => {
  const replacement = shortDeadline();
  let cancelled = 0, released = 0;
  const reader = { read: () => new Promise(() => {}), cancel: async () => { cancelled++; }, releaseLock: () => { released++; } };
  const t = transport(stage === 'headers' ? { fetch: () => new Promise(() => {}) }
    : stage === 'body' ? { fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => reader } }) }
    : stage === 'retention' ? { retain: () => new Promise(() => {}) }
    : stage === 'reader-cancellation' ? { fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({
      read: async () => { throw Error('read failed'); }, cancel: () => new Promise(() => {}), releaseLock() {},
    }) } }) }
    : { fetch: async () => ({ status: 503, body: { cancel: () => new Promise(() => {}) } }) });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(acquire(t.options), stage === 'cancellation' ? /price/i : stage === 'reader-cancellation' ? /read failed/ : /timeout|abort/i);
    assert.equal(t.retained.length, 0);
    if (stage === 'body') { assert.equal(cancelled, 1); assert.equal(released, 1); }
  } finally { clearTimeout(keepAlive); replacement.mock.restore(); }
});

// A unit conversion or rounded-down fraction would silently underbook the paid bill.
const quantityFixture = () => ({ computeSeconds: 3600, diskGiBSeconds: 2419200,
  storageByteSeconds: 2597596220620800, putRequests: 1000, getRequests: 10000,
  lambdaMiBSeconds: 102400, lambdaRequests: 10000, logIngestBytes: 1073741824,
  logStoredByteSeconds: 2597596220620800 });
const fixedFixture = () => Object.fromEntries(['transfer', 'events', 'network', 'tax', 'contingency']
  .map(name => [name, { upperMicroUsd: 10000, source: 'https://aws.amazon.com/pricing/', digest: 'a'.repeat(64) }]));
async function costFixture() {
  const catalogues = {};
  for (const service of Object.keys(fixtures)) catalogues[service] = await prices.acquirePriceCatalogue(service, {
    fetch: async () => new Response(body(service), { headers: { 'content-type': 'application/json' } }),
    clock: () => Date.parse(now), retain: async () => {},
  });
  return { catalogues, quantities: quantityFixture(), fixed: fixedFixture(), now };
}
function calculate(input) {
  assert.equal(typeof prices.calculateManualCost, 'function', 'missing complete manual cost arithmetic');
  return prices.calculateManualCost(input);
}

test('manual cost converts all nine acquired paid rates and retains five reviewed fixed bounds', async () => {
  const input = await costFixture(), result = calculate(input);
  assert.equal(result.observedAt, now);
  assert.deepEqual(Object.fromEntries(Object.entries(result.components).map(([key, row]) => [key, row.upperMicroUsd])), {
    compute: 346800, disk: 83600, storage: 23000, requests: 9000, lambda: 3334, logs: 568000,
    transfer: 10000, events: 10000, network: 10000, tax: 10000, contingency: 10000,
  });
  for (const [category, service] of [['compute', 'AmazonEC2'], ['disk', 'AmazonEC2'], ['storage', 'AmazonS3'],
    ['requests', 'AmazonS3'], ['lambda', 'AWSLambda'], ['logs', 'AmazonCloudWatch']]) {
    assert.equal(result.components[category].source, input.catalogues[service].source);
    assert.equal(result.components[category].digest, input.catalogues[service].digest);
  }
  assert.deepEqual(result.components.tax, input.fixed.tax);
  input.fixed.tax.upperMicroUsd = 1;
  assert.equal(result.components.tax.upperMicroUsd, 10000);
});

test('manual cost rounds each paid subcomponent upward rather than discounting tiny usage', async () => {
  const input = await costFixture();
  for (const key of Object.keys(input.quantities)) input.quantities[key] = 1;
  assert.deepEqual(Object.fromEntries(Object.entries(calculate(input).components).slice(0, 6).map(([key, row]) => [key, row.upperMicroUsd])),
    { compute: 97, disk: 1, storage: 1, requests: 6, lambda: 2, logs: 2 });
});

for (const [label, change] of [
  ['decoded rather than acquired prices', x => x.catalogues.AmazonEC2.kind = 'd570-price-decoded-v1'],
  ['stale price observation', x => x.catalogues.AmazonS3.observedAt = '2026-11-05T15:00:00Z'],
  ['future price observation', x => x.catalogues.AWSLambda.observedAt = '2026-11-06T15:00:01Z'],
  ['foreign source', x => x.catalogues.AmazonCloudWatch.source = 'https://example.invalid/prices'],
  ['wrong unit', x => x.catalogues.AmazonEC2.rates.disk.unit = 'GB'],
  ['missing paid rate', x => delete x.catalogues.AmazonS3.rates.put],
  ['zero paid rate', x => x.catalogues.AWSLambda.rates.lambdaRequests.usdNumerator = '0'],
  ['wrong denominator', x => x.catalogues.AmazonEC2.rates.compute.usdDenominator = '1'],
  ['missing quantity', x => delete x.quantities.getRequests],
  ['fractional quantity', x => x.quantities.computeSeconds = 0.1],
  ['unsafe quantity', x => x.quantities.storageByteSeconds = Number.MAX_SAFE_INTEGER + 1],
  ['missing fixed tax bound', x => delete x.fixed.tax],
  ['zero fixed bound', x => x.fixed.network.upperMicroUsd = 0],
  ['foreign fixed source', x => x.fixed.transfer.source = 'https://example.invalid/prices'],
  ['malformed fixed digest', x => x.fixed.events.digest = 'unknown'],
  ['cap reached', x => x.fixed.contingency.upperMicroUsd = 10000000],
  ['aggregate cap reached', x => x.fixed.contingency.upperMicroUsd = 9000000],
  ['aggregate cap exactly ten dollars', x => x.fixed.contingency.upperMicroUsd = 8926266],
]) test(`manual cost refuses ${label}`, async () => {
  const input = await costFixture(); change(input);
  assert.throws(() => calculate(input), /D570 price evidence refused/);
});

test('manual cost retains fractional charges when every category is already nonzero', async () => {
  const input = await costFixture();
  input.quantities = { computeSeconds: 1, diskGiBSeconds: 3600,
    storageByteSeconds: 92771293593600, putRequests: 1, getRequests: 3,
    lambdaMiBSeconds: 102400, lambdaRequests: 3, logIngestBytes: 1073741824,
    logStoredByteSeconds: 92771293593600 };
  assert.deepEqual(Object.fromEntries(Object.entries(calculate(input).components).slice(0, 6).map(([key, row]) => [key, row.upperMicroUsd])),
    { compute: 97, disk: 125, storage: 822, requests: 7, lambda: 1335, logs: 541000 });
});
