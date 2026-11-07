import {writeFileSync} from 'node:fs';

const settingKeys = ['workload', 'sales', 'cadenceFactor', 'startupSeconds', 'idleSeconds', 'replayWindowSeconds', 'streamWindowSeconds'];
const runtimeKeys = ['waitron', 'litestream', 'node', 'platform', 'arch'];
const select = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const bounded = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

export function storageObservation(stream, settings, runtime) {
  const result = {status: 'unusable', bounds: null, gaps: ['storage-unavailable'],
    settings: select(settings, settingKeys), runtime: select(runtime, runtimeKeys)};
  const parts = [stream?.storage, stream?.retainedStorage];
  if (!parts.every(part => part?.status === 'measured'
    && (part.gaps === undefined || Array.isArray(part.gaps) && part.gaps.length === 0)
    && bounded(part.byteSeconds?.low) && bounded(part.byteSeconds?.high)
    && part.byteSeconds.low <= part.byteSeconds.high)) return result;
  // Publication-ineligible replays return before the existing stream accounting sum.
  const low = parts[0].byteSeconds.low + parts[1].byteSeconds.low;
  const high = parts[0].byteSeconds.high + parts[1].byteSeconds.high;
  if (!bounded(low) || !bounded(high)) return result;
  return {...result, status: 'measured', bounds: {low, high}, gaps: []};
}
export function exportStorageObservation({output, stream, settings, runtime, diagnostic}) {
  if (!output) return;
  try {
    writeFileSync(output, JSON.stringify(storageObservation(stream, settings, runtime)) + '\n');
  } catch {
    try {diagnostic?.('Cloud cost advisory: storage export unavailable.');} catch { /* Optional reporting cannot fail conformance. */ }
  }
}
