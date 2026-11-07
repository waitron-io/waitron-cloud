import { readFileSync } from 'node:fs';

const refuse = () => { throw new Error('D570 deadline bootstrap refused'); };
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) refuse();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value.replace('Z', '.000Z')) refuse();
  return milliseconds / 1000;
}

export function renderDeadlineBootstrap({ scope, reservation } = {}) {
  if (scope?.account !== '462991287391' || scope.region !== 'eu-north-1'
    || typeof scope.stackId !== 'string' || !/^arn:aws:cloudformation:eu-north-1:462991287391:stack\/d570[-a-z0-9]*\/[a-f0-9-]{36}$/.test(scope.stackId)
    || typeof reservation?.uuid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(reservation.uuid)
    || ![reservation.head, reservation.tree].every(value => typeof value === 'string' && /^(?!0{40}$)[a-f0-9]{40}$/.test(value))) refuse();
  const start = time(reservation.startedAt), expiry = time(reservation.expiry);
  if (expiry <= start || expiry - start > 8100 || expiry > time('2027-02-28T23:59:00Z')) refuse();
  const identity = [scope.stackId, reservation.uuid, reservation.head, reservation.tree, start, expiry].join(' ');
  const values = {
    '@IDENTITY@': identity, '@RUN@': reservation.uuid, '@START@': String(start), '@EXPIRY@': String(expiry),
    '@CALENDAR@': reservation.expiry.replace('T', ' ').replace('Z', ' UTC'),
  };
  let source = readFileSync(new URL('./bootstrap.sh', import.meta.url), 'utf8');
  for (const [marker, value] of Object.entries(values)) source = source.replaceAll(marker, value);
  if (Buffer.byteLength(source) > 16 * 1024 || /@[A-Z]+@/.test(source)) refuse();
  return source;
}
