import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm, chmod, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {gzipSync, gunzipSync, deflateSync} from 'node:zlib';
import {reserveRelease, appendReleaseEvent} from './ui-ledger.mjs';

const script = resolve('scripts/release/record-ui-artifact.mjs');
const at = '2026-11-06T08:00:00.000Z';
const sha = bytes => createHash('sha512').update(bytes).digest('hex');
const env = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
const run = (cwd, command, args) => execFileSync(command, args, {cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ui-artifact-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const checkout = join(root, 'source'), staged = join(root, 'staged');
  await mkdir(join(checkout, 'packages/ui-core'), {recursive: true});
  await mkdir(join(staged, 'package/dist'), {recursive: true});
  for (const notice of ['LICENSE', 'LICENSE-GRANTS.md']) {
    await writeFile(join(checkout, notice), notice + '\n');
    await writeFile(join(staged, 'package/dist', notice), notice + '\n');
  }
  await writeFile(join(checkout, 'packages/ui-core/package.json'), JSON.stringify({name: '@waitron/ui-core', version: '0.1.0', private: true, type: 'module',
    exports: {'.': {import: './dist/index.js'}}, license: 'SEE LICENSE IN dist/LICENSE', peerDependencies: {lit: '^3.2.0'}}));
  run(checkout, 'git', ['init']);
  run(checkout, 'git', ['config', 'user.name', 'Artifact test']);
  run(checkout, 'git', ['config', 'user.email', 'artifact@example.invalid']);
  run(checkout, 'git', ['add', '.']);
  run(checkout, 'git', ['commit', '-s', '-m', 'Create immutable notice source']);
  const source = {repository: 'clintongormley/waitron', commit: run(checkout, 'git', ['rev-parse', 'HEAD']), version: '0.1.0'};
  const manifest = {name: '@waitron-io/ui-core', version: '0.2.0', type: 'module',
    exports: {'.': {import: './dist/index.js'}}, license: 'SEE LICENSE IN dist/LICENSE', peerDependencies: {lit: '^3.2.0'},
    repository: {type: 'git', url: 'https://github.com/waitron-io/waitron-cloud.git'},
    homepage: `https://github.com/${source.repository}/tree/${source.commit}/packages/ui-core`, waitronSource: source,
    publishConfig: {registry: 'https://npm.pkg.github.com', access: 'restricted'}};
  const manifestFile = join(staged, 'package/package.json');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(staged, 'package/dist/index.js'), 'export const release = true;\n');
  const ledger = reserveRelease({schema: 1, events: []}, {source, inputsSha512: 'b'.repeat(128),
    recipeSha512: 'c'.repeat(128), sourceChecksSha512: 'd'.repeat(128), registryVersions: ['0.1.0'], at});
  const ledgerFile = join(root, 'releases.json');
  await writeFile(ledgerFile, JSON.stringify(ledger));
  const archive = join(root, 'release.tgz');
  const pack = () => run(staged, 'tar', ['--format=ustar', '-czf', archive, 'package']);
  pack();
  const record = (...extra) => spawnSync(process.execPath, [script, checkout, archive, '--ledger', ledgerFile, '--at', at, ...extra], {
    cwd: root, env, encoding: 'utf8', timeout: 30000});
  return {root, checkout, staged, source, manifest, manifestFile, ledger, ledgerFile, archive, pack, record};
}

// Dropping byte hashing or appending before validation must break this contract.
test('records actual archive, raw manifest and notice bytes without changing the ledger or archive', async t => {
  const f = await fixture(t), before = await readFile(f.ledgerFile), bytes = await readFile(f.archive);
  const result = f.record();
  assert.equal(result.status, 0, result.stderr);
  const next = JSON.parse(result.stdout);
  assert.deepEqual(next.events.slice(0, -1), f.ledger.events);
  assert.deepEqual(next.events.at(-1), {type: 'prepared', sourceCommit: f.source.commit, version: '0.2.0', at,
    artifact: {sha512: sha(bytes), manifestSha512: sha(await readFile(f.manifestFile)),
      notices: {LICENSE: sha('LICENSE\n'), 'LICENSE-GRANTS.md': sha('LICENSE-GRANTS.md\n')}}});
  assert.deepEqual(await readFile(f.archive), bytes);
  assert.deepEqual(await readFile(f.ledgerFile), before);
});

