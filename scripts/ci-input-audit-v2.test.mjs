import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync, readFileSync, unlinkSync, chmodSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {auditInputMode, readInputAudit} from './ci-input-audit.mjs';

import {fixture, marker, modes, recordPath, canonical} from './ci-input-audit-v2-fixture.mjs';
const policy = 'scripts/ci-input-audit.json', recordRoot = 'scripts/ci-input-audit.d/';
const identity = ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'];
const gateway = ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'];
const manifestPath = 'packages/stock/package.json';
const manifest = {name: 'stock', scripts: {test: 'node --test'}, dependencies: {adapter: '^1'}};
const hash = source => createHash('sha256').update(source).digest('hex');

// Fails if dispatch ignores v2 or reconstructs a different ordered inventory.
test('v2 checks exact current rows and keeps v1 evidence frozen', () => fixture(({git, base, audit}) => {
  assert.deepEqual(readInputAudit(base, git).policy, {version: 2});
  const rows = git('ls-tree', '-rz', '--full-tree', base).split('\0').filter(Boolean);
  const expected = rows.filter(raw => {
    const path = raw.split('\t')[1];
    return ![policy, marker, 'README.md', 'docs/backlog.md'].includes(path) && !path.startsWith(recordRoot);
  }).map(raw => raw + '\0').join('');
  assert.equal(audit('docs').inputSha256, hash(expected));
  for (const mode of modes) assert.doesNotThrow(() => audit(mode));
}));

// Each change must invalidate only the modes whose inputs really changed.
test('v2 preserves four distinct mode projections', () => fixture(({root, git, put, commit, base, audit}) => {
  const changes = [
    ['README.md', '# New prose\n', ['identity', 'gateway', 'lock']],
    [identity[0], 'export const value = 2;\n', ['docs', 'gateway', 'lock']],
    [gateway[0], 'export const value = 2;\n', ['docs', 'identity', 'lock']],
    ['pnpm-lock.yaml', 'lockfileVersion: 9\n# changed\n', ['docs', 'identity', 'gateway']],
    [manifestPath, JSON.stringify({...manifest, dependencies: {adapter: '^2'}}), ['docs', 'identity', 'gateway']],
    [manifestPath, JSON.stringify({...manifest, license: 'MIT'}), modes],
    ['docs/waitron-integration-contract.md', '# Changed contract\n', modes],
    ['docs/cloud-cost-model.md', '# Changed cost\n', modes],
  ];
  for (const [path, source, stale] of changes) {
    git('reset', '--hard', base); put(path, source); commit();
    for (const mode of modes) {
      if (stale.includes(mode)) assert.throws(() => audit(mode), /Unreviewed/, `${path}: ${mode}`);
      else assert.doesNotThrow(() => audit(mode));
    }
  }
  for (const path of [identity[0], gateway[1], 'pnpm-lock.yaml', manifestPath]) {
    git('reset', '--hard', base); unlinkSync(join(root, path)); symlinkSync('README.md', join(root, path)); commit();
    assert.throws(() => audit(path === 'pnpm-lock.yaml' || path === manifestPath ? 'lock' : identity.includes(path) ? 'identity' : 'gateway'), /regular/);
  }
}));

