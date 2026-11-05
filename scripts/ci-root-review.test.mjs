import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {rootReviewFixture as fixture} from './ci-root-review-fixture.mjs';
import {fileURLToPath, pathToFileURL} from 'node:url';

const api = await import('./ci-root-review.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const registryPath = 'scripts/ci-root-inputs.json';
const recordRoot = 'scripts/ci-root-review.d/';
const recordPath = path => recordRoot + createHash('sha256').update(path).digest('hex') + '.json';
const targets = ['scripts/ci-root-shards.test.mjs', 'scripts/verify-backup-capacity-receipt.test.mjs', 'deploy/local-stack/operations-health.test.mjs'];


test('review projection pins targets, readers, checker, registry and manifests but excludes audited prose and evidence', () => fixture(({git, base}) => {
  const projection = api.rootReviewProjection(base, git);
  assert.deepEqual(projection.inputs.map(e => e.path), ['deploy/local-stack/operations-health.test.mjs', 'package.json',
    'scripts/ci-root-inputs.json', 'scripts/ci-root-review.mjs', 'scripts/ci-root-shards.test.mjs', 'scripts/reader.mjs',
    'scripts/verify-backup-capacity-receipt.test.mjs']);
  assert.equal(projection.registryObjectId, git('rev-parse', `${base}:${registryPath}`).trim());
  const registry = api.checkRootReview(base, git);
  assert.deepEqual(registry.entries.map(e => e.id), ['root-partition-contract', 'capacity-verifier-test', 'local-health-test']);
}));

test('renewal requires explicit inputs and provenance, reads only staged bytes and never stages outputs', () => fixture(({root, git, write, cli, docs, commit}) => {
  const renewArgs = ['--write-staged', '--input', 'scripts/reader.mjs', '--reviewer', 'Named reviewer', '--reference', 'review/renewal'];
  for (const args of [[], ['--write-staged'], renewArgs.filter(a => a !== '--input' && a !== 'scripts/reader.mjs'),
    [...renewArgs, '--input', 'scripts/reader.mjs'], [...renewArgs, '--command', 'touch /unowned']]) {
    assert.notEqual(cli(args).status, 0, `Must refuse ambiguous approval: ${args}`);
  }
  write('scripts/reader.mjs', 'staged bytes\n'); git('add', '--', 'scripts/reader.mjs');
  const stagedId = git('rev-parse', ':scripts/reader.mjs').trim();
  write('scripts/reader.mjs', 'unstaged bytes\n');
  const stagedBefore = git('diff', '--cached', '--name-only');
  let result = cli(renewArgs); assert.equal(result.status, 0, result.stdout + result.stderr);
  const path = recordPath('scripts/reader.mjs'), source = readFileSync(join(root, path), 'utf8');
  assert.equal(JSON.parse(source).objectId, stagedId);
  assert.equal(JSON.parse(source).reviewer, 'Named reviewer');
  assert.equal(JSON.parse(source).reference, 'review/renewal');
  assert.equal(git('diff', '--cached', '--name-only'), stagedBefore);
  result = cli(renewArgs); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, path), 'utf8'), source);
  git('restore', '--worktree', '--', 'scripts/reader.mjs'); docs(); const head = commit();
  result = cli(['--check', head]); assert.equal(result.status, 0, result.stdout + result.stderr);
}));

test('renewal preflights symlinks hard links and unknown collisions before writing any record', () => fixture(({root, git, cli, base}) => {
  const first = recordPath('package.json'), second = recordPath('scripts/reader.mjs');
  const firstSource = readFileSync(join(root, first), 'utf8'), original = readFileSync(join(root, second), 'utf8');
  const args = ['--write-staged', '--input', 'package.json', '--input', 'scripts/reader.mjs', '--reviewer', 'reviewer', '--reference', 'review/links'];
  for (const kind of ['symlink', 'hardlink', 'parent', 'collision', 'readonly']) {
    git('reset', '--hard', base);
    if (kind === 'parent') {
      const saved = join(root, 'saved-records'); mkdirSync(saved);
      rmSync(join(root, recordRoot), {recursive: true}); symlinkSync(saved, join(root, recordRoot.slice(0, -1)));
    } else if (kind === 'collision') writeFileSync(join(root, recordRoot, 'unknown.json'), '{}\n');
    else if (kind === 'readonly') chmodSync(join(root, second), 0o444);
    else {
      rmSync(join(root, second));
      if (kind === 'symlink') symlinkSync(join(root, first), join(root, second));
      else linkSync(join(root, first), join(root, second));
    }
    const result = cli(args); assert.notEqual(result.status, 0, `Must refuse ${kind}: ${result.stdout}`);
    if (kind !== 'parent') assert.equal(readFileSync(join(root, first), 'utf8'), firstSource);
    if (kind === 'parent') {
      rmSync(join(root, recordRoot.slice(0, -1))); rmSync(join(root, 'saved-records'), {recursive: true});
      mkdirSync(join(root, recordRoot));
    }
    if (kind === 'collision') rmSync(join(root, recordRoot, 'unknown.json'));
    if (kind === 'readonly') chmodSync(join(root, second), 0o644);
    if (kind === 'symlink' || kind === 'hardlink') rmSync(join(root, second));
    writeFileSync(join(root, second), original);
  }
}));

