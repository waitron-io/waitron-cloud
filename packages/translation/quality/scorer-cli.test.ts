import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {gradeRun, scoreLine, type GradedSet} from './scorer.ts';

const scorer = fileURLToPath(new URL('./scorer.ts', import.meta.url));
function run(args: string[]) {
  return spawnSync(process.execPath, [scorer, ...args], {encoding: 'utf8', cwd: tmpdir()});
}

test('the scorer command reports historical totals from any working directory', () => {
  for (const [set, expected] of [
    ['tuning', '| total | 252 | 2% | 4% | 6% | 0 |'],
    ['blind', '| total | 243 | 2% | 2% | 5% | 0 |'],
  ]) {
    const files = [1, 2, 3].map(i => fileURLToPath(new URL(
      `./data/trial-results/${set}/luna-low-v4+luna-medium-${i}.json`, import.meta.url)));
    const got = run(['--set', set!, ...files]);
    assert.equal(got.status, 0, got.stderr);
    assert.equal(got.stderr, '');
    assert.ok(got.stdout.includes(expected!));
    assert.equal(got.stdout.trim().split('\n').length, 6);
  }
});

test('the command lists unseen names and refuses missing or malformed result files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'translation-score-'));
  try {
    const file = join(dir, 'new.json');
    writeFileSync(file, JSON.stringify({names: {f01: {ca: 'Unseen café name'}}}));
    const got = run(['--set', 'blind', file]);
    assert.equal(got.status, 0, got.stderr);
    assert.ok(got.stdout.includes('| total | 1 | 0% | 0% | 0% | 1 |'));
    assert.ok(got.stdout.includes('ungraded: f01 ca Unseen café name'));
    for (const value of [{}, {names: null}, {names: []}, {names: 'bad'}, {names: {f01: null}}]) {
      writeFileSync(file, JSON.stringify(value));
      const bad = run(['--set', 'blind', file]);
      assert.notEqual(bad.status, 0, JSON.stringify(value));
    }
    assert.notEqual(run(['--set', 'blind', join(dir, 'absent.json')]).status, 0);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a missing set, an invalid set or no result files cannot produce a successful score', () => {
  for (const args of [[], ['--set'], ['--set', 'other'], ['--set', 'blind']]) {
    const got = run(args);
    assert.notEqual(got.status, 0, JSON.stringify(args));
    assert.match(got.stderr, /usage:/);
  }
});

test('only written names in the graded products and languages count, after trimming', () => {
  const set: GradedSet = {products: [{id: 'cafe', internal: 'CAFE', category: null,
    existing: {en: 'Given'}}], grades: new Map(), shown: new Set()};
  assert.deepEqual(gradeRun({cafe: {ca: ' Cafè ', es: '  ', en: 'Given', de: 'Kaffee'},
    unknown: {ca: 'Cafè'}}, set), {
    names: 1, fix: 0, wrong: 0, ungraded: 1,
    ungradedNames: [{pid: 'cafe', lang: 'ca', text: 'Cafè'}],
  });
  assert.equal(gradeRun({cafe: {ca: 17, es: false, en: null}}, set).names, 0);
  assert.equal(scoreLine('empty', {names: 0, fix: 0, wrong: 0, ungraded: 0, ungradedNames: []}),
    '| empty | 0 | - | - | - | 0 |');
});

test('failed, wrong-set and malformed values cannot look like a successful quality run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'translation-score-failures-'));
  const file = join(dir, 'bad.json');
  try {
    for (const value of [
      {error: 'provider failed', names: {f01: {ca: 'A valid written name'}}},
      {failed: ['f01'], names: {f02: {ca: 'New name'}}},
      {set: 'tuning', names: {f01: {ca: 'New name'}}},
      {names: {p01: {ca: 'Wrong set name'}, f01: {ca: 'A valid written name'}}},
      {names: {f01: {ca: 17, es: 'A valid written name'}}},
      {names: {f01: {ca: ''}}},
    ]) {
      writeFileSync(file, JSON.stringify(value));
      const got = run(['--set', 'blind', file]);
      assert.notEqual(got.status, 0, JSON.stringify(value));
      assert.equal(got.stdout, '', 'an invalid file must not leave a score table');
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('incomplete results name their missing coverage beside the score', () => {
  const dir = mkdtempSync(join(tmpdir(), 'translation-score-partial-'));
  try {
    const file = join(dir, 'partial.json');
    writeFileSync(file, JSON.stringify({names: {f01: {ca: 'Unseen café name'}}}));
    const got = run(['--set', 'blind', file]);
    assert.equal(got.status, 0, got.stderr);
    assert.match(got.stderr, /incomplete: partial.json: 29 products absent, 85 names missing/);
    assert.ok(got.stdout.includes('| total | 1 | 0% | 0% | 0% | 1 |'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a repeated file is refused and a bad later file leaves no partial table', () => {
  const good = fileURLToPath(new URL('./data/trial-results/blind/luna-low-v4+luna-medium-1.json', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'translation-score-atomic-'));
  try {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{');
    for (const files of [[good, good], [good, bad]]) {
      const got = run(['--set', 'blind', ...files]);
      assert.notEqual(got.status, 0);
      assert.equal(got.stdout, '');
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('the command retains every ungraded name across several input files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'translation-score-many-'));
  try {
    const first = join(dir, 'first.json'), second = join(dir, 'second.json');
    writeFileSync(first, JSON.stringify({names: {f01: {ca: 'Unseen first name'}}}));
    writeFileSync(second, JSON.stringify({names: {f02: {es: 'Unseen second name'}}}));
    const got = run(['--set', 'blind', first, second]);
    assert.equal(got.status, 0, got.stderr);
    assert.ok(got.stdout.includes('| total | 2 | 0% | 0% | 0% | 2 |'));
    assert.deepEqual(got.stdout.split('\n').filter(line => line.startsWith('ungraded:')), [
      'ungraded: f01 ca Unseen first name', 'ungraded: f02 es Unseen second name',
    ]);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