test('v2 rejects malformed metadata and incomplete inventories', () => fixture(({root, git, put, commit, base, audit}) => {
  const path = recordPath('docs', 'package.json');
  const original = readFileSync(join(root, path), 'utf8');
  const record = JSON.parse(original);
  const corrupt = [
    original.replace('"version":2', '"version":2,"version":2'),
    original.replace('"mode"', '"\\u006dode"'), original.replace(/\n$/, ''),
    canonical({...record, extra: true}), canonical({...record, mode: 'other'}), canonical({...record, state: 'other'}),
    canonical({...record, objectId: 'A'.repeat(40)}), canonical({...record, path: '../outside'}),
    canonical({...record, path: '/outside'}), canonical({...record, path: 'packages/./stock'}),
    canonical({...record, gitType: 'tree'}), canonical({...record, state: 'manifest', sha256: '0'.repeat(64)}),
  ];
  for (const source of corrupt) {
    git('reset', '--hard', base); put(path, source); commit();
    for (const mode of modes) assert.throws(() => audit(mode));
  }
  for (const fault of ['marker', 'marker-missing', 'unknown', 'symlink', 'executable', 'missing-record', 'record-wrong-name', 'row-mode', 'added-row', 'removed-row', 'renamed-row']) {
    git('reset', '--hard', base);
    if (fault === 'marker') put(marker, '{"version":3}\n');
    if (fault === 'marker-missing') unlinkSync(join(root, marker));
    if (fault === 'unknown') put(`${recordRoot}notes.txt`, 'not evidence\n');
    if (fault === 'symlink') {unlinkSync(join(root, path)); symlinkSync('../elsewhere', join(root, path));}
    if (fault === 'executable') chmodSync(join(root, path), 0o755);
    if (fault === 'missing-record') unlinkSync(join(root, path));
    if (fault === 'record-wrong-name') {unlinkSync(join(root, path)); put(recordPath('docs', 'wrong'), original);}
    if (fault === 'row-mode') chmodSync(join(root, 'package.json'), 0o755);
    if (fault === 'added-row') put('scripts/new-reader.mjs', 'export const value = 1;\n');
    if (fault === 'removed-row') unlinkSync(join(root, 'package.json'));
    if (fault === 'renamed-row') git('mv', 'package.json', 'renamed.json');
    commit(); assert.throws(() => audit('docs'), undefined, fault);
  }
}));

// Deleting a source and its evidence must not erase the obligation to review removal.
test('v2 checks explicit removals and retains record names through children and merges', () => fixture(({root, git, put, commit, base, audit}) => {
  const source = 'packages/stock/src/index.mjs', record = recordPath('docs', source);
  unlinkSync(join(root, source));
  put(record, canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision: base}));
  const removed = commit(); assert.doesNotThrow(() => audit('docs'));
  // A valid removal stays valid across unrelated prose children.
  put('README.md', '# Child\n'); commit(); assert.doesNotThrow(() => audit('docs'));
  for (const previousRevision of ['f'.repeat(40), removed]) {
    git('reset', '--hard', removed);
    put(record, canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision}));
    commit(); assert.throws(() => audit('docs'), /tombstone|ancestor/i);
  }
  git('reset', '--hard', base); unlinkSync(join(root, source)); unlinkSync(join(root, record));
  const missing = commit(); put('README.md', '# Later\n'); commit();
  assert.throws(() => audit('docs'), /retained|retention/i);
  // Restoring the original evidence fixes retention, but remains stale until removal is reviewed.
  put(record, git('show', `${base}:${record}`)); commit(); assert.throws(() => audit('docs'), /tombstone/);
  put(record, canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision: base}));
  commit(); assert.doesNotThrow(() => audit('docs'));
  git('checkout', '-b', 'deleted-record', missing); put('README.md', '# Deleted branch child\n'); const child = commit();
  git('checkout', '-b', 'merge-parent', base); put('docs/backlog.md', '# Other branch\n'); commit();
  git('merge', '--no-ff', '--no-edit', '--signoff', child);
  assert.throws(() => audit('docs'), /retained|retention/i);
}));

test('v2 rejects old-state replay and unreviewed combined states', () => fixture(({git, put, commit, seed, base, audit}) => {
  const source = 'packages/stock/src/index.mjs';
  put(source, 'export const value = 2;\n'); seed(); const renewed = commit();
  assert.doesNotThrow(() => audit('docs'));
  put(source, 'export const value = 1;\n'); commit(); assert.throws(() => audit('docs'), /Unreviewed/);
  git('reset', '--hard', renewed); put(source, 'export const value = 3;\n'); commit(); assert.throws(() => audit('docs'), /Unreviewed/);
  // Unrelated records cannot authorize the third source state.
  assert.doesNotThrow(() => audit('docs', base));
}));

