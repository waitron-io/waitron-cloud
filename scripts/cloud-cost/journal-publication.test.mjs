import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runPrivate } from './local.mjs';

function fixture(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'cloud-cost-journal-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  fs.mkdirSync(source, { mode: 0o700 }); fs.mkdirSync(root, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { path: join(root, 'journal.json'), token };
  fs.writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  const initial = { schemaVersion: 1, source, root, ownershipToken: token,
    localResources: [{ kind: 'sentinel', state: 'ready' }] };
  fs.writeFileSync(journal.path, JSON.stringify(initial), { mode: 0o600 });
  t.after(() => fs.rmSync(parent, { recursive: true }));
  return { source, root, journal, initial };
}

function replaceBuiltin(t, name, replacement) {
  const original = fs[name]; fs[name] = replacement(original); syncBuiltinESMExports();
  t.after(() => { fs[name] = original; syncBuiltinESMExports(); });
}

// Publishing in place lets a signal observer read the gap between truncation and writing.
test('privateProcessJournalRemainsReadableDuringEveryPublication', async t => {
  const f = fixture(t), observed = [], modes = [];
  replaceBuiltin(t, 'writeFileSync', write => (target, value, ...options) => {
    if (typeof target === 'number' || target === f.journal.path) {
      if (typeof target === 'number') fs.ftruncateSync(target, 0);
      else fs.truncateSync(target, 0);
      const text = fs.readFileSync(f.journal.path, 'utf8');
      try { observed.push(JSON.parse(text)); } catch { observed.push(null); }
      modes.push((typeof target === 'number' ? fs.fstatSync(target) : fs.statSync(target)).mode & 0o777);
    }
    return write(target, value, ...options);
  });
  assert.deepEqual(await runPrivate(process.execPath, ['-e', ''], { ownership: f }), { exitCode: 0 });
  assert.equal(observed.length, 2);
  assert.deepEqual(observed[0], f.initial, 'readers keep the complete previous journal until publication');
  assert.deepEqual(observed[1].localResources.map(e => e.state), ['ready', 'intent']);
  assert.deepEqual(modes, [0o600, 0o600]);
  const final = JSON.parse(fs.readFileSync(f.journal.path, 'utf8'));
  assert.deepEqual(final.localResources.map(e => e.state), ['ready', 'intent', 'started']);
  assert.ok(Number.isInteger(final.localResources[2].pid));
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
});

// A short write must leave the last complete ownership record available for recovery.
test('privateProcessJournalSurvivesAnInterruptedPublication', async t => {
  const f = fixture(t);
  replaceBuiltin(t, 'writeFileSync', write => (target, ...options) => {
    if (typeof target === 'number' || target === f.journal.path) {
      write(target, '{'); throw Object.assign(Error('synthetic write failure'), { code: 'EIO' });
    }
    return write(target, ...options);
  });
  await assert.rejects(runPrivate(process.execPath, ['-e', ''], { ownership: f }),
    { message: 'Invalid cloud cost local run' });
  assert.equal(fs.readFileSync(f.journal.path, 'utf8'), JSON.stringify(f.initial));
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
});

test('privateProcessJournalPreservesPriorRecordsWhenPublicationIsRefused', async t => {
  const f = fixture(t); let reached = false;
  replaceBuiltin(t, 'renameSync', rename => (source, destination) => {
    if (destination === f.journal.path) { reached = true; throw Object.assign(Error('synthetic rename failure'), { code: 'EACCES' }); }
    return rename(source, destination);
  });
  await assert.rejects(runPrivate(process.execPath, ['-e', ''], { ownership: f }),
    { message: 'Invalid cloud cost local run' });
  assert.equal(reached, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.journal.path, 'utf8')), f.initial);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
});

// A publication cannot overwrite the recovery journal after ownership has been withdrawn.
test('privateProcessJournalRefusesOwnershipLostDuringPublication', async t => {
  const f = fixture(t); let reached = false;
  replaceBuiltin(t, 'writeFileSync', write => (target, ...options) => {
    const result = write(target, ...options);
    if (typeof target === 'number' || target === f.journal.path) {
      reached = true; write(join(f.root, '.cloud-cost-owner'), '0'.repeat(64));
    }
    return result;
  });
  await assert.rejects(runPrivate(process.execPath, ['-e', ''], { ownership: f }),
    { message: 'Invalid cloud cost local run' });
  assert.equal(reached, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.journal.path, 'utf8')), f.initial);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['.cloud-cost-owner', 'journal.json']);
});

// A name collision must neither overwrite nor remove a file this publication did not create.
test('privateProcessJournalPreservesACollidingTemporaryFile', async t => {
  const f = fixture(t); let collision;
  replaceBuiltin(t, 'openSync', open => (path, flags, mode) => {
    if (typeof path === 'string' && path.startsWith(join(f.root, '.cloud-cost-journal-'))) {
      collision = path;
      const fd = open(path, 'wx', 0o600);
      try { fs.writeFileSync(fd, 'keep existing file'); } finally { fs.closeSync(fd); }
    }
    return open(path, flags, mode);
  });
  await assert.rejects(runPrivate(process.execPath, ['-e', ''], { ownership: f }),
    { message: 'Invalid cloud cost local run' });
  assert.equal(typeof collision, 'string');
  assert.equal(fs.readFileSync(collision, 'utf8'), 'keep existing file');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.journal.path, 'utf8')), f.initial);
  assert.equal(fs.readdirSync(f.root).length, 3);
});
