import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync, chmodSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const script = new URL('./snapshot.py', import.meta.url).pathname;
function invoke(...args) {
  return spawnSync('python3', [script, ...args], {encoding: 'utf8', timeout: 10000});
}
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'disposable-snapshot-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const root = join(base, 'source');
  mkdirSync(root);
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  const put = (name, content) => {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), content);
  };
  return {base, root, put, archive: join(base, 'source.tar')};
}
function stage(f, ...names) { assert.equal(spawnSync('git', ['-C', f.root, 'add', '--force', '--', ...names]).status, 0); }
function create(f) { return invoke('create', f.root, f.archive); }
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

// Omitting the working-tree read would lose the candidate's uncommitted edits.
test('a snapshot carries intended edits and executable modes with a reproducible content digest', t => {
  const f = fixture(t);
  f.put('app.mjs', 'export const value = 1;\n');
  assert.equal(spawnSync('git', ['-C', f.root, 'add', '.']).status, 0);
  f.put('app.mjs', 'export const value = 2;\n');
  f.put('scripts/run.sh', '#!/bin/sh\nexit 3\n');
  chmodSync(join(f.root, 'scripts/run.sh'), 0o755);
  stage(f, 'scripts/run.sh');
  const result = create(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sha256, digest(f.archive));
  const second = join(f.base, 'second.tar');
  assert.equal(invoke('create', f.root, second).status, 0);
  assert.deepEqual(readFileSync(second), readFileSync(f.archive));
  const target = join(f.base, 'guest'); mkdirSync(target);
  const unpacked = invoke('extract', f.archive, digest(f.archive), target);
  assert.equal(unpacked.status, 0, unpacked.stderr);
  assert.equal(readFileSync(join(target, 'app.mjs'), 'utf8'), 'export const value = 2;\n');
  assert.equal(spawnSync(join(target, 'scripts/run.sh')).status, 3);
});

// Removing an exclusion must put a named credential or dependency in the archive.
test('snapshots exclude Git state, environment files, credentials, dependencies and ignored output', t => {
  const f = fixture(t);
  f.put('app.mjs', 'safe'); f.put('.gitignore', 'ignored-output/\n');
  const excludedPaths = ['.env', '.env.example', 'packages/app/.env.local', '.npmrc', '.netrc', '.ssh/id_ed25519', '.aws/config', 'credentials.json', 'nested/service.key', 'nested/client.pem', 'node_modules/package/index.js', 'packages/app/node_modules/a/index.js', '.pnpm-store/token', 'ignored-output/bundle.js', 'scripts/__pycache__/adapter.cpython-313.pyc', 'scripts/__pycache__/index', 'legacy.pyc'];
  for (const name of excludedPaths) f.put(name, 'DO-NOT-COPY');
  stage(f, 'app.mjs', '.gitignore', ...excludedPaths.filter(name => !name.startsWith('ignored-output/')));
  const result = create(f); assert.equal(result.status, 0, result.stderr);
  const target = join(f.base, 'guest'); mkdirSync(target);
  const unpacked = invoke('extract', f.archive, digest(f.archive), target);
  assert.equal(unpacked.status, 0, unpacked.stderr);
  assert.deepEqual(readdirSync(target).sort(), ['.gitignore', 'app.mjs']);
  assert.equal(readFileSync(f.archive).includes(Buffer.from('DO-NOT-COPY')), false);
});

test('a source symlink cannot read outside the checkout or follow a directory escape', t => {
  for (const directory of [false, true]) {
    const f = fixture(t); const outside = join(f.base, 'outside'); mkdirSync(outside);
    writeFileSync(join(outside, 'private'), 'NEVER-COPY');
    symlinkSync(directory ? outside : join(outside, 'private'), join(f.root, 'linked'));
    stage(f, 'linked');
    const result = create(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink|regular file/i);
    assert.equal(readdirSync(f.base).includes('source.tar'), false);
  }
});

test('archive verification refuses a changed digest before writing any guest file', t => {
  const f = fixture(t); f.put('app.mjs', 'safe'); stage(f, 'app.mjs');
  assert.equal(create(f).status, 0);
  const target = join(f.base, 'guest'); mkdirSync(target);
  const result = invoke('extract', f.archive, '0'.repeat(64), target);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /digest/i);
  assert.deepEqual(readdirSync(target), []);
});

test('a hard link cannot copy an outside credential under an innocent source filename', t => {
  const f = fixture(t);
  writeFileSync(join(f.base, 'outside-credential'), 'NEVER-COPY');
  linkSync(join(f.base, 'outside-credential'), join(f.root, 'app.mjs'));
  stage(f, 'app.mjs');
  const result = create(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hard link/i);
  assert.equal(readdirSync(f.base).includes('source.tar'), false);
});

