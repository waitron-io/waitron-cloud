import { createHash } from 'node:crypto';

const region = 'eu-north-1', maxBytes = 320 * 1024 * 1024;
const definitions = {
  AmazonEC2: {
    compute: ['Hrs', { usagetype: 'EUN1-BoxUsage:m7g.2xlarge', instanceType: 'm7g.2xlarge', tenancy: 'Shared', operatingSystem: 'Linux', preInstalledSw: 'NA', capacitystatus: 'Used', operation: 'RunInstances' }],
    disk: ['GB-Mo', { usagetype: 'EUN1-EBS:VolumeUsage.gp3', volumeApiName: 'gp3', operation: '' }],
  },
  AWSLambda: {
    lambdaDuration: ['Lambda-GB-Second', { usagetype: 'EUN1-Lambda-GB-Second-ARM', group: 'AWS-Lambda-Duration-ARM' }],
    lambdaRequests: ['Requests', { usagetype: 'EUN1-Request-ARM', group: 'AWS-Lambda-Requests-ARM' }],
  },
  AmazonS3: {
    storage: ['GB-Mo', { usagetype: 'EUN1-TimedStorage-ByteHrs', storageClass: 'General Purpose', volumeType: 'Standard' }],
    put: ['Requests', { usagetype: 'EUN1-Requests-Tier1', group: 'S3-API-Tier1', operation: '' }],
    get: ['Requests', { usagetype: 'EUN1-Requests-Tier2', group: 'S3-API-Tier2', operation: '' }],
  },
  AmazonCloudWatch: {
    logIngest: ['GB', { usagetype: 'EUN1-DataProcessing-Bytes', operation: 'PutLogEvents' }],
    logStorage: ['GB-Mo', { usagetype: 'EUN1-TimedStorage-ByteHrs', operation: '' }],
  },
};
const check = condition => { if (!condition) throw new Error('D570 price evidence refused'); };
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
function time(value) {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value));
  const parsed = Date.parse(value);
  check(Number.isFinite(parsed) && new Date(parsed).toISOString() === value.replace('Z', '.000Z'));
  return parsed;
}
function sourceFor(service) {
  check(Object.hasOwn(definitions, service));
  return `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/${region}/index.json`;
}
function decimal(value) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,10})?$/.test(value));
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(10, '0'));
}
function range(value) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value));
  return BigInt(value);
}
async function bounded(signal, operation) {
  const settled = Promise.resolve(operation);
  // Cancellation can reject immediately after the same deadline already fired.
  settled.catch(() => {});
  signal.throwIfAborted();
  let onAbort;
  const expired = new Promise((resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([settled, expired]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

function rejectDuplicateKeys(text) {
  const stack = [];
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]/g)) {
    if (token === '{') stack.push({ keys: new Set(), expectingKey: true });
    else if (token === '[') stack.push({ keys: null });
    else if (token === '}' || token === ']') stack.pop();
    else {
      const frame = stack.at(-1);
      if (!frame?.keys) continue;
      if (token === ',') frame.expectingKey = true;
      else if (token === ':') frame.expectingKey = false;
      else if (frame.expectingKey) {
        const key = JSON.parse(token);
        check(!frame.keys.has(key)); frame.keys.add(key); frame.expectingKey = false;
      }
    }
  }
}

export function readPriceCatalogue({ service, body, observedAt, now }) {
  const source = sourceFor(service), current = time(now), observed = time(observedAt);
  check(observed <= current && observedAt.slice(0, 10) === now.slice(0, 10));
  check(body instanceof Uint8Array && body.byteLength > 0 && body.byteLength <= maxBytes);
  let doc;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    rejectDuplicateKeys(text);
    doc = JSON.parse(text);
  } catch { check(false); }
  check(plain(doc) && doc.formatVersion === 'v1.0' && doc.offerCode === service
    && typeof doc.version === 'string' && /^\d{14}$/.test(doc.version) && time(doc.publicationDate) <= observed
    && plain(doc.products) && plain(doc.terms?.OnDemand));
  const rates = {};
  for (const [name, [unit, attributes]] of Object.entries(definitions[service])) {
    const products = Object.entries(doc.products).filter(([, product]) => plain(product?.attributes)
      && product.attributes.servicecode === service && product.attributes.regionCode === region
      && Object.entries(attributes).every(([key, value]) => product.attributes[key] === value));
    check(products.length === 1);
    const [sku, product] = products[0];
    check(/^[A-Z0-9]{16}$/.test(sku) && product.sku === sku && plain(doc.terms.OnDemand[sku]));
    const terms = Object.entries(doc.terms.OnDemand[sku]);
    check(terms.length === 1);
    const [termCode, term] = terms[0];
    check(plain(term) && term.sku === sku && term.offerTermCode === 'JRTCKXETXF'
      && termCode === `${sku}.${term.offerTermCode}` && time(term.effectiveDate) <= observed
      && plain(term.termAttributes) && Object.keys(term.termAttributes).length === 0 && plain(term.priceDimensions));
    const dimensions = Object.entries(term.priceDimensions).map(([code, dimension]) => {
      check(plain(dimension) && dimension.rateCode === code && code.startsWith(termCode + '.')
        && dimension.unit === unit && Array.isArray(dimension.appliesTo) && dimension.appliesTo.length === 0
        && plain(dimension.pricePerUnit) && Object.keys(dimension.pricePerUnit).join(',') === 'USD');
      const numerator = decimal(dimension.pricePerUnit.USD), begin = range(dimension.beginRange);
      const end = dimension.endRange === 'Inf' ? null : range(dimension.endRange);
      check(numerator > 0n && (end === null || end > begin));
      return { code, numerator, begin, end };
    }).sort((a, b) => a.begin < b.begin ? -1 : a.begin > b.begin ? 1 : 0);
    check(dimensions.length > 0 && dimensions[0].begin === 0n && dimensions.at(-1).end === null);
    for (let index = 1; index < dimensions.length; index++) check(dimensions[index - 1].end === dimensions[index].begin);
    // No shared free tier or volume discount can reduce the reserved rate.
    const numerator = dimensions.reduce((max, row) => row.numerator > max ? row.numerator : max, 0n);
    rates[name] = { sku, termCode, rateCodes: dimensions.map(row => row.code), unit,
      usdNumerator: String(numerator), usdDenominator: '10000000000' };
  }
  return { kind: 'd570-price-decoded-v1', service, region, source, digest: createHash('sha256').update(body).digest('hex'),
    version: doc.version, publicationDate: doc.publicationDate, observedAt, rates };
}

