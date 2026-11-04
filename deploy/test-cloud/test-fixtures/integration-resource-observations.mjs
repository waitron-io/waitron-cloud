import assert from 'node:assert/strict';
import {createCapacityChronology} from './integration-capacity.mjs';

function checkedStates(values) {
  assert.ok(Array.isArray(values));
  for (const value of values) {
    assert.deepEqual(Object.keys(value).sort(), ['health', 'id', 'name', 'startedAt', 'state']);
    assert.match(value.id, /^[a-f0-9]{64}$/);
    assert.match(value.name, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    assert.equal(value.state, 'running'); assert.equal(value.health, 'healthy');
    assert.ok(typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)));
  }
  for (const key of ['id', 'name']) assert.equal(new Set(values.map(value => value[key])).size, values.length);
  return structuredClone(values).sort((a, b) => a.name.localeCompare(b.name));
}

export async function readProtectedContainerStates({docker, ids}) {
  assert.ok(Array.isArray(ids)); assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-f0-9]{64}$/);
  if (!ids.length) return [];
  const rows = JSON.parse(await docker(['inspect', ...ids], '', 'protected-resource-inspect'));
  assert.ok(Array.isArray(rows)); assert.equal(rows.length, ids.length);
  assert.deepEqual(rows.map(row => row.Id).sort(), [...ids].sort());
  return checkedStates(rows.map(row => {
    assert.equal(row.State.Running, true);
    assert.ok(typeof row.Name === 'string' && row.Name.startsWith('/'));
    return {id: row.Id, name: row.Name.slice(1), state: row.State.Status,
      health: row.State.Health?.Status, startedAt: row.State.StartedAt};
  }));
}

// The protected read belongs inside the same interval as its resource reading.
export function createResourceObservationCollector({readHost, readProtected, now = () => performance.now()}) {
  let epoch, state = 'new', original, baseline, after;
  const protectedSamples = [];
  const chronology = createCapacityChronology({now: () => {
    const value = now(); epoch ??= value; return value;
  }});
  const publicStates = values => values.map(({startedAt, ...value}) => value);
  const protectedReading = async () => {
    const values = checkedStates(await readProtected());
    if (original) assert.deepEqual(values, original, 'integration.protected_resource_changed');
    else original = structuredClone(values);
    return publicStates(values);
  };
  const boundary = async () => {
    const startedMs = now() - epoch;
    const reading = await readHost();
    assert.deepEqual(Object.keys(reading).sort(), ['availableMiB', 'freeGiB']);
    for (const key of ['availableMiB', 'freeGiB']) assert.ok(Number.isFinite(reading[key]) && reading[key] >= 0);
    const quarantined = await protectedReading(), finishedMs = now() - epoch;
    assert.ok(Number.isFinite(startedMs) && startedMs >= 0 && Number.isFinite(finishedMs) && finishedMs >= startedMs);
    return {startedMs, finishedMs, reading: {...reading, quarantined}};
  };
  return {
    async start() {
      assert.equal(state, 'new', 'integration.resource_observation_state'); state = 'starting';
      baseline = await boundary(); state = 'observing';
    },
    async observe(phase, read) {
      assert.equal(state, 'observing', 'integration.resource_observation_state');
      return chronology.observe(phase, async () => {
        assert.ok(now() - epoch >= baseline.finishedMs, 'integration.resource_baseline_order');
        const value = await read();
        protectedSamples.push(await protectedReading());
        return value;
      });
    },
    snapshot() {return chronology.snapshot();},
    async finish() {
      assert.equal(state, 'observing', 'integration.resource_observation_state'); state = 'finishing';
      const captured = chronology.snapshot();
      after = await boundary();
      assert.ok(after.startedMs >= (captured.samples.at(-1)?.finishedMs ?? baseline.finishedMs));
      assert.equal(captured.samples.length, protectedSamples.length);
      state = 'finished';
      return structuredClone({clock: captured.clock, baseline, samples: captured.samples.map((sample, i) => ({
        ...sample, reading: {...sample.reading, quarantined: protectedSamples[i]},
      })), after});
    },
  };
}
