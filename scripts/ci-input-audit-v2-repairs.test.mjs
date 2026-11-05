import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {readFileSync, unlinkSync, rmSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {fixture, recordPath, canonical} from './ci-input-audit-v2-fixture.mjs';

const cli = fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url));
const source = 'packages/stock/src/index.mjs', records = 'scripts/ci-input-audit.d';
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], {cwd: root, encoding: 'utf8'});
const renew = root => {const result = run(root, '--write-staged'); assert.equal(result.status, 0, result.stderr);};

for (const method of ['squash', 'rebase']) test(`removal evidence survives a multi-commit ${method} landing`, () => fixture(({root, git, put, commit, base, audit}) => {
  git('checkout', '-b', 'feature', base); put('README.md', '# First feature commit\n'); commit();
  unlinkSync(join(root, source)); git('add', '-A'); renew(root); commit();
  if (method === 'squash') {git('checkout', 'main'); git('merge', '--squash', 'feature'); git('commit', '-sm', 'Squash feature');}
  else {git('checkout', 'main'); put('docs/backlog.md', '# Independent main change\n'); commit(); git('checkout', 'feature'); git('rebase', 'main');}
  assert.doesNotThrow(() => audit('docs'));
  assert.equal(JSON.parse(readFileSync(join(root, recordPath('docs', source)), 'utf8')).previousRevision, base);
}));

test('the writer repairs a restored record after source and record were committed missing', () => fixture(({root, git, put, commit, base, audit}) => {
  const record = recordPath('docs', source);
  unlinkSync(join(root, source)); unlinkSync(join(root, record)); commit();
  put(record, git('show', `${base}:${record}`)); git('add', record); renew(root); commit();
  assert.doesNotThrow(() => audit('docs'));
}));

test('record retention treats a Git-detected rename as a reviewed deletion plus addition', () => fixture(({root, git, put, commit, base, audit}) => {
  const renamed = 'packages/stock/src/other.mjs', oldRecord = recordPath('docs', source), newRecord = recordPath('docs', renamed);
  git('config', 'diff.renames', 'true');
  git('mv', source, renamed); git('mv', oldRecord, newRecord);
  const record = JSON.parse(readFileSync(join(root, newRecord), 'utf8')); put(newRecord, canonical({...record, path: renamed}));
  const renamedHead = commit();
  assert.match(git('diff-tree', '--no-commit-id', '-r', '-M', '--name-status', base, renamedHead, '--', `${records}/docs`), /^R[0-9]+\t/m, 'The fixture must actually trigger Git rename detection');
  put(oldRecord, canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision: base})); commit();
  assert.doesNotThrow(() => audit('docs'));
  unlinkSync(join(root, renamed)); unlinkSync(join(root, newRecord)); commit();
  assert.throws(() => audit('docs'), /retained/);
}));

test('removing invalid historical junk restores a canonical record inventory', () => fixture(({root, put, commit, audit}) => {
  put(`${records}/notes.txt`, '{}\n'); commit();
  unlinkSync(join(root, `${records}/notes.txt`)); commit();
  assert.doesNotThrow(() => audit('docs'));
}));

test('removing all v2 metadata cannot reactivate historical v1 authority', () => fixture(({root, git, commit}) => {
  rmSync(join(root, records), {recursive: true}); unlinkSync(join(root, 'scripts/ci-input-audit-v2.json')); unlinkSync(join(root, source)); commit();
  const before = readFileSync(join(root, 'scripts/ci-input-audit.json'));
  const result = run(root, '--write-staged'); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readFileSync(join(root, 'scripts/ci-input-audit.json')), before);
  assert.notEqual(run(root, '--check', git('rev-parse', 'HEAD').trim()).status, 0);
}));

test('a valid sibling-branch record cannot authorize a tombstone in this ancestry', () => fixture(({root, git, put, commit, seed, base, audit}) => {
  git('checkout', '-b', 'sibling', base); put(source, 'export const value = 2;\n'); seed(); const sibling = commit();
  git('checkout', 'main'); unlinkSync(join(root, source));
  put(recordPath('docs', source), canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision: sibling})); commit();
  assert.throws(() => audit('docs'), /ancestor|tombstone/i);
}));

test('an ancestor with a stale record cannot authorize removal', () => fixture(({root, put, commit, audit}) => {
  put(source, 'export const value = 2;\n'); const stale = commit(); unlinkSync(join(root, source));
  put(recordPath('docs', source), canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision: stale})); commit();
  assert.throws(() => audit('docs'), /Stale.*ancestor|tombstone/i);
}));

test('a peer record stored under the wrong hash fails documentation metadata validation', () => fixture(({root, git, commit, audit}) => {
  git('checkout', '--orphan', 'malformed-metadata-root');
  git('mv', recordPath('identity', 'package.json'), recordPath('identity', 'wrong-path')); commit();
  assert.throws(() => audit('docs'), /filename/);
}));

test('invalid UTF-8 metadata cannot impersonate a valid replacement character', () => fixture(({root, git, put, commit, seed, audit}) => {
  const path = 'scripts/valid-\ufffd.mjs'; put(path, 'export const value = 1;\n'); seed(); commit();
  const record = recordPath('identity', path), bytes = readFileSync(join(root, record));
  const at = bytes.indexOf(Buffer.from('\ufffd')); assert.ok(at >= 0);
  const corrupt = Buffer.concat([bytes.subarray(0, at), Buffer.from([255]), bytes.subarray(at + 3)]);
  const id = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: root, input: corrupt, encoding: 'utf8'}).trim();
  execFileSync('git', ['update-index', '--cacheinfo', '100644', id, record], {cwd: root}); git('commit', '-sm', 'Invalid encoded metadata');
  assert.throws(() => audit('docs'), /UTF-8|metadata.*bytes|blob/i);
}));

