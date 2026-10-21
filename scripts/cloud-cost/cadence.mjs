import { setTimeout as delay } from 'node:timers/promises';

const fail = () => { throw new Error('Invalid cloud cost replay cadence'); };
const requireThat = value => { if (!value) fail(); };
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function exact(value, keys) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype);
  const actual = Reflect.ownKeys(value);
  requireThat(actual.length === keys.length && actual.every(k => keys.includes(k)
    && Object.getOwnPropertyDescriptor(value, k).get === undefined));
}

// This private scheduling step does not establish source selection, isolation, or complete cost evidence.
export async function replayScheduledSales(args) {
  let timer, signal, abort;
  try {
    const { events, expectedSales, cadence, windowSeconds, recordSale,
      timing = { now: () => performance.now(), wait: (ms, signal) => delay(ms, undefined, { signal }) } } = args;
    requireThat(args.signal === undefined || args.signal instanceof AbortSignal);
    signal = args.signal;
    exact(cadence, ['mode', 'factor']);
    requireThat(['original', 'accelerated'].includes(cadence.mode) && finite(cadence.factor) && cadence.factor >= 1);
    requireThat(cadence.mode !== 'original' || cadence.factor === 1);
    requireThat(finite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 3600);
    requireThat(typeof recordSale === 'function' && typeof timing.now === 'function' && typeof timing.wait === 'function');
    requireThat(Number.isSafeInteger(expectedSales) && expectedSales > 0 && expectedSales <= 100000
      && Array.isArray(events) && events.length === expectedSales);
    const mode = cadence.mode, factor = cadence.factor;
    let previousOffset = 0;
    // Snapshot the schedule before the first await; callers retain the private sale objects.
    const selected = Array.from(events, value => {
      exact(value, ['offsetSeconds', 'sale']);
      const { offsetSeconds, sale } = value;
      requireThat(finite(offsetSeconds) && offsetSeconds >= previousOffset && offsetSeconds / factor < windowSeconds);
      requireThat(sale && typeof sale === 'object' && !Array.isArray(sale));
      previousOffset = offsetSeconds;
      return { offsetSeconds, sale };
    });
    const controller = new AbortController();
    abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(abort, windowSeconds * 1000);
    let previousTime = 0;
    const now = () => {
      requireThat(!controller.signal.aborted);
      const value = timing.now();
      requireThat(finite(value) && value >= previousTime);
      previousTime = value;
      return value;
    };
    const started = now(), deadline = started + windowSeconds * 1000;
    const withinWindow = () => { const value = now(); requireThat(value < deadline); return value; };
    let attempted = 0, successful = 0, maxLagSeconds = 0;
    for (const { offsetSeconds, sale } of selected) {
      const target = started + offsetSeconds * 1000 / factor;
      let current = withinWindow();
      while (current < target) {
        const beforeWait = current;
        await timing.wait(target - current, controller.signal);
        current = withinWindow();
        requireThat(current > beforeWait);
      }
      maxLagSeconds = Math.max(maxLagSeconds, (current - target) / 1000);
      attempted++;
      // Cancellation stops admission; an already admitted transaction must settle before cleanup.
      await recordSale(sale, controller.signal);
      successful++;
    }
    const elapsedSeconds = (withinWindow() - started) / 1000;
    return { complete: true, cadence: { mode, factor, coveredSeconds: previousOffset },
      counts: { expected: expectedSales, attempted, successful, failed: 0 }, timing: { elapsedSeconds, maxLagSeconds } };
  } catch { fail(); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