test('identical prepared recovery returns the same ledger and differing archive bytes refuse', async t => {
  const f = await fixture(t), first = f.record();
  assert.equal(first.status, 0, first.stderr);
  await writeFile(f.ledgerFile, first.stdout);
  const retry = f.record();
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(JSON.parse(retry.stdout), JSON.parse(first.stdout));
  await writeFile(join(f.staged, 'package/dist/index.js'), 'export const changed = true;\n');
  f.pack();
  const refused = f.record();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /prepared bytes are immutable/);
  assert.equal(refused.stdout, '');
  assert.equal(await readFile(f.ledgerFile, 'utf8'), first.stdout);
});

test('every prepared fingerprint is checked during recovery', async t => {
  const f = await fixture(t), first = f.record();
  assert.equal(first.status, 0, first.stderr);
  const ledger = JSON.parse(first.stdout);
  for (const field of ['sha512', 'manifestSha512', 'LICENSE', 'LICENSE-GRANTS.md']) {
    const altered = structuredClone(ledger), artifact = altered.events.at(-1).artifact;
    if (field in artifact) artifact[field] = 'e'.repeat(128);
    else artifact.notices[field] = 'e'.repeat(128);
    await writeFile(f.ledgerFile, JSON.stringify(altered));
    const result = f.record();
    assert.notEqual(result.status, 0, field);
    assert.match(result.stderr, /prepared bytes are immutable/, field);
    assert.equal(result.stdout, '');
  }
});

test('notice checks read immutable source blobs rather than dirty checkout copies', async t => {
  const f = await fixture(t);
  await writeFile(join(f.checkout, 'LICENSE'), 'dirty caller bytes');
  const result = f.record();
  assert.equal(result.status, 0, result.stderr);
  await writeFile(join(f.staged, 'package/dist/LICENSE'), 'dirty caller bytes');
  f.pack();
  const refused = f.record();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /notice differs/);
  assert.equal(refused.stdout, '');
});

test('wrong release, source, publishing authority and executable manifests refuse before recording', async t => {
  const f = await fixture(t);
  const changes = [{name: '@waitron/ui-core'}, {version: '0.2.1'},
    {waitronSource: {...f.source, commit: 'a'.repeat(40)}}, {waitronSource: {...f.source, version: '0.9.0'}},
    {repository: {type: 'git', url: 'https://github.com/elsewhere/source.git'}}, {homepage: 'https://example.invalid'},
    {publishConfig: {registry: 'https://registry.npmjs.org', access: 'public'}},
    {scripts: {prepublishOnly: 'exit 0'}}, {private: false}, {devDependencies: {unexpected: '1.0.0'}},
    {dependencies: {lit: '^3.2.0'}}, {exports: {'.': {import: './source.js'}}}];
  for (const change of changes) {
    await writeFile(f.manifestFile, JSON.stringify({...f.manifest, ...change}));
    f.pack();
    const result = f.record();
    assert.notEqual(result.status, 0, JSON.stringify(change));
    assert.equal(result.stdout, '', JSON.stringify(change));
  }
});

test('missing built exports, missing notices and malformed archives never record', async t => {
  const f = await fixture(t);
  for (const path of ['package/dist/index.js', 'package/dist/LICENSE-GRANTS.md', 'package/package.json']) {
    const file = join(f.staged, path), original = await readFile(file);
    await rm(file); f.pack();
    const result = f.record();
    assert.notEqual(result.status, 0, path);
    assert.equal(result.stdout, '', path);
    await writeFile(file, original);
  }
  await writeFile(f.archive, 'not a gzip archive');
  const invalid = f.record();
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
});