// Exempting a row is a reviewed removal, not permission to drop its old record.
test('v2 requires explicit transitions into prose exemptions and complete manifest membership', () => fixture(({root, git, put, commit, seed, audit}) => {
  put('docs/operator.md', '# Read as executable input\n'); chmodSync(join(root, 'docs/operator.md'), 0o755); seed();
  const base = commit(); assert.doesNotThrow(() => audit('docs'));
  chmodSync(join(root, 'docs/operator.md'), 0o644); commit(); assert.throws(() => audit('docs'), /tombstone/);
  put(recordPath('docs', 'docs/operator.md'), canonical({version: 2, mode: 'docs', path: 'docs/operator.md', state: 'absent', previousRevision: base}));
  commit(); assert.doesNotThrow(() => audit('docs'));
  put('docs/operator.md', '# Ordinary prose may now change\n'); commit(); assert.doesNotThrow(() => audit('docs'));
  put('packages/other/package.json', '{"name":"other","scripts":{"test":"node --test"}}\n'); seed(); commit();
  assert.throws(() => audit('lock'), /Incomplete manifest inventory/);
}));

test('v2 validates complete raw tree bytes before accepting path records', () => fixture(({root, git, put, commit, seed, audit}) => {
  for (const path of ['scripts/spaced reader.mjs', 'scripts/new\nline.mjs', 'scripts/literal\\reader.mjs', 'scripts/valid-\ufffd.mjs']) put(path, 'export const value = 1;\n');
  seed(); commit(); assert.doesNotThrow(() => audit('docs'));
  // Build raw Git index bytes: macOS refuses invalid UTF-8 filesystem names.
  const objectId = git('rev-parse', 'HEAD:scripts/identity-upstream.mjs').trim();
  const invalid = Buffer.concat([Buffer.from(`100644 ${objectId}\tscripts/invalid-`), Buffer.from([255]), Buffer.from('.mjs\0')]);
  execFileSync('git', ['update-index', '-z', '--index-info'], {cwd: root, input: invalid});
  for (const mode of modes) put(recordPath(mode, 'scripts/invalid-\ufffd.mjs'), canonical({version: 2, mode,
    path: 'scripts/invalid-\ufffd.mjs', state: 'present', gitMode: '100644', gitType: 'blob', objectId}));
  git('add', recordRoot); git('commit', '-sm', 'Invalid raw path fixture');
  assert.throws(() => audit('docs'), /UTF-8|roundtrip|tree bytes/);
}));

test('v2 discovers complete workspace membership before all-mode approval', async () => {
  const {auditAllInputModes} = await import('./ci-input-audit.mjs');
  fixture(({git, put, commit, seed, audit}) => {
    assert.doesNotThrow(() => auditAllInputModes(git('rev-parse', 'HEAD').trim(), git));
    put('packages/missing/src/reader.mjs', 'export const value = 1;\n'); seed(); commit();
    assert.throws(() => auditAllInputModes(git('rev-parse', 'HEAD').trim(), git), /Incomplete workspace manifest/);
    put('packages/missing/package.json', '{"name":"stock","scripts":{"test":"node --test"}}'); seed(); commit();
    assert.throws(() => auditAllInputModes(git('rev-parse', 'HEAD').trim(), git), /duplicate package/);
    assert.doesNotThrow(() => audit('docs'));
  });
});

test('v2 batches immutable record blobs once across all-mode checking', async () => {
  const {auditAllInputModes} = await import('./ci-input-audit.mjs');
  fixture(({git, base}) => {
    let batches = 0;
    const read = (...args) => git(...args);
    read.readBlobs = ids => {batches++; return git.readBlobs(ids);};
    assert.doesNotThrow(() => auditAllInputModes(base, read));
    assert.equal(batches, 1, 'One immutable inventory must not spawn a batch per mode');
  });
});

test('v2 rejects a manifest record for a non-workspace path in every selected mode', () => fixture(({put, commit, audit}) => {
  put(recordPath('lock', 'package.json'), canonical({version: 2, mode: 'lock', path: 'package.json', state: 'manifest', sha256: '0'.repeat(64)}));
  commit();
  for (const mode of modes) assert.throws(() => audit(mode), /manifest.*path/i);
}));