test('removed inputs require retained evidence from a reviewed target ancestor', () => fixture(({root, git, cli, docs, commit, base}) => {
  rmSync(join(root, 'scripts/reader.mjs')); git('add', '-A');
  const args = ['--write-staged', '--input', 'scripts/reader.mjs', '--reviewer', 'reviewer', '--reference', 'review/removal'];
  let result = cli(args); assert.equal(result.status, 0, result.stdout + result.stderr);
  const record = JSON.parse(readFileSync(join(root, recordPath('scripts/reader.mjs'))));
  assert.equal(record.state, 'absent'); assert.equal(record.previousRevision, base);
  docs(); const removed = commit(); assert.doesNotThrow(() => api.checkRootReview(removed, git));
  rmSync(join(root, recordPath('scripts/reader.mjs'))); docs();
  assert.throws(() => api.checkRootReview(commit(), git), /must be retained/);
}));

test('a retained removal cannot claim a different registry identity', () => fixture(({root, git, write, renew, docs, commit, base}) => {
  const path = 'scripts/reader.mjs', record = JSON.parse(readFileSync(join(root, recordPath(path)), 'utf8'));
  rmSync(join(root, path));
  write(recordPath(path), {version: 1, path, state: 'absent', previousRevision: base,
    registryObjectId: record.registryObjectId, reviewer: 'reviewer', reference: 'review/removal-identity'});
  docs(); const removed = commit(); assert.doesNotThrow(() => api.checkRootReview(removed, git));
  write(recordPath(path), {...JSON.parse(readFileSync(join(root, recordPath(path)), 'utf8')), registryObjectId: '0'.repeat(40)});
  docs(); assert.throws(() => api.checkRootReview(commit(), git), /Invalid root review tombstone/);
}));

test('unrelated branches renew different records and merge in either order', () => fixture(({root, git, write, renew, docs, commit, base}) => {
  // V2 docs records also avoid a shared policy rewrite, as on the real branch.
  write('scripts/identity-upstream.mjs', 'identity\n'); write('scripts/identity-upstream.test.mjs', 'identity test\n');
  write('scripts/verify-gateway-reconnection-receipt.mjs', 'gateway\n'); write('scripts/verify-gateway-reconnection-receipt.test.mjs', 'gateway test\n');
  write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
  write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
  write('packages/control/package.json', {name: 'control', scripts: {test: 'node --test test.mjs'}});
  git('add', '-A'); const tree = git('write-tree').trim();
  renew(git('ls-tree', '-rz', '--full-tree', tree).split('\0').filter(Boolean).map(row => row.split('\t')[1])
    .filter(path => path !== 'scripts/ci-input-audit.json' && !path.startsWith(recordRoot) && !path.endsWith('.md')));
  const audit = args => spawnSync(process.execPath, [fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), ...args], {cwd: root, encoding: 'utf8', timeout: 30_000});
  git('add', '-A'); let result = audit(['--init-v2-staged']); assert.equal(result.status, 0, result.stdout + result.stderr);
  const common = commit(), policy = readFileSync(join(root, 'scripts/ci-input-audit.json'), 'utf8');
  const saved = readFileSync(join(root, recordPath(registryPath)), 'utf8');
  for (const [branch, path] of [['left', targets[0]], ['right', targets[1]]]) {
    git('checkout', '-qb', branch, common); write(path, branch + '\n'); renew([path]); git('add', '-A');
    result = audit(['--write-staged', '--mode', 'docs']); assert.equal(result.status, 0, result.stdout + result.stderr);
    const head = commit(); assert.doesNotThrow(() => api.checkRootReview(head, git));
    assert.deepEqual(git('diff', '--name-only', common, head, '--', recordRoot).trim().split('\n'), [recordPath(path)]);
    assert.equal(readFileSync(join(root, 'scripts/ci-input-audit.json'), 'utf8'), policy);
    assert.equal(readFileSync(join(root, recordPath(registryPath)), 'utf8'), saved);
  }
  for (const [first, second] of [['left', 'right'], ['right', 'left']]) {
    git('checkout', '-qB', 'merge-control', first); git('merge', '--no-ff', '--signoff', '-qm', 'Merge independent reviews', second);
    assert.doesNotThrow(() => api.checkRootReview(git('rev-parse', 'HEAD').trim(), git));
  }
}));