test('uncertain and published uploads cannot be recorded as prepared again', async t => {
  const f = await fixture(t), first = f.record();
  assert.equal(first.status, 0, first.stderr);
  let ledger = JSON.parse(first.stdout);
  ledger = appendReleaseEvent(ledger, {type: 'uploading', sourceCommit: f.source.commit, version: '0.2.0', at});
  const published = appendReleaseEvent(ledger, {type: 'published', sourceCommit: f.source.commit, version: '0.2.0', at,
    readback: {...ledger.events.at(-2).artifact, source: f.source, visibility: 'private', publishedAt: at}});
  for (const value of [ledger, published, {schema: 1, events: []}]) {
    await writeFile(f.ledgerFile, JSON.stringify(value));
    const result = f.record();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reserved or prepared/);
    assert.equal(result.stdout, '');
  }
});

test('invalid command arguments and event time never emit a ledger', async t => {
  const f = await fixture(t);
  for (const extra of [['--unknown'], ['--at', at], ['--ledger']]) {
    const result = f.record(...extra);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage/);
    assert.equal(result.stdout, '');
  }
  const result = spawnSync(process.execPath, [script, f.checkout, f.archive, '--ledger', f.ledgerFile, '--at', 'bad'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid time/);
  assert.equal(result.stdout, '');
});

function archiveMembers(entries) {
  const chunks = [];
  for (const {name, type = '0', body = '', link = ''} of entries) {
    const bytes = Buffer.from(body), header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136); header.fill(32, 148, 156);
    header.write(type, 156); header.write(link, 157, 100); header.write('ustar\0', 257); header.write('00', 263);
    header.write([...header].reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

test('links, duplicate members and paths outside the package refuse without extracting files', async t => {
  const f = await fixture(t);
  const members = [
    {name: 'package/package.json', body: await readFile(f.manifestFile)},
    {name: 'package/dist/index.js', body: 'export const valid = true;'},
    {name: 'package/dist/LICENSE', body: 'LICENSE\n'},
    {name: 'package/dist/LICENSE-GRANTS.md', body: 'LICENSE-GRANTS.md\n'},
  ];
  for (const [extra, message] of [
    [{name: 'package/dist/link.js', type: '2', link: '/etc/passwd'}, /regular files/],
    [{name: 'package/dist/link.js', type: '1', link: 'package/dist/index.js'}, /regular files/],
    [members[1], /duplicate archive member/],
    [members[0], /duplicate archive member/],
    [{name: '../escaped', body: 'hostile'}, /invalid archive member path/],
    [{name: 'package/../escaped', body: 'hostile'}, /invalid archive member path/],
  ]) {
    await writeFile(f.archive, archiveMembers([...members, extra]));
    const result = f.record();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, '');
  }
  await assert.rejects(readFile(join(f.root, 'escaped')), {code: 'ENOENT'});
});

test('compressed and expanded archive size limits refuse before recording', async t => {
  const f = await fixture(t);
  const members = [
    {name: 'package/package.json', body: await readFile(f.manifestFile)},
    {name: 'package/dist/index.js', body: 'export const valid = true;'},
    {name: 'package/dist/LICENSE', body: 'LICENSE\n'},
    {name: 'package/dist/LICENSE-GRANTS.md', body: 'LICENSE-GRANTS.md\n'},
  ];
  for (const body of [randomBytes(17 * 1024 * 1024), Buffer.alloc(32 * 1024 * 1024)]) {
    const bytes = archiveMembers([...members, {name: 'package/dist/padding', body}]);
    await writeFile(f.archive, bytes);
    const result = f.record();
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /16 MiB|33554432/);
  }
});

test('inherited tar options cannot hide or redirect archive members', async t => {
  const f = await fixture(t);
  const tools = join(f.root, 'tools');
  await mkdir(tools);
  await writeFile(join(tools, 'tar'), '#!/bin/sh\n[ -z "${TAR_OPTIONS+x}" ] || exit 71\nexec /usr/bin/tar "$@"\n');
  await chmod(join(tools, 'tar'), 0o755);
  const result = spawnSync(process.execPath, [script, f.checkout, f.archive, '--ledger', f.ledgerFile, '--at', at], {
    cwd: f.root, env: {...env, PATH: tools + ':' + env.PATH, TAR_OPTIONS: '--exclude=package/dist/index.js'}, encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).events.at(-1).type, 'prepared');
});

