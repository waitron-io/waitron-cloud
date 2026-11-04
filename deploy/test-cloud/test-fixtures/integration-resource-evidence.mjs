import assert from 'node:assert/strict';

const names = ['waitron-app-1', 'waitron-mailpit-1', 'waitron-print-agent-1'];
const hostFields = 'availableMiB,freeGiB,quarantined';
const sampleFields = hostFields + ',cloudMiB,verifierMiB,verifierCount,scratchMiB,fixtureBytes,oom,protectedUnchanged,verifierIds';
const check = (valid, reason) => assert.ok(valid, 'resource_evidence.' + reason);
function exact(value, fields) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'shape');
  check(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields.split(',').sort()), 'shape');
}
function number(value) {
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER, 'number');
}
function protectedStates(values) {
  check(Array.isArray(values) && values.length === 3, 'protected');
  check(JSON.stringify(values.map(v => v.name).sort()) === JSON.stringify(names), 'protected');
  for (const value of values) {
    exact(value, 'name,id,state,health');
    check(typeof value.id === 'string' && /^[a-f0-9]{64}$/.test(value.id), 'protected');
    check(value.state === 'running' && value.health === 'healthy', 'protected');
  }
  check(new Set(values.map(v => v.id)).size === 3, 'protected');
  return [...values].sort((a, b) => a.name.localeCompare(b.name));
}

// Completion times retain the shared origin; raw intervals must pass before rounding.
export function createTestCloudResourceEvidence(observations) {
  exact(observations, 'clock,baseline,samples,after');
  check(observations.clock === 'shared-monotonic', 'clock');
  const {baseline, samples, after} = observations;
  check(Array.isArray(samples) && samples.length > 0, 'samples');
  let previous = 0, previousElapsed = -1, original;
  const interval = value => {
    number(value.startedMs); number(value.finishedMs);
    check(value.startedMs >= previous && value.finishedMs >= value.startedMs, 'chronology');
    check(value.finishedMs - previous <= 5000, 'gap');
    previous = value.finishedMs;
  };
  const host = (reading, boundary) => {
    number(reading.availableMiB); number(reading.freeGiB);
    const states = protectedStates(reading.quarantined);
    if (original) check(JSON.stringify(states) === JSON.stringify(original), 'protected');
    else original = states;
    if (boundary === 'baseline') check(reading.availableMiB >= 4096 && reading.freeGiB >= 20, 'baseline');
    if (boundary === 'after') check(reading.availableMiB >= 2048 && reading.freeGiB >= 15, 'after');
  };
  exact(baseline, 'startedMs,finishedMs,reading'); exact(baseline.reading, hostFields);
  interval(baseline); host(baseline.reading, 'baseline');
  const phases = new Map();
  let low = 0, active = false;
  const normalized = samples.map(sample => {
    exact(sample, 'startedMs,finishedMs,phase,reading'); exact(sample.reading, sampleFields);
    interval(sample);
    check(['startup', 'settled', 'verification', 'integration'].includes(sample.phase), 'phases');
    if (!phases.has(sample.phase)) phases.set(sample.phase, []);
    phases.get(sample.phase).push(sample.finishedMs);
    const elapsedMs = Math.ceil(sample.finishedMs);
    check(elapsedMs > previousElapsed && elapsedMs - Math.max(0, previousElapsed) <= 5000, 'chronology');
    previousElapsed = elapsedMs;
    const {protectedUnchanged, verifierIds, ...reading} = sample.reading;
    host(reading);
    for (const [key, max] of [['cloudMiB', 2048], ['verifierMiB', 1024], ['scratchMiB', 256], ['fixtureBytes', 1073741824]]) {
      number(reading[key]); check(reading[key] <= max, 'budget');
    }
    check(reading.verifierCount === 0 || reading.verifierCount === 1, 'verifier');
    check(Array.isArray(verifierIds) && verifierIds.length === reading.verifierCount, 'verifier');
    for (const id of verifierIds) check(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id) && !original.some(v => v.id === id), 'verifier');
    if (reading.verifierCount === 0) check(reading.verifierMiB === 0 && reading.scratchMiB === 0, 'verifier');
    else check(reading.verifierMiB > 0, 'verifier');
    check(reading.scratchMiB <= reading.verifierMiB, 'verifier');
    check(reading.oom === false, 'oom'); check(protectedUnchanged === true, 'protected');
    if (sample.phase === 'verification' && reading.verifierCount === 1) active = true;
    low = reading.availableMiB < 2048 || reading.freeGiB < 15 ? low + 1 : 0;
    check(low < 3, 'floor');
    return {elapsedMs, phase: sample.phase, ...reading};
  });
  check(['startup', 'verification', 'integration'].every(phase => phases.has(phase)), 'phases');
  const settled = phases.get('settled');
  check(settled && settled.at(-1) - settled[0] >= 60000, 'settled');
  for (let i = 1; i < settled.length; i++) check(settled[i] - settled[i - 1] <= 5000, 'settled');
  check(active, 'verifier');
  exact(after, 'startedMs,finishedMs,reading'); exact(after.reading, hostFields);
  interval(after); host(after.reading, 'after');
  return structuredClone({baseline: baseline.reading, samples: normalized, after: after.reading});
}
