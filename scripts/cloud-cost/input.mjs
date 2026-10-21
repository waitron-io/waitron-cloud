const fail = () => { throw new Error('Invalid cloud cost evidence'); };
const requireThat = condition => { if (!condition) fail(); };
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const count = n => Number.isSafeInteger(n) && n >= 0;
const oneOf = (v, values) => requireThat(values.includes(v));
const regions = ['eu-south-2', 'eu-north-1', 'global', 'local'];
const reasons = ['not-measured', 'not-selected', 'not-priced', 'not-observed', 'unsupported-region',
  'workload-assumption', 'topology-assumption', 'schedule-assumption', 'pending-billing', 'unbounded-retention'];
const baseKeys = ['id', 'value', 'status', 'source', 'unit', 'scope', 'region', 'observedAt', 'effectiveAt', 'bounds', 'reason'];
const priceKeys = ['service', 'product', 'sku', 'rateCode', 'attributes', 'currency', 'tier', 'minimum', 'rounding', 'retrievedAt', 'quote'];
const units = ['count', 'bytes', 'byte-seconds', 'seconds', 'months', 'hours', 'GB', 'GiB', 'GB-Mo', 'Hrs', 'Hours',
  'hour', 'hours', 'Requests', 'API Requests', 'Keys', 'Secrets', 'Queries', 'GB-month', 'LCU-Hrs',
  'vCPU', 'vCPU-Hours', 'GB-Hours', 'Metrics', 'Alarms', 'USD', 'minutes', 'GiBps-mo', 'IOPS-Mo', 'HostedZone', 'Mo', 'Events', 'Runs', 'Budget-days', 'Message', 'MBPS-Mo', 'Count'];

function closed(value, keys) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const actual = Reflect.ownKeys(value);
  requireThat(actual.length === keys.length && actual.every(k => keys.includes(k)));
  requireThat(actual.every(k => Object.getOwnPropertyDescriptor(value, k).get === undefined));
}
function date(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));
  requireThat(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
}
function source(value) {
  requireThat(typeof value === 'string');
  if (/^receipt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) return;
  if (value.startsWith('assumption:')) { oneOf(value.slice(11), reasons); return; }
  requireThat(/^https:\/\/pricing\.us-east-1\.amazonaws\.com\/offers\/v1\.0\/aws\/[A-Za-z][A-Za-z0-9]+\/\d{14}\/(eu-south-2|eu-north-1|index\.csv)(\/index\.csv)?$/.test(value)
    || /^https:\/\/aws\.amazon\.com\/(s3|kms|vpc|route53|cloudwatch|eks|fargate|ecr|ses|secrets-manager|ecs)\/pricing\/$/.test(value)
    || value === 'https://aws.amazon.com/ec2/pricing/on-demand/'
    || value === 'https://aws.amazon.com/rds/postgresql/pricing/');
}

function inputUnchecked(input) {
  const priced = Object.getOwnPropertyDescriptor(input ?? {}, 'status')?.value === 'list-priced';
  closed(input, priced ? [...baseKeys, ...priceKeys] : baseKeys);
  requireThat(typeof input.id === 'string' && /^[a-z][a-z0-9-]{1,79}$/.test(input.id));
  oneOf(input.status, ['measured', 'list-priced', 'assumed', 'unknown']);
  oneOf(input.scope, ['platform', 'cell', 'venue', 'usage', 'external']);
  oneOf(input.region, regions); oneOf(input.unit, units);
  if (input.status === 'unknown') requireThat(input.value === null && input.reason !== null);
  else requireThat(finite(input.value));
  if (input.value !== null && ['count', 'months', 'Requests', 'API Requests', 'Keys', 'Secrets', 'Queries', 'HostedZone', 'Count'].includes(input.unit) && !priced) requireThat(count(input.value));
  if (input.reason !== null) oneOf(input.reason, reasons);
  if (input.source !== null) source(input.source);
  for (const key of ['observedAt', 'effectiveAt']) if (input[key] !== null) date(input[key]);
  if (input.bounds !== null) {
    closed(input.bounds, ['low', 'base', 'high', 'assumption']);
    requireThat([input.bounds.low, input.bounds.base, input.bounds.high].every(finite));
    requireThat(input.bounds.low <= input.bounds.base && input.bounds.base <= input.bounds.high);
    oneOf(input.bounds.assumption, reasons);
  }
  if (input.status === 'assumed') requireThat(input.bounds !== null && input.reason !== null && input.source?.startsWith('assumption:'));
  if (input.status === 'measured') requireThat(input.observedAt !== null && input.source?.startsWith('receipt:'));
  if (priced) {
    requireThat(input.source?.startsWith('https:') && input.region !== 'local');
    requireThat(input.observedAt !== null && input.effectiveAt !== null); date(input.retrievedAt);
    requireThat(typeof input.sku === 'string' && /^[A-Z0-9]{16}$/.test(input.sku));
    requireThat(typeof input.rateCode === 'string' && input.rateCode.startsWith(`${input.sku}.`)
      && /^[A-Z0-9.]+$/.test(input.rateCode));
    oneOf(input.currency, ['USD']);
    requireThat(typeof input.service === 'string' && /^[A-Za-z][A-Za-z0-9]+$/.test(input.service));
    requireThat(typeof input.product === 'string' && input.product.length > 0 && input.product.length < 100);
    requireThat(input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes));
    requireThat(input.attributes.regionCode === input.region);
    const publicAttributes = ['regionCode', 'usageType', 'operation', 'Instance Type', 'Database Engine', 'Deployment Option',
      'Operating System', 'Memory', 'vCPU', 'Storage Class', 'From Region Code', 'To Region Code', 'storageClass',
      'billingBytesPerUnit', 'quantityDimension', 'minimumObjectBytes', 'minimumDurationDays', 'standardMetadataBytes',
      'archiveMetadataBytes', 'proration', 'minimumDurationSeconds', 'billingDurationRoundSeconds'];
    requireThat(Reflect.ownKeys(input.attributes).every(k => publicAttributes.includes(k)));
    requireThat(Object.values(input.attributes).every(v => typeof v === 'string' && v.length < 200));
    closed(input.tier, ['begin', 'end']); requireThat(finite(input.tier.begin));
    requireThat(input.tier.end === null || (finite(input.tier.end) && input.tier.end > input.tier.begin));
    closed(input.minimum, ['quantity', 'unit']); requireThat(input.minimum.quantity === null || finite(input.minimum.quantity));
    oneOf(input.minimum.unit, units);
    closed(input.rounding, ['quantum', 'mode']); oneOf(input.rounding.mode, ['none', 'ceil', 'unknown']);
    requireThat(input.rounding.quantum === null || (finite(input.rounding.quantum) && input.rounding.quantum > 0));
    requireThat(typeof input.quote === 'string' && input.quote.trim().length > 0 && input.quote.trim().split(/\s+/).length <= 25);
  }
  return structuredClone(input);
}
export function validateInput(input) {
  try { return inputUnchecked(input); } catch { fail(); }
}