test('local Git replacement refs cannot substitute notices for the reserved commit', async t => {
  const f = await fixture(t);
  await writeFile(join(f.checkout, 'LICENSE'), 'replacement notice\n');
  run(f.checkout, 'git', ['add', '.']);
  run(f.checkout, 'git', ['commit', '-s', '-m', 'Create replacement source']);
  const replacement = run(f.checkout, 'git', ['rev-parse', 'HEAD']);
  run(f.checkout, 'git', ['replace', f.source.commit, replacement]);
  await writeFile(join(f.staged, 'package/dist/LICENSE'), 'replacement notice\n');
  f.pack();
  const result = f.record();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /notice differs/);
  assert.equal(result.stdout, '');
});

test('delivered licence metadata and the external Lit peer remain required', async t => {
  const f = await fixture(t);
  for (const change of [{license: 'Apache-2.0'}, {peerDependencies: {}}, {peerDependencies: {lit: ''}}]) {
    await writeFile(f.manifestFile, JSON.stringify({...f.manifest, ...change}));
    f.pack();
    const result = f.record();
    assert.notEqual(result.status, 0, JSON.stringify(change));
    assert.match(result.stderr, /licence|Lit peer/);
    assert.equal(result.stdout, '');
  }
});

test('a nested checkout cannot use a different regular file to disguise a source notice symlink', async t => {
  const f = await fixture(t), nested = join(f.checkout, 'nested');
  await rm(join(f.checkout, 'LICENSE'));
  await symlink('LICENSE-GRANTS.md', join(f.checkout, 'LICENSE'));
  await mkdir(join(nested, 'packages/ui-core'), {recursive: true});
  await writeFile(join(nested, 'packages/ui-core/package.json'), '{}');
  await writeFile(join(nested, 'LICENSE'), 'decoy');
  await writeFile(join(nested, 'LICENSE-GRANTS.md'), 'decoy');
  run(f.checkout, 'git', ['add', '.']);
  run(f.checkout, 'git', ['commit', '-s', '-m', 'Create nested source-mode decoys']);
  const commit = run(f.checkout, 'git', ['rev-parse', 'HEAD']);
  f.ledger.events[0].source.commit = commit;
  await writeFile(f.ledgerFile, JSON.stringify(f.ledger));
  f.manifest.waitronSource.commit = commit;
  f.manifest.homepage = `https://github.com/clintongormley/waitron/tree/${commit}/packages/ui-core`;
  await writeFile(f.manifestFile, JSON.stringify(f.manifest));
  await writeFile(join(f.staged, 'package/dist/LICENSE'), 'LICENSE-GRANTS.md');
  f.pack();
  const result = spawnSync(process.execPath, [script, nested, f.archive, '--ledger', f.ledgerFile, '--at', at], {
    cwd: f.root, env, encoding: 'utf8', timeout: 30000});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular immutable blob/);
  assert.equal(result.stdout, '');
});

test('a named pipe archive refuses promptly rather than waiting for a writer', async t => {
  const f = await fixture(t);
  await rm(f.archive);
  run(f.root, 'mkfifo', [f.archive]);
  const result = spawnSync(process.execPath, [script, f.checkout, f.archive, '--ledger', f.ledgerFile, '--at', at], {
    cwd: f.root, env, encoding: 'utf8', timeout: 5000});
  assert.equal(result.status, 1, String(result.error));
  assert.match(result.stderr, /regular file/);
  assert.equal(result.stdout, '');
});

async function membersFor(f) {
  return [
    {name: 'package/package.json', body: await readFile(f.manifestFile)},
    {name: 'package/dist/index.js', body: 'export const valid = true;'},
    {name: 'package/dist/LICENSE', body: 'LICENSE\n'},
    {name: 'package/dist/LICENSE-GRANTS.md', body: 'LICENSE-GRANTS.md\n'},
  ];
}