test('target reader bytes require renewal, independently from the documentation audit', () => fixture(({git, write, commit, docs, renew, base}) => {
  for (const path of [targets[0], 'scripts/reader.mjs', 'package.json']) {
    write(path, 'changed bytes\n'); docs(); const stale = commit();
    assert.throws(() => api.checkRootReview(stale, git), /Unreviewed root input/);
    renew([path]); const withoutDocs = commit();
    assert.doesNotThrow(() => api.rootReviewProjection(withoutDocs, git));
    assert.throws(() => api.checkRootReview(withoutDocs, git), /document audit/);
    docs(); assert.doesNotThrow(() => api.checkRootReview(commit(), git));
  }
  assert.doesNotThrow(() => api.checkRootReview(base, git));
}));

test('new reader cannot inherit approval', () => fixture(({git, write, commit, docs, renew}) => {
  write('scripts/new-reader.mjs', "readFileSync('scripts/ci-root-shards.test.mjs');\n"); docs();
  assert.throws(() => api.checkRootReview(commit(), git), /Unreviewed root input: scripts\/new-reader.mjs/);
  renew(['scripts/new-reader.mjs']); docs(); assert.doesNotThrow(() => api.checkRootReview(commit(), git));
}));

test('missing stale or removed evidence refuses', () => fixture(({root, git, commit, docs, base}) => {
  for (const mode of ['missing', 'stale', 'removed']) {
    git('reset', '--hard', base);
    const path = recordPath('scripts/reader.mjs');
    if (mode === 'stale') {
      const record = JSON.parse(readFileSync(join(root, path))); record.objectId = '0'.repeat(40);
      writeFileSync(join(root, path), JSON.stringify(record) + '\n');
    } else rmSync(join(root, path));
    docs(); assert.throws(() => api.checkRootReview(commit(), git), /Unreviewed root input|must be retained/);
  }
}));

test('review metadata is not a command and rejects unknown duplicate and noncanonical fields', () => fixture(({root, git, write, commit, docs, base}) => {
  const path = recordPath('scripts/reader.mjs'), original = readFileSync(join(root, path), 'utf8');
  for (const source of [original.replace('"version":1', '"version":1,"version":1'),
    original.replace('"version":1', '"version":1,"command":"touch /unowned"'), original.trim(),
    original.replace('"reviewer":"CI reviewer"', '"reviewer":""'), original.replace('"registryObjectId":', '"unexpectedRegistry":')]) {
    git('reset', '--hard', base); write(path, source); docs();
    assert.throws(() => api.checkRootReview(commit(), git), /root review|root record|root provenance/i);
  }
}));

test('registry has finite owners and refuses duplicate fields and undeclared commands', () => fixture(({root, git, write, commit, docs, base}) => {
  const source = readFileSync(join(root, registryPath), 'utf8');
  for (const invalid of [source.replace('"version":1', '"version":1,"version":1'),
    source.replace('test:backup-capacity', 'proof:backup-capacity'), source.replace('"sites":', '"command":"provider apply","sites":'),
    source.replace('scripts/ci-root-shards.test.mjs', '../ci-root-shards.test.mjs')]) {
    git('reset', '--hard', base); write(registryPath, invalid); docs();
    assert.throws(() => api.checkRootReview(commit(), git), /root registry|root owner|root path|Duplicate/i);
  }
}));

