import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const load = () => import('./test-fixtures/integration-resource-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-resource-evidence.mjs')) return {};
  throw error;
});
const protectedStates = () => ['waitron-app-1', 'waitron-print-agent-1', 'waitron-mailpit-1'].map((name, i) => ({
  name, id: String(i + 1).repeat(64), state: 'running', health: 'healthy',
}));
const host = () => ({availableMiB: 4096, freeGiB: 20, quarantined: protectedStates()});
function fixture() {
  return {clock: 'shared-monotonic', baseline: {startedMs: 0.125, finishedMs: 10.25, reading: host()},
    samples: Array.from({length: 17}, (_, i) => ({startedMs: 100.25 + i * 5000, finishedMs: 110.75 + i * 5000,
      phase: i === 0 ? 'startup' : i < 15 ? 'settled' : i === 15 ? 'verification' : 'integration',
      reading: {...host(), availableMiB: 3000, freeGiB: 18, cloudMiB: 1800,
        verifierCount: i === 15 ? 1 : 0, verifierMiB: i === 15 ? 1000 : 0, scratchMiB: i === 15 ? 240 : 0,
        fixtureBytes: 1234, oom: false, protectedUnchanged: true, verifierIds: i === 15 ? ['d'.repeat(64)] : []}})),
    after: {startedMs: 80120.5, finishedMs: 80130.75, reading: host()}};
}

test('measured readings map to receipt resources without changing the origin, order or values', async () => {
  const {createTestCloudResourceEvidence} = await load();
  assert.equal(typeof createTestCloudResourceEvidence, 'function', 'Resource normalizer is missing');
  const raw = fixture(), original = structuredClone(raw), result = createTestCloudResourceEvidence(raw);
  assert.deepEqual(result, {baseline: raw.baseline.reading, samples: raw.samples.map(sample => {
    const {protectedUnchanged, verifierIds, ...reading} = sample.reading;
    return {elapsedMs: Math.ceil(sample.finishedMs), phase: sample.phase, ...reading};
  }), after: raw.after.reading});
  assert.deepEqual(raw, original);
  result.baseline.quarantined[0].id = 'e'.repeat(64);
  result.samples[0].quarantined[0].health = 'unhealthy';
  assert.deepEqual(raw, original, 'Normalized values cannot mutate recorded observations');
});