test('a single zero block cannot conceal a second install manifest or other members', async t => {
  const f = await fixture(t), clean = gunzipSync(archiveMembers(await membersFor(f)));
  for (const hidden of [
    {name: 'package/package.json', body: JSON.stringify({...f.manifest, scripts: {postinstall: 'exit 1'}})},
    {name: 'package/dist/hidden', type: '2', link: '/etc/passwd'},
    {name: '../escaped', body: 'hidden'},
  ]) {
    const tail = gunzipSync(archiveMembers([hidden]));
    await writeFile(f.archive, gzipSync(Buffer.concat([clean.subarray(0, -1024), Buffer.alloc(512), tail])));
    const result = f.record();
    assert.notEqual(result.status, 0, hidden.name);
    assert.equal(result.stdout, '');
  }
});

test('trailing spaces and unknown or sparse tar types cannot stand in for a built export', async t => {
  const f = await fixture(t), members = await membersFor(f);
  for (const extra of [
    {name: 'package/dist/index.js ', body: 'export const valid = true;'},
    {name: 'package/dist/index.js', type: 'Z', body: 'export const valid = true;'},
    {name: 'package/dist/index.js', type: 'S', body: 'export const valid = true;'},
  ]) {
    await writeFile(f.archive, archiveMembers([...members.filter(m => m.name !== 'package/dist/index.js'), extra]));
    const result = f.record();
    assert.notEqual(result.status, 0, JSON.stringify(extra));
    assert.equal(result.stdout, '');
  }
});

test('a manifest or notice cannot be split between a regular file and a child member', async t => {
  const f = await fixture(t), members = await membersFor(f);
  for (const name of ['package/package.json', 'package/dist/LICENSE']) {
    const original = members.find(m => m.name === name), bytes = Buffer.from(original.body), half = Math.floor(bytes.length / 2);
    await writeFile(f.archive, archiveMembers([...members.filter(m => m.name !== name),
      {name, body: bytes.subarray(0, half)}, {name: name + '/x', body: bytes.subarray(half)}]));
    const result = f.record();
    assert.notEqual(result.status, 0, name);
    assert.equal(result.stdout, '');
  }
});

test('case collisions and implicit native-build files refuse before recording', async t => {
  const f = await fixture(t), members = await membersFor(f);
  for (const extra of [
    {name: 'package/PACKAGE.JSON', body: JSON.stringify({...f.manifest, scripts: {postinstall: 'exit 1'}})},
    {name: 'package/binding.gyp', body: '{}'},
  ]) {
    await writeFile(f.archive, archiveMembers([...members, extra]));
    const result = f.record();
    assert.notEqual(result.status, 0, extra.name);
    assert.equal(result.stdout, '');
  }
});

test('the complete staged manifest must match its immutable source rather than itself', async t => {
  const f = await fixture(t);
  await writeFile(join(f.staged, 'package/dist/other.js'), 'export const other = true;');
  for (const change of [
    {optionalDependencies: {unexpected: '1.0.0'}}, {bin: './dist/index.js'}, {main: './elsewhere.js'},
    {peerDependencies: {lit: '^9.0.0'}}, {gypfile: true}, {overrides: {lit: '^9.0.0'}},
    {exports: {'.': {import: './dist/other.js'}}},
  ]) {
    await writeFile(f.manifestFile, JSON.stringify({...f.manifest, ...change})); f.pack();
    const result = f.record();
    assert.notEqual(result.status, 0, JSON.stringify(change));
    assert.equal(result.stdout, '');
  }
});

async function replaceSourceIdentity(f, commit) {
  f.ledger.events[0].source.commit = commit;
  await writeFile(f.ledgerFile, JSON.stringify(f.ledger));
  f.manifest.waitronSource.commit = commit;
  f.manifest.homepage = `https://github.com/clintongormley/waitron/tree/${commit}/packages/ui-core`;
  await writeFile(f.manifestFile, JSON.stringify(f.manifest)); f.pack();
}