test('unsupported tracked modes and missing targets cannot receive current review', () => fixture(({root, git, write, renew, docs, commit, base}) => {
  for (const kind of ['executable-target', 'symlink-target', 'submodule-target', 'removed-target', 'renamed-target', 'symlink-reader', 'submodule-reader']) {
    git('reset', '--hard', base);
    const path = kind.endsWith('reader') ? 'scripts/reader.mjs' : targets[0];
    if (kind === 'executable-target') {chmodSync(join(root, path), 0o755); git('add', '--', path);}
    else if (kind.startsWith('submodule')) {
      rmSync(join(root, path)); mkdirSync(join(root, path));
      const nested = (...args) => execFileSync('git', args, {cwd: join(root, path), stdio: 'pipe'});
      nested('init', '-q'); nested('config', 'user.name', 'CI test'); nested('config', 'user.email', 'ci@example.test');
      write(path + '/input', 'submodule\n'); nested('add', '-A'); nested('commit', '-s', '-qm', 'Save submodule control');
      git('add', '-A'); assert.match(git('ls-files', '--stage', '--', path), /^160000 /);
    }
    else {
      rmSync(join(root, path));
      if (kind.startsWith('symlink')) symlinkSync('package.json', join(root, path));
      else if (kind === 'renamed-target') write('scripts/moved.test.mjs', 'moved target\n');
      git('add', '-A');
    }
    if (kind.endsWith('reader')) renew([path]);
    docs();
    assert.throws(() => api.checkRootReview(commit(), git), /regular root|root input mode/, kind);
    // Restore actual files before the next index-only submodule control.
    if (kind.startsWith('submodule')) rmSync(join(root, path), {recursive: true});
    git('reset', '--hard', base); git('clean', '-fdq');
  }
}));

test('complete raw inventories reject malformed paths duplicate rows truncated NUL and invalid UTF-8', () => fixture(({git, base}) => {
  const original = git('ls-tree', '-rz', '--full-tree', base, {binary: true});
  for (const invalid of [original.subarray(0, -1), Buffer.concat([original, original]),
    Buffer.from(original.toString().replace('package.json\0', '../package.json\0')),
    Buffer.concat([original.subarray(0, -1), Buffer.from([0xff, 0])])]) {
    const corrupt = (...args) => args[0] === 'ls-tree' ? invalid : git(...args); corrupt.readBlobs = git.readBlobs;
    assert.throws(() => api.rootReviewProjection(base, corrupt), /inventory|path|UTF-8|encoded data/);
  }
}));

test('historical activation survives complete metadata removal and refuses shallow history', () => fixture(({root, git, commit, docs, base}) => {
  assert.equal(typeof api.rootReviewActivated, 'function', 'Mandatory summary needs activation from history');
  assert.equal(api.rootReviewActivated(base, git), true);
  rmSync(join(root, registryPath)); rmSync(join(root, recordRoot), {recursive: true}); docs();
  const removed = commit(); assert.equal(api.rootReviewActivated(removed, git), true);
  assert.throws(() => api.checkRootReview(removed, git), /Missing root registry/);
  const shallow = (...args) => args.includes('--is-shallow-repository') ? 'true\n' : git(...args);
  shallow.readBlobs = git.readBlobs;
  assert.throws(() => api.rootReviewActivated(removed, shallow), /complete history/);
  assert.throws(() => api.checkRootReview(base, shallow), /complete history/);
}));

test('removal evidence cannot refer to an unreviewed or unrelated ancestor', () => fixture(({root, git, write, commit, docs, base}) => {
  rmSync(join(root, 'scripts/reader.mjs'));
  const registryObjectId = git('rev-parse', `${base}:${registryPath}`).trim();
  write(recordPath('scripts/reader.mjs'), {version: 1, path: 'scripts/reader.mjs', state: 'absent', previousRevision: base,
    registryObjectId, reviewer: 'reviewer', reference: 'review/control'});
  docs(); const absent = commit(); assert.doesNotThrow(() => api.checkRootReview(absent, git));
  const record = JSON.parse(readFileSync(join(root, recordPath('scripts/reader.mjs'))));
  record.previousRevision = absent; write(recordPath('scripts/reader.mjs'), record); docs();
  assert.throws(() => api.checkRootReview(commit(), git), /Unreviewed root tombstone ancestor/);
}));

test('removing the required checker cannot be approved as an ordinary input removal', () => fixture(({root, git, cli, docs, commit}) => {
  rmSync(join(root, 'scripts/ci-root-review.mjs')); git('add', '-A');
  const result = cli(['--write-staged', '--input', 'scripts/ci-root-review.mjs', '--reviewer', 'reviewer', '--reference', 'review/checker-removal']);
  assert.notEqual(result.status, 0, 'The checker must remain a regular required input');
  docs(); assert.throws(() => api.checkRootReview(commit(), git), /Missing regular root review checker/);
}));

test('registry sites cannot duplicate a reviewed reader with reordered fields', () => fixture(({root, git, write, docs, commit}) => {
  const registry = JSON.parse(readFileSync(join(root, registryPath))), site = registry.entries[0].sites[0];
  registry.entries[0].sites.push({role: site.role, boundary: site.boundary, kind: site.kind, site: site.site, reader: site.reader});
  write(registryPath, registry); docs();
  assert.throws(() => api.checkRootReview(commit(), git), /Duplicate root registry site/);
}));