test('a symbolic revision is resolved afresh after HEAD moves', async () => {
  const {readInputAudit} = await import('./ci-input-audit.mjs');
  fixture(({git, put, commit}) => {
    const before = readInputAudit('HEAD', git).entries.length;
    put('scripts/additional.mjs', 'export const value = 1;\n'); commit();
    assert.equal(readInputAudit('HEAD', git).entries.length, before + 1);
  });
});

test('selected documentation checking does not impose lock workspace semantics', () => fixture(({root, git, put, commit, seed}) => {
  put('packages/other/package.json', '{"name":"stock","scripts":{"test":"node --test"}}\n'); seed(); const head = commit();
  assert.equal(run(root, '--check-mode', 'docs', head).status, 0);
  assert.notEqual(run(root, '--check', head).status, 0);
}));

test('the writer refuses branch-only add-and-remove evidence before changing outputs', () => fixture(({root, git, put, commit}) => {
  git('checkout', '-b', 'feature'); put('scripts/transient.mjs', 'export const value = 1;\n'); git('add', '-A'); renew(root); commit();
  const evidence = recordPath('docs', 'scripts/transient.mjs'), before = readFileSync(join(root, evidence));
  unlinkSync(join(root, 'scripts/transient.mjs')); git('add', '-A');
  const result = run(root, '--write-staged'); assert.notEqual(result.status, 0); assert.match(result.stderr, /target ancestor|unlanded/);
  assert.deepEqual(readFileSync(join(root, evidence)), before);
}));

test('the v1 policy remains frozen after v2 activation', () => fixture(({root, put, commit, audit}) => {
  const policy = 'scripts/ci-input-audit.json', value = JSON.parse(readFileSync(join(root, policy), 'utf8'));
  put(policy, JSON.stringify({...value, docsInputSha256: '1'.repeat(64)})); commit();
  assert.throws(() => audit('docs'), /frozen|v1.*policy/i);
}));


test('a read-only changed output refuses before any earlier record is written', () => fixture(({root, git, put}) => {
  const first = recordPath('docs', 'package.json'), second = recordPath('docs', source);
  const before = readFileSync(join(root, first));
  put('package.json', '{"private":true,"description":"changed"}\n'); put(source, 'export const value = 2;\n'); git('add', '-A');
  chmodSync(join(root, second), 0o444);
  try { const result = run(root, '--write-staged'); assert.notEqual(result.status, 0); assert.deepEqual(readFileSync(join(root, first)), before); }
  finally {chmodSync(join(root, second), 0o644);}
}));

test('the writer repairs an old branch-only proof after its squash has landed', () => fixture(({root, git, put, commit, base, audit}) => {
  git('checkout', '-b', 'feature', base); put('README.md', '# Branch-only ancestor\n'); const ephemeral = commit();
  unlinkSync(join(root, source)); put(recordPath('docs', source), canonical({version: 2, mode: 'docs', path: source, state: 'absent', previousRevision: ephemeral})); commit();
  git('checkout', 'main'); git('merge', '--squash', 'feature'); git('commit', '-sm', 'Squashed old proof');
  assert.throws(() => audit('docs'), /tombstone|ancestor/); renew(root); commit();
  assert.doesNotThrow(() => audit('docs'));
  assert.equal(JSON.parse(readFileSync(join(root, recordPath('docs', source)), 'utf8')).previousRevision, base);
}));

test('many distinct removal ancestors use bounded path proofs', async () => {
  const {auditInputMode} = await import('./ci-input-audit.mjs');
  fixture(({root, git, put, commit, seed}) => {
    const reviewed = [];
    for (let i = 0; i < 16; i++) {const path = `scripts/reviewed-${i}.mjs`; put(path, 'export const value = 1;\n'); seed(); reviewed.push([path, commit()]);}
    for (const [path, previousRevision] of reviewed) {
      unlinkSync(join(root, path)); put(recordPath('docs', path), canonical({version: 2, mode: 'docs', path, state: 'absent', previousRevision}));
    }
    const head = commit(); let commands = 0;
    const read = (...args) => {commands++; return git(...args);};
    read.readBlobs = ids => {commands++; return git.readBlobs(ids);};
    assert.doesNotThrow(() => auditInputMode('docs', head, read));
    assert.ok(commands < 100, `Prior-path proof must not audit each ancestor's whole inventory: ${commands}`);
  });
});


test('a read-only parent refuses a new record before earlier records change', () => fixture(({root, git, put}) => {
  const first = recordPath('docs', 'package.json'), directory = join(root, records, 'docs');
  const before = readFileSync(join(root, first));
  put('package.json', '{"private":true,"description":"changed"}\n'); put('scripts/new-reader.mjs', 'export const value = 1;\n'); git('add', '-A');
  chmodSync(directory, 0o555);
  try {const result = run(root, '--write-staged'); assert.notEqual(result.status, 0); assert.deepEqual(readFileSync(join(root, first)), before);}
  finally {chmodSync(directory, 0o755);}
}));