test('a source identity must name an actual commit rather than a tree or annotated tag', async t => {
  const f = await fixture(t), tree = run(f.checkout, 'git', ['rev-parse', 'HEAD^{tree}']);
  run(f.checkout, 'git', ['tag', '-a', 'source-tag', '-m', 'Create tag fixture']);
  const tag = run(f.checkout, 'git', ['rev-parse', 'source-tag']);
  for (const identity of [tree, tag]) {
    await replaceSourceIdentity(f, identity);
    const result = f.record();
    assert.notEqual(result.status, 0, identity);
    assert.equal(result.stdout, '');
  }
});

test('rewritten loose Git blobs cannot change immutable notice evidence', async t => {
  const f = await fixture(t), blob = run(f.checkout, 'git', ['rev-parse', 'HEAD:LICENSE']);
  const bytes = Buffer.from('altered\n');
  await chmod(join(f.checkout, '.git/objects', blob.slice(0, 2), blob.slice(2)), 0o644);
  await writeFile(join(f.checkout, '.git/objects', blob.slice(0, 2), blob.slice(2)),
    deflateSync(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])));
  await writeFile(join(f.staged, 'package/dist/LICENSE'), bytes); f.pack();
  const result = f.record();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('rewritten Git trees cannot redirect a valid commit to different valid blobs', async t => {
  const f = await fixture(t), tree = run(f.checkout, 'git', ['rev-parse', 'HEAD^{tree}']);
  const bytes = Buffer.from('altered\n');
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: f.checkout, env, input: bytes, encoding: 'utf8'}).trim();
  const raw = execFileSync('git', ['cat-file', 'tree', tree], {cwd: f.checkout, env});
  const offset = raw.indexOf(Buffer.from('LICENSE\0')) + Buffer.byteLength('LICENSE\0');
  assert(offset > 8); Buffer.from(blob, 'hex').copy(raw, offset);
  await chmod(join(f.checkout, '.git/objects', tree.slice(0, 2), tree.slice(2)), 0o644);
  await writeFile(join(f.checkout, '.git/objects', tree.slice(0, 2), tree.slice(2)),
    deflateSync(Buffer.concat([Buffer.from(`tree ${raw.length}\0`), raw])));
  await writeFile(join(f.staged, 'package/dist/LICENSE'), bytes); f.pack();
  const result = f.record();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('pnpm publishing exports are derived from the immutable source override', async t => {
  const f = await fixture(t), file = join(f.checkout, 'packages/ui-core/package.json');
  const sourceManifest = JSON.parse(await readFile(file, 'utf8'));
  sourceManifest.exports = {'.': './src/index.ts'};
  sourceManifest.publishConfig = {exports: {'.': {import: './dist/index.js'}}};
  await writeFile(file, JSON.stringify(sourceManifest));
  run(f.checkout, 'git', ['add', '.']);
  run(f.checkout, 'git', ['commit', '-s', '-m', 'Declare separate workspace and publishing exports']);
  await replaceSourceIdentity(f, run(f.checkout, 'git', ['rev-parse', 'HEAD']));
  const result = f.record();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).events.at(-1).type, 'prepared');
});

test('ambient Git redirection cannot move source reads into another repository', async t => {
  const f = await fixture(t);
  const result = spawnSync(process.execPath, [script, f.checkout, f.archive, '--ledger', f.ledgerFile, '--at', at], {
    cwd: f.root, env: {...env, GIT_DIR: join(f.root, 'missing.git'), GIT_WORK_TREE: join(f.root, 'missing'),
      GIT_OBJECT_DIRECTORY: join(f.root, 'missing-objects'), GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'include.path', GIT_CONFIG_VALUE_0: join(f.root, 'missing-config')}, encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).events.at(-1).type, 'prepared');
});