test('several removals inspect their common reviewed ancestor only once', () => fixture(({root, git, write, renew, docs, cli, commit}) => {
  write('scripts/second-reader.mjs', 'second reader\n');
  renew(['scripts/reader.mjs', 'scripts/second-reader.mjs'], 'reviewer', 'review/common-ancestor'); docs();
  const ancestor = commit();
  for (const path of ['scripts/reader.mjs', 'scripts/second-reader.mjs']) rmSync(join(root, path));
  git('add', '-A');
  const result = cli(['--write-staged', '--input', 'scripts/reader.mjs', '--input', 'scripts/second-reader.mjs',
    '--reviewer', 'reviewer', '--reference', 'review/bounded-removals']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  docs(); const head = commit(); let ancestorInventories = 0;
  const observe = (...args) => {
    if (args[0] === 'ls-tree' && args.includes(ancestor)) ancestorInventories++;
    return git(...args);
  };
  observe.readBlobs = git.readBlobs;
  assert.doesNotThrow(() => api.checkRootReview(head, observe));
  assert.equal(ancestorInventories, 1, 'Removal proof must scale with distinct ancestors, not removed input count');
}));

test('staged removal renewal reads a shared ancestor once', () => fixture(({root, git, write, renew, docs, commit}) => {
  write('scripts/reader.mjs', 'changed first reader\n');
  write('scripts/second-reader.mjs', 'second reader\n');
  renew(['scripts/reader.mjs', 'scripts/second-reader.mjs']); docs();
  const ancestor = commit(), registryObjectId = git('rev-parse', `${ancestor}:${registryPath}`).trim();
  for (const path of ['scripts/reader.mjs', 'scripts/second-reader.mjs']) rmSync(join(root, path));
  git('add', '-A');
  const bin = join(root, 'probe-bin'), calls = join(root, 'git-calls.jsonl'); mkdirSync(bin);
  writeFileSync(join(bin, 'package.json'), '{"type":"module"}\n');
  const realGit = execFileSync('which', ['git'], {encoding: 'utf8'}).trim();
  writeFileSync(join(bin, 'git'), `#!${process.execPath}\n` +
    `import {appendFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';\n` +
    `const args=process.argv.slice(2); appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');\n` +
    `const result=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'}); process.exit(result.status??1);\n`, {mode: 0o700});
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-root-review.mjs', import.meta.url)),
    '--write-staged', '--input', 'scripts/reader.mjs', '--input', 'scripts/second-reader.mjs',
    '--reviewer', 'Removal reviewer', '--reference', 'review/bounded-cli'],
  {cwd: root, encoding: 'utf8', timeout: 30_000, env: {...process.env, PATH: `${bin}:${process.env.PATH}`}});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const observed = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(observed.filter(args => args[0] === 'ls-tree' && args.includes(ancestor)).length, 1,
    'Renewing several removals must share their immutable ancestor inventory');
  for (const path of ['scripts/reader.mjs', 'scripts/second-reader.mjs']) {
    assert.deepEqual(JSON.parse(readFileSync(join(root, recordPath(path)))), {version: 1, path, state: 'absent',
      previousRevision: ancestor, registryObjectId, reviewer: 'Removal reviewer', reference: 'review/bounded-cli'});
  }
}));

test('a genuine shallow checkout refuses admission until its history is fetched', () => fixture(({root, base}) => {
  const scratch = mkdtempSync(join(tmpdir(), 'cloud-root-shallow-')), checkout = join(scratch, 'checkout');
  const program = fileURLToPath(new URL('./ci-root-review.mjs', import.meta.url));
  try {
    execFileSync('git', ['clone', '--quiet', '--depth=1', pathToFileURL(root).href, checkout], {stdio: 'pipe'});
    const check = revision => spawnSync(process.execPath, [program, '--check', revision],
      {cwd: checkout, encoding: 'utf8', timeout: 30_000});
    const shallow = check(base);
    assert.equal(shallow.status, 1, shallow.stdout + shallow.stderr);
    assert.match(shallow.stderr, /requires complete history/);
    const missing = check('0'.repeat(40));
    assert.equal(missing.status, 1, 'A missing object cannot receive review authority');
    execFileSync('git', ['-C', checkout, 'fetch', '--unshallow'], {stdio: 'pipe'});
    const complete = check(base);
    assert.equal(complete.status, 0, complete.stdout + complete.stderr);
    assert.match(complete.stdout, /Root input review is current/);
  } finally {rmSync(scratch, {recursive: true, force: true});}
}));