for (const fault of ['stale record', 'noncanonical record', 'invalid policy', 'invalid descriptor']) {
  test(`a removal refuses ${fault} at its named historical revision`, () => fixture(({root, git, put, commit, audit}) => {
    const source = 'packages/stock/src/index.mjs', record = recordPath('docs', source);
    const frozenPolicy = readFileSync(join(root, policy), 'utf8');
    const descriptor = readFileSync(join(root, marker), 'utf8');
    if (fault === 'stale record') put(source, 'export const changed = true;\n');
    if (fault === 'noncanonical record') put(record, JSON.stringify(JSON.parse(readFileSync(join(root, record), 'utf8')), null, 2) + '\n');
    if (fault === 'invalid policy') put(policy, '{"version":0}\n');
    if (fault === 'invalid descriptor') put(marker, '{"version":3}\n');
    const previousRevision = commit();
    put(policy, frozenPolicy); put(marker, descriptor); unlinkSync(join(root, source));
    put(record, canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision}));
    commit();
    assert.throws(() => audit('docs'), /Invalid audit tombstone/);
  }));
}

test('a removal refuses an independently reviewed tree outside its ancestry', () => fixture(({root, git, put, commit, seed, base, audit}) => {
  git('checkout', '--orphan', 'unrelated-review');
  put('README.md', '# Independently reviewed tree\n'); seed();
  const previousRevision = commit();
  assert.notEqual(previousRevision, base, 'The independent review must be a different commit');
  assert.throws(() => git('merge-base', '--is-ancestor', previousRevision, base));
  git('checkout', '-b', 'continued', base);
  const source = 'packages/stock/src/index.mjs'; unlinkSync(join(root, source));
  put(recordPath('docs', source), canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision}));
  commit();
  assert.throws(() => audit('docs'), /Invalid audit tombstone/);
}));

for (const fault of ['none', 'stale projection', 'invalid dependencies', 'symlink']) {
  test(`a lock removal checks its historical manifest: ${fault}`, () => fixture(({root, git, put, commit, base}) => {
    if (fault === 'stale projection') put(manifestPath, JSON.stringify({...manifest, license: 'MIT'}));
    if (fault === 'invalid dependencies') put(manifestPath, JSON.stringify({...manifest, dependencies: {adapter: 42}}));
    if (fault === 'symlink') {
      unlinkSync(join(root, manifestPath));
      // Parseable link bytes isolate the file-mode check from JSON validation.
      symlinkSync(JSON.stringify(manifest), join(root, manifestPath));
    }
    const previousRevision = fault === 'none' ? base : commit();
    unlinkSync(join(root, manifestPath));
    put(recordPath('lock', manifestPath), canonical({version: 2, mode: 'lock', path: manifestPath, state: 'absent', previousRevision}));
    const head = commit();
    const audit = () => auditInputMode('lock', head, git, []);
    if (fault === 'none') assert.doesNotThrow(audit);
    else assert.throws(audit, /Invalid audit tombstone/);
  }));
}

for (const input of ['policy', 'descriptor', 'record']) for (const kind of ['executable', 'symlink']) {
  test(`a removal refuses a historical ${kind} ${input}`, () => fixture(({root, put, commit, audit}) => {
    const source = 'packages/stock/src/index.mjs', record = recordPath('docs', source);
    const path = input === 'policy' ? policy : input === 'descriptor' ? marker : record;
    const original = readFileSync(join(root, path), 'utf8');
    if (kind === 'executable') chmodSync(join(root, path), 0o755);
    else {
      unlinkSync(join(root, path));
      // Identical blob bytes must not make a non-regular metadata entry authoritative.
      symlinkSync(original, join(root, path));
    }
    const previousRevision = commit();
    unlinkSync(join(root, path)); put(path, original);
    unlinkSync(join(root, source));
    put(record, canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision}));
    commit();
    assert.throws(() => audit('docs'), /Invalid audit tombstone/);
  }));
}