for (const [name, alter, reason] of [
  ['foreign clock', v => {v.clock = 'phase-local';}, 'clock'],
  ['clock origin reset', v => {v.baseline.startedMs = 5000;}, 'chronology'],
  ['backwards baseline', v => {v.baseline.finishedMs = 0;}, 'chronology'],
  ['overlapping reads', v => {v.samples[1].startedMs = 100;}, 'chronology'],
  ['backwards sample', v => {v.samples[1].finishedMs = v.samples[1].startedMs - 1;}, 'chronology'],
  ['late first sample', v => {for (const s of v.samples) {s.startedMs += 5000; s.finishedMs += 5000;} v.after.startedMs += 5000; v.after.finishedMs += 5000;}, 'gap'],
  ['gap hidden by rounding', v => {v.samples[1].finishedMs += 0.1;}, 'gap'],
  ['slow read', v => {v.samples[1].startedMs = v.samples[0].finishedMs; v.samples[1].finishedMs += 1;}, 'gap'],
  ['cleanup gap', v => {v.after.startedMs += 6000; v.after.finishedMs += 6000;}, 'gap'],
  ['slow cleanup read', v => {v.after.finishedMs += 6000;}, 'gap'],
  ['cleanup before last reading', v => {v.after.startedMs = 100;}, 'chronology'],
  ['non-finite time', v => {v.samples[2].finishedMs = NaN;}, 'number'],
  ['unsafe integer conversion', v => {v.after.finishedMs = Number.MAX_SAFE_INTEGER + 1;}, 'number'],
  ['empty samples', v => {v.samples = [];}, 'samples'],
  ['missing startup', v => {v.samples[0].phase = 'settled';}, 'phases'],
  ['missing integration', v => {v.samples.at(-1).phase = 'verification';}, 'phases'],
  ['missing verification', v => {v.samples[15].phase = 'integration';}, 'phases'],
  ['unknown phase', v => {v.samples[1].phase = 'other';}, 'phases'],
  ['settled time enlarged by rounding', v => {for (const s of v.samples.slice(14)) s.finishedMs -= 0.1; v.samples[1].phase = 'startup';}, 'settled'],
  ['settled gap', v => {v.samples[7].phase = 'integration';}, 'settled'],
  ['no active verifier', v => {v.samples[15].reading.verifierCount = 0; v.samples[15].reading.verifierMiB = 0; v.samples[15].reading.scratchMiB = 0; v.samples[15].reading.verifierIds = [];}, 'verifier'],
  ['startup memory', v => {v.baseline.reading.availableMiB = 4095;}, 'baseline'],
  ['startup disk', v => {v.baseline.reading.freeGiB = 19.9;}, 'baseline'],
  ['final memory', v => {v.after.reading.availableMiB = 2047;}, 'after'],
  ['final disk', v => {v.after.reading.freeGiB = 14.9;}, 'after'],
  ['three low samples', v => {for (const s of v.samples.slice(3, 6)) s.reading.availableMiB = 2047;}, 'floor'],
  ['three low disk samples', v => {for (const s of v.samples.slice(3, 6)) s.reading.freeGiB = 14.9;}, 'floor'],
  ['non-number measurement', v => {v.samples[0].reading.freeGiB = '18';}, 'number'],
  ['negative measurement', v => {v.samples[0].reading.cloudMiB = -1;}, 'number'],
  ['cloud budget', v => {v.samples[0].reading.cloudMiB = 2049;}, 'budget'],
  ['verifier budget', v => {v.samples[15].reading.verifierMiB = 1025;}, 'budget'],
  ['scratch budget', v => {v.samples[15].reading.scratchMiB = 257;}, 'budget'],
  ['fixture budget', v => {v.samples[0].reading.fixtureBytes = 1073741825;}, 'budget'],
  ['two verifiers', v => {v.samples[14].phase = 'verification'; v.samples[14].reading = structuredClone(v.samples[15].reading); v.samples[15].reading.verifierCount = 2; v.samples[15].reading.verifierIds.push('e'.repeat(64));}, 'verifier'],
  ['missing verifier identity', v => {v.samples[15].reading.verifierIds = [];}, 'verifier'],
  ['malformed verifier identity', v => {v.samples[15].reading.verifierIds = ['invalid'];}, 'verifier'],
  ['protected verifier identity', v => {v.samples[15].reading.verifierIds = [protectedStates()[0].id];}, 'verifier'],
  ['nonzero absent verifier', v => {v.samples[0].reading.verifierMiB = 1;}, 'verifier'],
  ['unmeasured verifier', v => {v.samples[15].reading.verifierMiB = 0; v.samples[15].reading.scratchMiB = 0;}, 'verifier'],
  ['scratch outside verifier memory', v => {v.samples[15].reading.verifierMiB = 100;}, 'verifier'],
  ['oom', v => {v.samples[0].reading.oom = true;}, 'oom'],
  ['protected change flag', v => {v.samples[0].reading.protectedUnchanged = false;}, 'protected'],
  ['protected health', v => {for (const r of [v.baseline, ...v.samples, v.after]) r.reading.quarantined[0].health = 'unhealthy';}, 'protected'],
  ['protected replacement', v => {v.samples[0].reading.quarantined[0].id = 'e'.repeat(64);}, 'protected'],
  ['late protected replacement', v => {v.after.reading.quarantined[0].id = 'e'.repeat(64);}, 'protected'],
  ['missing protected process', v => {v.baseline.reading.quarantined.pop();}, 'protected'],
  ['duplicate protected id', v => {for (const r of [v.baseline, ...v.samples, v.after]) r.reading.quarantined[1].id = r.reading.quarantined[0].id;}, 'protected'],
  ['foreign protected name', v => {for (const r of [v.baseline, ...v.samples, v.after]) r.reading.quarantined[0].name = 'foreign';}, 'protected'],
  ['malformed protected id', v => {for (const r of [v.baseline, ...v.samples, v.after]) r.reading.quarantined[0].id = 'invalid';}, 'protected'],
  ['private observation extension', v => {v.privateKey = 'never-echo';}, 'shape'],
  ['private reading extension', v => {v.samples[0].reading.token = 'never-echo';}, 'shape'],
]) test('resource mapping refuses ' + name, async () => {
  const {createTestCloudResourceEvidence} = await load();
  assert.equal(typeof createTestCloudResourceEvidence, 'function', 'Resource normalizer is missing');
  const raw = fixture(); alter(raw);
  assert.throws(() => createTestCloudResourceEvidence(raw), new RegExp('resource_evidence\\.' + reason));
});

test('two low readings remain transient and protected array order has no meaning', async () => {
  const {createTestCloudResourceEvidence} = await load();
  assert.equal(typeof createTestCloudResourceEvidence, 'function');
  const raw = fixture();
  raw.samples[1].reading.availableMiB = 2000; raw.samples[2].reading.freeGiB = 14;
  raw.samples[7].reading.freeGiB = 14;
  raw.after.reading.quarantined.reverse();
  const result = createTestCloudResourceEvidence(raw);
  assert.equal(result.samples[1].availableMiB, 2000);
  assert.equal(result.samples[2].freeGiB, 14);
  assert.deepEqual(result.after.quarantined, raw.after.reading.quarantined);
});

test('resource command emits only measured resources and refuses private input silently', async () => {
  const path = await mkdtemp(join(tmpdir(), 'cloud-resource-evidence-'));
  try {
    const file = join(path, 'observations.json');
    await writeFile(file, JSON.stringify(fixture()));
    const run = (...args) => spawnSync(process.execPath, ['scripts/test-cloud-resource-evidence.mjs', ...args], {encoding: 'utf8'});
    const valid = run(file);
    assert.equal(valid.status, 0, valid.stderr);
    const {createTestCloudResourceEvidence} = await load();
    assert.deepEqual(JSON.parse(valid.stdout), createTestCloudResourceEvidence(fixture()));
    assert.equal(valid.stderr, '');
    await writeFile(file, '{"privateKey":"never-echo"}');
    const invalid = run(file);
    assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
    assert.equal(invalid.stderr, 'Test Cloud resource evidence refused\n');
    await writeFile(file, JSON.stringify(fixture()));
    assert.equal(run().status, 1); assert.equal(run(file, file).status, 1);
    await writeFile(file, ' '.repeat(2 * 1024 * 1024) + JSON.stringify(fixture()));
    assert.equal(run(file).status, 1);
  } finally {await rm(path, {recursive: true, force: true});}
});
