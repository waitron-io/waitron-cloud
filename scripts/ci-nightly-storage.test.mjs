import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const storage = await import('./ci-nightly-storage.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./ci-nightly-storage.mjs', import.meta.url).href) return {};
  throw error;
});
const settings = {workload: 'paced-207-v1', sales: 207, cadenceFactor: 100,
  startupSeconds: 2, idleSeconds: 2, replayWindowSeconds: 120, streamWindowSeconds: 150, controllerWindowSeconds: 200};
const runtime = {waitron: 'a'.repeat(40), litestream: '0.5.17', node: 'v26.11.1', platform: 'linux', arch: 'x64'};
const sample = () => ({storage: {status: 'measured', byteSeconds: {low: 5000, high: 6000}},
  retainedStorage: {status: 'measured', byteSeconds: {low: 4096, high: 8192}}});

// Losing the cleanup tail or selecting a midpoint changes these hand-derived bounds.
test('producer retains independent storage bounds including cleanup', () => {
  assert.equal(typeof storage.storageObservation, 'function', 'the nightly needs the observed storage interval');
  const result = storage.storageObservation(sample(), settings, runtime);
  assert.deepEqual(result, {status: 'measured', bounds: {low: 9096, high: 14192}, gaps: [], settings, runtime});
  settings.sales = 1;
  try { assert.equal(result.settings.sales, 207); } finally {settings.sales = 207;}
});

for (const field of ['storage', 'retainedStorage']) {
  for (const [name, change] of [
    ['unknown', value => {value.status = 'unknown';}],
    ['null bound', value => {value.byteSeconds.low = null;}],
    ['negative bound', value => {value.byteSeconds.low = -1;}],
    ['nonfinite bound', value => {value.byteSeconds.high = Infinity;}],
    ['reversed bounds', value => {value.byteSeconds.low = 9000;}],
    ['gap', value => {value.gaps = ['PRIVATE_CANARY'];}],
    ['missing bounds', value => {delete value.byteSeconds;}],
  ]) test(`producer reports unusable ${field} ${name} without leaking its input`, () => {
    const input = sample(); change(input[field]);
    const result = storage.storageObservation(input, settings, runtime);
    assert.equal(result.status, 'unusable');
    assert.equal(result.bounds, null);
    assert.deepEqual(result.gaps, ['storage-unavailable']);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY/);
  });
}
test('producer refuses overflow of the combined interval', () => {
  const input = sample(); input.storage.byteSeconds = {low: Number.MAX_SAFE_INTEGER, high: Number.MAX_SAFE_INTEGER};
  assert.equal(storage.storageObservation(input, settings, runtime).status, 'unusable');
});
test('a zero lower bound remains an observed bound', () => {
  const input = sample(); input.storage.byteSeconds.low = input.retainedStorage.byteSeconds.low = 0;
  assert.deepEqual(storage.storageObservation(input, settings, runtime).bounds, {low: 0, high: 14192});
});
test('producer exports only the named aggregate settings and runtime pins', () => {
  const result = storage.storageObservation(sample(), {...settings, raw: 'PRIVATE_CANARY'}, {...runtime, raw: 'PRIVATE_CANARY'});
  assert.deepEqual(result.settings, settings);
  assert.deepEqual(result.runtime, runtime);
});

test('producer opt-in writes the aggregate while unset leaves no output', () => {
  assert.equal(typeof storage.exportStorageObservation, 'function');
  const root = mkdtempSync(join(tmpdir(), 'nightly-storage-test-'));
  const messages = [];
  try {
    const input = {stream: sample(), settings, runtime, diagnostic: value => messages.push(value)};
    storage.exportStorageObservation({...input, output: ''});
    assert.deepEqual(readdirSync(root), []);
    assert.deepEqual(messages, []);
    storage.exportStorageObservation({...input, output: join(root, 'observation.json')});
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'observation.json'), 'utf8')).bounds, {low: 9096, high: 14192});
  } finally {rmSync(root, {recursive: true, force: true});}
});
test('an optional export failure reports a fixed message and does not fail the caller', () => {
  assert.equal(typeof storage.exportStorageObservation, 'function');
  const root = mkdtempSync(join(tmpdir(), 'nightly-storage-test-'));
  try {
    const messages = [];
    assert.doesNotThrow(() => storage.exportStorageObservation({output: join(root, 'PRIVATE_CANARY', 'missing.json'),
      stream: sample(), settings, runtime, diagnostic: value => messages.push(value)}));
    assert.deepEqual(messages, ['Cloud cost advisory: storage export unavailable.']);
    assert.doesNotThrow(() => storage.exportStorageObservation({output: root, stream: sample(), settings, runtime,
      diagnostic: () => {throw Error('diagnostic failure');}}));
  } finally {rmSync(root, {recursive: true, force: true});}
});

