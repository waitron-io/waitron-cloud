const fail = () => { throw new Error('Invalid cloud cost replay day'); };
const requireThat = value => { if (!value) fail(); };
function exact(value, keys) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype);
  const actual = Reflect.ownKeys(value);
  requireThat(actual.length === keys.length && actual.every(k => keys.includes(k)
    && Object.getOwnPropertyDescriptor(value, k).get === undefined));
}
function instant(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
  const date = new Date(value);
  requireThat(Number.isFinite(date.getTime()) && date.toISOString() === value);
  return date.getTime();
}

// Bounds come from Waitron's business-day clock; fixed 24-hour days lose DST and cutover history.
// This private result retains sale objects and must never be used as a public aggregate.
export function prepareReplayDay(args) {
  try {
    exact(args, ['bounds', 'events', 'expectedSales']);
    const { bounds, events, expectedSales } = args;
    exact(bounds, ['startAt', 'endAt']);
    const start = instant(bounds.startAt), end = instant(bounds.endAt);
    requireThat(end > start);
    requireThat(Array.isArray(events) && events.length <= 100000);
    requireThat(Object.getPrototypeOf(events) === Array.prototype && Reflect.ownKeys(events).length === events.length + 1);
    const selected = [];
    // Validate every source entry, including excluded ones, so malformed dates cannot hide lost sales.
    for (let index = 0; index < events.length; index++) {
      const event = Object.getOwnPropertyDescriptor(events, index)?.value;
      exact(event, ['at', 'sale']);
      const at = instant(event.at), sale = event.sale;
      requireThat(sale && typeof sale === 'object' && !Array.isArray(sale));
      if (at >= start && at < end) selected.push({ at, sale });
    }
    requireThat(selected.length > 0 && selected.length === expectedSales);
    selected.sort((a, b) => a.at - b.at);
    const origin = selected[0].at;
    return { expectedSales, events: selected.map(({ at, sale }) => ({ offsetSeconds: (at - origin) / 1000, sale })) };
  } catch { fail(); }
}