test('an existing snapshot or nonempty destination is preserved rather than overwritten', t => {
  const f = fixture(t); f.put('app.mjs', 'safe'); stage(f, 'app.mjs');
  assert.equal(create(f).status, 0);
  const before = readFileSync(f.archive);
  f.put('app.mjs', 'changed');
  assert.notEqual(create(f).status, 0);
  assert.deepEqual(readFileSync(f.archive), before);
  const target = join(f.base, 'guest'); mkdirSync(target); writeFileSync(join(target, 'kept'), 'owned');
  assert.notEqual(invoke('extract', f.archive, digest(f.archive), target).status, 0);
  assert.deepEqual(readdirSync(target), ['kept']);
});

test('a crafted archive cannot create a path escape, link, device or duplicate', t => {
  const f = fixture(t);
  for (const kind of ['escape', 'absolute', 'symlink', 'hardlink', 'device', 'duplicate', 'credential']) {
    const archive = join(f.base, `${kind}.tar`);
    const built = spawnSync('python3', ['-c', `import io,sys,tarfile
with tarfile.open(sys.argv[1], 'w') as out:
 name={'escape':'../escaped','absolute':'/escaped','credential':'.env'}.get(sys.argv[2],'app.mjs')
 entry=tarfile.TarInfo(name);entry.size=1
 if sys.argv[2] in ('symlink','hardlink','device'):
  entry.type={'symlink':tarfile.SYMTYPE,'hardlink':tarfile.LNKTYPE,'device':tarfile.CHRTYPE}[sys.argv[2]];entry.linkname='../escaped';entry.size=0
 out.addfile(entry,io.BytesIO(b'x'))
 if sys.argv[2]=='duplicate':out.addfile(entry,io.BytesIO(b'y'))
`, archive, kind], {encoding: 'utf8'});
    assert.equal(built.status, 0, built.stderr);
    const target = join(f.base, kind); mkdirSync(target);
    const result = invoke('extract', archive, digest(archive), target);
    assert.notEqual(result.status, 0, kind);
    assert.match(result.stderr, /unsafe|duplicate|regular|excluded/i, kind);
    assert.deepEqual(readdirSync(target), [], kind);
  }
});

test('candidate ignore edits cannot expose untracked local state under arbitrary filenames', t => {
  const f = fixture(t);
  f.put('app.mjs', 'tracked-source');
  f.put('.gitignore', 'private-only/\n');
  assert.equal(spawnSync('git', ['-C', f.root, 'add', 'app.mjs', '.gitignore']).status, 0);
  f.put('private-only/ordinary-name', 'LOCAL-SECRET-MUST-STAY');
  f.put('untracked-new-source.mjs', 'UNSTAGED-MUST-NOT-BE-SELECTED');
  f.put('.gitignore', '');
  const result = create(f);
  assert.equal(result.status, 0, result.stderr);
  const target = join(f.base, 'guest'); mkdirSync(target);
  assert.equal(invoke('extract', f.archive, digest(f.archive), target).status, 0);
  assert.deepEqual(readdirSync(target).sort(), ['.gitignore', 'app.mjs']);
  assert.equal(readFileSync(f.archive).includes(Buffer.from('LOCAL-SECRET-MUST-STAY')), false);
});

test('recognized credential and local-state paths remain excluded even when tracked', t => {
  const f = fixture(t);
  f.put('app.mjs', 'safe-source');
  for (const name of ['.config/gh/hosts.yml', '.dev.vars', '.docker/config.json', '.git-credentials', '.kube/config', '.pgpass', '.pypirc', '.vault-token', 'id_dsa', 'id_ecdsa', 'service-account.json', 'terraform.tfvars', '.local-stack/admin-secret']) f.put(name, 'NEVER-SEND-CREDENTIAL');
  assert.equal(spawnSync('git', ['-C', f.root, 'add', '--force', '.']).status, 0);
  const result = create(f); assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.archive).includes(Buffer.from('NEVER-SEND-CREDENTIAL')), false);
});

test('checkout filesystem-monitor configuration cannot execute during source enumeration', t => {
  const f = fixture(t);
  f.put('app.mjs', 'safe-source');
  assert.equal(spawnSync('git', ['-C', f.root, 'add', 'app.mjs']).status, 0);
  const marker = join(f.base, 'monitor-ran');
  const hook = join(f.base, 'monitor.sh');
  writeFileSync(hook, '#!/bin/sh\nprintf ran > '+JSON.stringify(marker)+'\nprintf "\\0"\n', {mode: 0o755});
  assert.equal(spawnSync('git', ['-C', f.root, 'config', 'core.fsmonitor', hook]).status, 0);
  const result = create(f); assert.equal(result.status, 0, result.stderr);
  assert.equal(readdirSync(f.base).includes('monitor-ran'), false, 'A checkout-configured program executed on the Mac');
});