const observation = (low, high, overrides = {}) => ({status: 'measured', bounds: {low, high}, gaps: [],
  settings: {...settings}, runtime: {...runtime}, ...overrides});
for (const [name, current, previous, want] of [
  ['increase', [230, 240], [100, 110], {direction: 'increase', ratio: 230 / 110}],
  ['decrease', [100, 110], [230, 240], {direction: 'decrease', ratio: 230 / 110}],
  ['exact boundary', [220, 230], [100, 110], null],
  ['normal spread', [110, 120], [100, 110], null],
  ['overlapping wide bounds', [50, 400], [100, 200], null],
  ['zero lower bounds', [0, 300], [0, 100], null],
]) test(`comparison uses conservative bounds for ${name}`, () => {
  assert.equal(typeof storage.storageChange, 'function');
  assert.deepEqual(storage.storageChange(observation(...current), observation(...previous), 2),
    {status: 'comparable', change: want, runtimeChanged: false});
});
test('runtime upgrades remain comparable and are reported', () => {
  assert.equal(typeof storage.storageChange, 'function');
  const current = observation(230, 240, {runtime: {...runtime, waitron: 'b'.repeat(40), node: 'v26.12.0'}});
  const result = storage.storageChange(current, observation(100, 110), 2);
  assert.deepEqual(result.change, {direction: 'increase', ratio: 230 / 110});
  assert.equal(result.runtimeChanged, true);
});
test('different workload settings cannot silently become a comparison', () => {
  assert.equal(typeof storage.storageChange, 'function');
  const current = observation(230, 240, {settings: {...settings, cadenceFactor: 200}});
  assert.deepEqual(storage.storageChange(current, observation(100, 110), 2), {status: 'unavailable', reason: 'workload-changed'});
});
test('different controller windows cannot silently become a comparison', () => {
  const current = observation(230, 240, {settings: {...settings, controllerWindowSeconds: 201}});
  assert.deepEqual(storage.storageChange(current, observation(100, 110), 2), {status: 'unavailable', reason: 'workload-changed'});
});
for (const [name, change] of [
  ['missing', value => {delete value.bounds;}],
  ['unknown', value => {value.status = 'unusable';}],
  ['gap', value => {value.gaps.push('storage-unavailable');}],
  ['null', value => {value.bounds.low = null;}],
  ['reversed', value => {value.bounds.low = 300;}],
  ['zero denominator', value => {value.bounds.low = value.bounds.high = 0;}],
  ['nonfinite', value => {value.bounds.high = Infinity;}],
  ['overflow', value => {value.bounds.high = Number.MAX_SAFE_INTEGER + 1;}],
  ['missing setting', value => {delete value.settings.sales;}],
  ['extra setting', value => {value.settings.extra = 'PRIVATE_CANARY';}],
  ['bad runtime pin', value => {value.runtime.waitron = 'PRIVATE_CANARY';}],
]) test(`unusable ${name} evidence cannot cause a change warning`, () => {
  assert.equal(typeof storage.storageChange, 'function');
  const value = observation(100, 110); change(value);
  assert.deepEqual(storage.storageChange(observation(230, 240), value, 2), {status: 'unavailable', reason: 'measurement-unavailable'});
});
test('arithmetic overflow cannot become an infinite change claim', () => {
  assert.equal(typeof storage.storageChange, 'function');
  assert.deepEqual(storage.storageChange(observation(1, 2), observation(0, Number.MIN_VALUE), 2),
    {status: 'unavailable', reason: 'arithmetic-unavailable'});
});

const repository = 'synthetic/cloud';
const now = '2026-11-07T12:00:00Z';
const row = (id, at, low, high, overrides = {}) => ({run: {id, run_attempt: 1, head_sha: 'c'.repeat(40),
  head_branch: 'main', head_repository: {full_name: repository}, event: 'schedule', status: 'completed',
  created_at: at, ...overrides}, measuredAt: at, observation: observation(low, high)});