export async function acquirePriceCatalogue(service, { fetch = globalThis.fetch, clock = Date.now, retain } = {}) {
  const source = sourceFor(service);
  check(typeof fetch === 'function' && typeof clock === 'function' && typeof retain === 'function');
  const deadline = performance.now() + 30_000, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('D570 price acquisition timed out', 'TimeoutError')), 30_000);
  const { signal } = controller;
  let response, reader, finished = false;
  try {
    const pending = Promise.resolve(fetch(source, { redirect: 'error', credentials: 'omit', signal }));
    pending.then(async late => {
      if (finished) { try { await late?.body?.cancel(); } catch { /* Preserve the completed acquisition outcome. */ } }
    }, () => {});
    response = await bounded(signal, pending);
    check(response.status === 200 && !response.redirected && (!response.url || response.url === source)
      && /^application\/(?:json|octet-stream)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') && response.body);
    const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
    check(length === null || /^(0|[1-9][0-9]*)$/.test(length) && Number(length) > 0 && Number(length) <= maxBytes);
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      signal.throwIfAborted();
      const next = await bounded(signal, reader.read());
      signal.throwIfAborted();
      if (next.done) break;
      check(next.value instanceof Uint8Array && next.value.byteLength > 0);
      size += next.value.byteLength; check(size <= maxBytes);
      chunks.push(Buffer.from(next.value));
    }
    check(size > 0 && (length === null || encoding && encoding !== 'identity' || size === Number(length)));
    const body = Buffer.concat(chunks, size);
    const stamp = () => new Date(clock()).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const observedAt = stamp();
    const result = readPriceCatalogue({ service, body, observedAt, now: observedAt });
    await bounded(signal, retain({ service, source, digest: result.digest, observedAt, body }));
    signal.throwIfAborted();
    const after = stamp();
    check(time(after) >= time(observedAt) && after.slice(0, 10) === observedAt.slice(0, 10)
      && performance.now() < deadline);
    return { ...result, kind: 'd570-price-acquired-v1' };
  } catch (error) {
    if (reader) { try { await bounded(signal, reader.cancel()); } catch { /* Preserve the acquisition failure. */ } }
    else if (response?.body) { try { await bounded(signal, response.body.cancel()); } catch { /* Preserve the acquisition failure. */ } }
    throw error;
  } finally {
    finished = true;
    clearTimeout(timer);
    reader?.releaseLock();
  }
}