test('optional runtime dependencies refuse even when they also appear in the immutable source', async t => {
  const f = await fixture(t), file = join(f.checkout, 'packages/ui-core/package.json');
  const sourceManifest = JSON.parse(await readFile(file, 'utf8'));
  sourceManifest.optionalDependencies = {unexpected: '1.0.0'};
  await writeFile(file, JSON.stringify(sourceManifest));
  run(f.checkout, 'git', ['add', '.']);
  run(f.checkout, 'git', ['commit', '-s', '-m', 'Add unsupported optional runtime dependency']);
  f.manifest.optionalDependencies = sourceManifest.optionalDependencies;
  await replaceSourceIdentity(f, run(f.checkout, 'git', ['rev-parse', 'HEAD']));
  const result = f.record();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime dependencies/);
  assert.equal(result.stdout, '');
});

function resealHeader(raw) {
  raw.fill(32, 148, 156);
  const checksum = [...raw.subarray(0, 512)].reduce((sum, value) => sum + value, 0);
  raw.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
}

test('high-bit numeric fields cannot be mistaken for ordinary octal file sizes', async t => {
  const f = await fixture(t), raw = gunzipSync(archiveMembers(await membersFor(f)));
  raw[124] |= 128; resealHeader(raw);
  await writeFile(f.archive, gzipSync(raw));
  const result = f.record();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('header corruption, unsupported formats, nonzero padding and partial blocks refuse', async t => {
  const f = await fixture(t), members = await membersFor(f), original = gunzipSync(archiveMembers(members));
  for (const change of ['checksum', 'format', 'padding', 'framing']) {
    let raw = Buffer.from(original);
    if (change === 'checksum') raw[148] = raw[148] === 48 ? 49 : 48;
    if (change === 'format') {raw.write('ustar  \0', 257); resealHeader(raw);}
    if (change === 'padding') raw[512 + Buffer.byteLength(members[0].body)] = 1;
    if (change === 'framing') raw = Buffer.concat([raw, Buffer.alloc(1)]);
    await writeFile(f.archive, gzipSync(raw));
    const result = f.record();
    assert.notEqual(result.status, 0, change);
    assert.equal(result.stdout, '');
  }
});

test('a regular file cannot be the parent of unrelated additional members', async t => {
  const f = await fixture(t), members = await membersFor(f);
  await writeFile(f.archive, archiveMembers([...members,
    {name: 'package/dist/parent', body: 'file'}, {name: 'package/dist/parent/child', body: 'child'}]));
  const result = f.record();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});

test('source metadata cannot authorise build hooks, a different licence or removal of the Lit peer', async t => {
  for (const change of [{license: 'Apache-2.0'}, {peerDependencies: {}}, {gypfile: true}, {bin: './dist/index.js'}]) {
    await t.test(JSON.stringify(change), async t => {
      const f = await fixture(t), file = join(f.checkout, 'packages/ui-core/package.json');
      const sourceManifest = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(file, JSON.stringify({...sourceManifest, ...change}));
      run(f.checkout, 'git', ['add', '.']);
      run(f.checkout, 'git', ['commit', '-s', '-m', 'Create unsupported source metadata']);
      Object.assign(f.manifest, change);
      await replaceSourceIdentity(f, run(f.checkout, 'git', ['rev-parse', 'HEAD']));
      const result = f.record();
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
    });
  }
});

test('archive metadata cannot mask a wrong source package name or version', async t => {
  for (const change of [{name: '@elsewhere/ui-core'}, {version: '0.9.0'}]) {
    await t.test(JSON.stringify(change), async t => {
      const f = await fixture(t), file = join(f.checkout, 'packages/ui-core/package.json');
      const sourceManifest = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(file, JSON.stringify({...sourceManifest, ...change}));
      run(f.checkout, 'git', ['add', '.']);
      run(f.checkout, 'git', ['commit', '-s', '-m', 'Create mismatched source identity']);
      await replaceSourceIdentity(f, run(f.checkout, 'git', ['rev-parse', 'HEAD']));
      const result = f.record();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /source package name|source package version/);
      assert.equal(result.stdout, '');
    });
  }
});