const report = (current, history) => {
  assert.equal(typeof storage.buildStorageReport, 'function');
  return storage.buildStorageReport({repository, current, history, now: Date.parse(now), threshold: 2});
};
test('history chooses the last usable comparable main measurement and prints both links', () => {
  const current = row(20, now, 230, 240);
  const usable = row(10, '2026-11-06T12:00:00Z', 100, 110);
  const malformed = row(19, '2026-11-07T10:00:00Z', 1, 2); malformed.observation = null;
  const changed = row(18, '2026-11-07T09:00:00Z', 1, 2); changed.observation.settings.cadenceFactor = 200;
  const result = report(current, [usable, malformed, changed,
    row(17, '2026-11-07T08:00:00Z', 1, 2, {event: 'pull_request'}),
    row(16, '2026-11-07T07:00:00Z', 1, 2, {head_repository: {full_name: 'foreign/cloud'}}),
    row(15, '2026-11-07T06:00:00Z', 1, 2, {head_branch: 'feature'}),
    row(14, '2026-11-07T05:00:00Z', 1, 2, {status: 'in_progress'})]);
  assert.match(result.markdown, /# Cloud cost advisory/);
  assert.match(result.markdown, /actions\/runs\/10\/attempts\/1/);
  assert.match(result.markdown, /actions\/runs\/20\/attempts\/1/);
  assert.match(result.markdown, /230, 240/);
  assert.match(result.markdown, /100, 110/);
  assert.match(result.markdown, /Skipped 2 unusable or incomparable/);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /increase at least 2\.09/);
});
test('a fresh current measurement does not become stale because its baseline is old', () => {
  const result = report(row(20, now, 100, 110), [row(10, '2026-11-03T12:00:00Z', 100, 110)]);
  assert.deepEqual(result.warnings, []);
});
for (const [at, stale] of [['2026-11-04T12:00:00Z', false], ['2026-11-04T11:59:59Z', true]]) {
  test(`unavailable current measurement reports freshness at ${at}`, () => {
    const current = row(20, now, 100, 110); current.observation = null;
    const result = report(current, [row(10, at, 100, 110)]);
    assert.match(result.markdown, /Current measurement unavailable/);
    assert.equal(result.warnings.some(value => /older than 72 hours/.test(value)), stale);
    if (stale) assert.match(result.warnings.join('\n'), /actions\/runs\/10/);
  });
}
test('no usable retained baseline and malformed history stay visible', () => {
  const result = report(row(20, now, 100, 110), [row(10, '2026-10-01T12:00:00Z', 1, 2)]);
  assert.match(result.markdown, /No usable comparable baseline/);
  assert.match(result.warnings.join('\n'), /baseline/);
});
test('PR rehearsal reports its actual measurement without comparing against main history', () => {
  const result = report(row(20, now, 230, 240, {event: 'pull_request', head_branch: 'feature'}),
    [row(10, '2026-11-06T12:00:00Z', 100, 110)]);
  assert.match(result.markdown, /Rehearsal/);
  assert.match(result.markdown, /230, 240/);
  assert.deepEqual(result.warnings, []);
});
test('a lower-bound warning rounds down rather than overstating the change', () => {
  const result = report(row(20, now, 209.6, 210), [row(10, '2026-11-06T12:00:00Z', 90, 100)]);
  assert.match(result.warnings[0], /at least 2\.09×/);
  assert.doesNotMatch(result.warnings[0], /2\.10/);
});
test('retained measurements compare with earlier data while newer usable data determines freshness', () => {
  const current = row(20, '2026-11-03T12:00:00Z', 230, 240);
  const result = report(current, [row(30, '2026-11-07T00:00:00Z', 1, 2), row(10, '2026-11-02T12:00:00Z', 100, 110)]);
  assert.match(result.markdown, /Previous:.*runs\/10\/attempts\/1/);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /increase at least 2\.09/);
});

function runCli(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nightly-storage-cli-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"commonjs"}\n');
    const bin = join(root, 'bin'); mkdirSync(bin);
    const current = row(20, new Date(Date.now() - 1000).toISOString(), 230, 240);
    const previous = row(10, new Date(Date.now() - 86400000).toISOString(), 100, 110);
    const gap = row(options.newerMissing ? 15 : 5,
      new Date(Date.now() - (options.newerMissing ? 43200000 : 172800000)).toISOString(), 1, 2);
    if (options.rerun || options.priorSuccessfulAttempt) current.run.run_attempt = 2;
    if (options.priorSuccessfulAttempt) current.measuredAt = current.run.created_at = new Date(Date.now() - 43200000).toISOString();
    if (options.stable) current.observation.bounds = {low: 100, high: 110};
    const fixture = join(root, 'fixture.json'), summary = join(root, 'summary.md');
    writeFileSync(fixture, JSON.stringify({current, previous, gap, ...options}));
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(process.env.NIGHTLY_STORAGE_FIXTURE,'utf8'));
const args=process.argv.slice(2), current=fixture.current, previous=fixture.previous, gap=fixture.gap;
if(args[0]==='api') {
 const url=args[1];
 if(url==='repos/synthetic/cloud/actions/runs/20') console.log(JSON.stringify(current.run));
 else if(url.startsWith('repos/synthetic/cloud/actions/workflows/nightly.yml/runs?')) {
  if(fixture.historyUnavailable){console.error('PRIVATE_CANARY');process.exit(17);}
  const rows=fixture.newerMissing?[current.run,gap.run,previous.run]
   :fixture.olderMissing||fixture.dontReadOlder?[current.run,previous.run,gap.run]:[current.run,previous.run];
  console.log(JSON.stringify({workflow_runs:rows}));
 } else {
  const match=/^repos\\/synthetic\\/cloud\\/actions\\/runs\\/(20|10|5|15)\\/artifacts\\?per_page=100$/.exec(url);
  if(!match) process.exit(18);
  const row=match[1]==='20'?current:match[1]==='10'?previous:gap;
  if(fixture.dontReadOlder&&row===gap){console.error('PRIVATE_CANARY');process.exit(17);}
  const absent=fixture.currentMissing&&row===current||(fixture.olderMissing||fixture.newerMissing)&&row===gap;
  const attempt=fixture.priorSuccessfulAttempt&&row===current?1:row.run.run_attempt;
  console.log(JSON.stringify({artifacts:absent?[]:[{
   id:row.run.id+100,name:'nightly-storage-'+row.run.id+'-'+attempt,
   expired:Boolean(fixture.expired),created_at:row.measuredAt}]}));
 }
} else if(args[0]==='run'&&args[1]==='download') {
 const row=args[2]==='20'?current:previous;
 const name=args[args.indexOf('-n')+1], dir=args[args.indexOf('-D')+1];
 const attempt=fixture.priorSuccessfulAttempt&&row===current?1:row.run.run_attempt;
 if(name!=='nightly-storage-'+row.run.id+'-'+attempt||!dir)process.exit(19);
 fs.writeFileSync(path.join(dir,'nightly-storage.json'),fixture.malformed?'not json':JSON.stringify(row.observation));
} else process.exit(20);
`, {mode: 0o700});
    const env = {...process.env, PATH: bin + ':' + process.env.PATH, NIGHTLY_STORAGE_FIXTURE: fixture,
      GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: '20', GITHUB_RUN_ATTEMPT: options.rerun || options.priorSuccessfulAttempt ? '2' : '1', GITHUB_STEP_SUMMARY: summary};
    const result = spawnSync(process.execPath, ['scripts/ci-nightly-storage.mjs'], {env, encoding: 'utf8', timeout: 10000});
    return {...result, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : ''};
  } finally {rmSync(root, {recursive: true, force: true});}
}
test('real advisory command downloads observations and writes a warning and summary', () => {
  const result = runCli();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.summary, /# Cloud cost advisory/);
  assert.match(result.summary, /increase at least 2\.09/);
  assert.match(result.stdout, /::warning::/);
});
test('advisory reads the current rerun attempt rather than borrowing an old artifact', () => {
  const result = runCli({rerun: true});
  assert.equal(result.status, 0);
  assert.match(result.summary, /runs\/20\/attempts\/2/);
  assert.match(result.summary, /increase at least 2\.09/);
});
for (const options of [{historyUnavailable: true}, {currentMissing: true}, {expired: true}, {malformed: true}]) {
  test(`advisory evidence failure stays visible and exits successfully ${JSON.stringify(options)}`, () => {
    const result = runCli(options);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.summary, /# Cloud cost advisory/);
    assert.match(result.summary, /unavailable/);
    assert.match(result.stdout, /::warning::/);
    assert.doesNotMatch(result.summary + result.stdout + result.stderr, /PRIVATE_CANARY/);
    assert.doesNotMatch(result.summary, /advisory evidence unavailable/);
    if (options.historyUnavailable) assert.match(result.summary, /history-unavailable/);
    if (options.currentMissing) assert.match(result.summary, /Previous:.*runs\/10\/attempts\/1/);
    if (options.expired) assert.match(result.summary, /No usable comparable baseline/);
    if (options.malformed) assert.match(result.summary, /Skipped 1 unusable/);
  });
}
for (const options of [{olderMissing: true}, {newerMissing: true}, {dontReadOlder: true}]) {
  test(`a healthy baseline is not buried by irrelevant historical warnings ${JSON.stringify(options)}`, () => {
    const result = runCli({...options, stable: true});
    assert.equal(result.status, 0);
    assert.match(result.summary, /Previous:.*runs\/10\/attempts\/1/);
    assert.doesNotMatch(result.stdout, /::warning::/);
    if (options.newerMissing) assert.match(result.summary, /Skipped 1 unusable/);
  });
}
test('partial rerun retains the last actual measurement and names its original attempt', () => {
  const result = runCli({priorSuccessfulAttempt: true});
  assert.equal(result.status, 0);
  assert.match(result.summary, /runs\/20\/attempts\/1/);
  assert.match(result.summary, /retained from attempt 1/);
  assert.match(result.summary, /increase at least 2\.09/);
});
