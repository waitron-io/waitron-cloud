import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, renameSync, linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const policyPath = 'scripts/ci-input-audit.json';
const revision = 'a'.repeat(40);
const modes = ['docs', 'identity', 'gateway', 'lock'];
const fields = ['docsInputSha256', 'identityInputSha256', 'gatewayInputSha256', 'lockInputSha256'];
const manifestPath = 'packages/example/package.json';
const manifest = {name: 'example', scripts: {test: 'node --test'}, dependencies: {one: '^1'}};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const projection = sha256('{"name":"example","scripts":{"test":"node --test"}}');

function policy() {
  return {
    version: 1,
    docsInputSha256: '1'.repeat(64),
    identityInputSha256: '2'.repeat(64),
    gatewayInputSha256: '3'.repeat(64),
    lockInputSha256: '4'.repeat(64),
    manifests: {[manifestPath]: projection},
  };
}

// These literal path lists are independent of the production exemptions.
const paths = [
  policyPath, 'README.md', 'docs/guide.md', 'docs/a directory/prose with\na newline.md',
  'docs/receipts/proof.md', 'docs/receipts/proof.json', 'packages/example/README.md',
  'scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs',
  'scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs',
  'scripts/gateway-reconnection-receipt.mjs', 'pnpm-lock.yaml', manifestPath,
  'package.json', 'pnpm-workspace.yaml', 'scripts/ci-input-audit.mjs',
  'scripts/ci-plan.mjs', '.github/workflows/ci.yml',
  'docs/executable.md', 'docs/link.md', 'docs/submodule.md',
];
const records = paths.map((path, index) => {
  const mode = path === 'docs/executable.md' ? '100755' : path === 'docs/link.md' ? '120000' : path === 'docs/submodule.md' ? '160000' : '100644';
  return `${mode} ${mode === '160000' ? 'commit' : 'blob'} ${(index + 1).toString(16).padStart(40, '0')}\t${path}\0`;
});
const included = {
  docs: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  identity: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  gateway: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  lock: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21],
};
const expectedDigest = mode => sha256(included[mode].map(index => records[index]).join(''));

function fixture({audit = policy(), tree = records.join(''), packageJson = JSON.stringify(manifest)} = {}) {
  return (...args) => {
    if (args[0] === 'ls-tree') {
      assert.deepEqual(args, ['ls-tree', '-rz', '--full-tree', revision]);
      return tree;
    }
    if (args[0] === 'show' && args[1] === `${revision}:${policyPath}`) return typeof audit === 'string' ? audit : JSON.stringify(audit);
    if (args[0] === 'show' && args[1] === `${revision}:${manifestPath}`) return packageJson;
    assert.fail(`Unexpected git read: ${JSON.stringify(args)}`);
  };
}

async function api() {
  const module = await import('./ci-input-audit.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./ci-input-audit.mjs', import.meta.url).href) return {};
    throw error;
  });
  for (const name of ['readInputAudit', 'fingerprintInputMode', 'auditInputMode']) {
    assert.equal(typeof module[name], 'function', `Missing shared audit interface: ${name}`);
  }
  return module;
}

test('shared policy rejects unknown missing damaged and duplicate fields', async () => {
  const {readInputAudit} = await api();
  assert.deepEqual(readInputAudit(revision, fixture()).policy, policy());
  const invalid = [null, [], 1, 'text', {}, {...policy(), extra: true}, {...policy(), version: 2}];
  for (const field of Object.keys(policy())) {
    const missing = policy(); delete missing[field]; invalid.push(missing);
    for (const value of [null, [], {}, true, '', 1]) {
      if (field === 'version' && value === 1) continue;
      if (field === 'manifests' && value !== null && !Array.isArray(value) && typeof value === 'object') continue;
      invalid.push({...policy(), [field]: value});
    }
  }
  for (const field of fields) for (const digest of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65), 'a'.repeat(64) + '\n']) {
    invalid.push({...policy(), [field]: digest});
  }
  for (const key of ['../package.json', 'packages/../package.json', 'packages/./package.json', 'packages/a/b/package.json',
    'packages/a\\b/package.json', '/packages/a/package.json', 'package.json', 'apps//package.json', '__proto__',
    'packages/a\0b/package.json', 'packages/example/package.json\n']) {
    invalid.push({...policy(), manifests: {[key]: projection}});
  }
  for (const digest of [null, 2, 'a'.repeat(63), 'A'.repeat(64), 'x'.repeat(64), 'a'.repeat(64) + '\n']) invalid.push({...policy(), manifests: {[manifestPath]: digest}});
  for (const value of invalid) assert.throws(() => readInputAudit(revision, fixture({audit: JSON.stringify(value)})), `Accepted ${JSON.stringify(value)}`);
  for (const raw of ['{', '{"version":1,}', JSON.stringify(policy()).replace('"version":1', '"version":2,"version":1'),
    JSON.stringify(policy()).replace('"version":1', '"ver\\u0073ion":1,"version":1'),
    JSON.stringify(policy()).replace('"manifests":{', `"manifests":{"${manifestPath}":"${projection}",`),
    JSON.stringify(policy()).replace('"docsInputSha256":', '"docsInputSha256":"' + '0'.repeat(64) + '","docsInputSha256":')]) {
    assert.throws(() => readInputAudit(revision, fixture({audit: raw})), `Accepted duplicate or malformed policy: ${raw}`);
  }
});

test('each mode excludes only its audited content and shared policy', async () => {
  const {readInputAudit, fingerprintInputMode, auditInputMode} = await api();
  const audited = policy();
  for (const [index, mode] of modes.entries()) audited[fields[index]] = expectedDigest(mode);
  const git = fixture({audit: audited});
  const {entries} = readInputAudit(revision, git);
  for (const mode of modes) {
    const result = fingerprintInputMode(mode, revision, git, entries, [manifestPath]);
    assert.equal(result.inputSha256, expectedDigest(mode), mode);
    assert.deepEqual([...result.documents], mode === 'docs' ? ['README.md', 'docs/guide.md', 'docs/a directory/prose with\na newline.md'] : []);
    assert.deepEqual(result.manifests, mode === 'lock' ? {[manifestPath]: projection} : {});
    assert.deepEqual(auditInputMode(mode, revision, git, [manifestPath]), result);
  }
  assert.throws(() => fingerprintInputMode('unknown', revision, git, entries));
});

test('peer hash edits preserve other inventories but never qualify their own bad digest', async () => {
  const {auditInputMode} = await api();
  const audited = policy();
  for (const [index, mode] of modes.entries()) audited[fields[index]] = expectedDigest(mode);
  for (const [index, badMode] of modes.entries()) {
    const changed = {...audited, [fields[index]]: '0'.repeat(64)};
    for (const mode of modes) {
      if (mode === badMode) assert.throws(() => auditInputMode(mode, revision, fixture({audit: changed}), [manifestPath]), /changed|digest|audit/i);
      else assert.equal(auditInputMode(mode, revision, fixture({audit: changed}), [manifestPath]).inputSha256, expectedDigest(mode));
      assert.throws(() => auditInputMode(mode, revision, fixture({audit: {...audited, [fields[index]]: 'damaged'}}), [manifestPath]));
    }
  }
});

test('complete ordered inventories and regular policy and owning inputs are required', async () => {
  const {readInputAudit, fingerprintInputMode} = await api();
  for (const tree of [records.join('').slice(0, -1), records.join('') + records[1], 'malformed\0',
    records.join('').replace('100644 blob', '100644 tree')]) assert.throws(() => readInputAudit(revision, fixture({tree})));
  for (const mode of modes) {
    const required = [0, ...mode === 'identity' ? [7, 8] : mode === 'gateway' ? [9, 10] : mode === 'lock' ? [12, 13] : []];
    for (const index of required) for (const type of ['absent', '100755 blob', '120000 blob', '160000 commit']) {
      const tree = records.map((record, n) => n !== index ? record : type === 'absent' ? '' : record.replace('100644 blob', type)).join('');
      assert.throws(() => {
        const git = fixture({tree});
        const {entries} = readInputAudit(revision, git);
        fingerprintInputMode(mode, revision, git, entries, [manifestPath]);
      }, `${mode}: ${paths[index]} ${type}`);
    }
  }
  const reversed = [...records].reverse().join('');
  const git = fixture({tree: reversed});
  assert.equal(fingerprintInputMode('identity', revision, git, readInputAudit(revision, git).entries).inputSha256,
    sha256([...included.identity].reverse().map(index => records[index]).join('')));
});

test('audit policy requires a blob even when its saved file mode is regular', async () => {
  const {readInputAudit} = await api();
  assert.deepEqual(readInputAudit(revision, fixture()).policy, policy());
  const tree = records.map(record => record.endsWith(`\t${policyPath}\0`)
    ? record.replace('100644 blob', '100644 commit') : record).join('');
  assert.throws(() => readInputAudit(revision, fixture({tree})), {
    code: 'ERR_ASSERTION', message: `Missing regular audit input: ${policyPath}`,
  });
});

for (const [mode, path] of [
  ['identity', 'scripts/identity-upstream.mjs'],
  ['identity', 'scripts/identity-upstream.test.mjs'],
  ['gateway', 'scripts/verify-gateway-reconnection-receipt.mjs'],
  ['gateway', 'scripts/verify-gateway-reconnection-receipt.test.mjs'],
  ['lock', 'pnpm-lock.yaml'],
  ['lock', 'packages/example/package.json'],
]) test(`${mode} requires a blob for ${path} even when its saved file mode is regular`, async () => {
  const {readInputAudit, fingerprintInputMode} = await api();
  const healthyGit = fixture();
  const healthy = fingerprintInputMode(mode, revision, healthyGit,
    readInputAudit(revision, healthyGit).entries, [manifestPath]);
  assert.equal(healthy.inputSha256, expectedDigest(mode));
  const tree = records.map(record => record.endsWith(`\t${path}\0`)
    ? record.replace('100644 blob', '100644 commit') : record).join('');
  const git = fixture({tree});
  const {entries} = readInputAudit(revision, git);
  assert.throws(() => fingerprintInputMode(mode, revision, git, entries, [manifestPath]), {
    code: 'ERR_ASSERTION', message: `Missing regular audit input: ${path}`,
  });
});

test('lock projections pin metadata validate all dependency kinds and require complete evidence', async () => {
  const {auditInputMode} = await api();
  const audited = {...policy(), lockInputSha256: expectedDigest('lock')};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(auditInputMode('lock', revision, fixture({audit: audited,
      packageJson: JSON.stringify({...manifest, [field]: {other: '^2'}})}), [manifestPath]).manifests[manifestPath], projection);
    for (const value of [null, [], true, 'wrong', 3, {one: 1}]) {
      assert.throws(() => auditInputMode('lock', revision, fixture({audit: audited,
        packageJson: JSON.stringify({...manifest, [field]: value})}), [manifestPath]), /dependencies|manifest/i);
    }
  }
  for (const value of [null, [], 1, 'text', {...manifest, name: 'different'}, {...manifest, scripts: {test: 'different'}}, {...manifest, license: 'MIT'}]) {
    assert.throws(() => auditInputMode('lock', revision, fixture({audit: audited, packageJson: JSON.stringify(value)}), [manifestPath]));
  }
  for (const manifests of [{}, {...audited.manifests, 'apps/extra/package.json': projection}]) {
    assert.throws(() => auditInputMode('lock', revision, fixture({audit: {...audited, manifests}}), [manifestPath]), /manifest/i);
  }
  assert.throws(() => auditInputMode('lock', revision, fixture({audit: audited}), []), /manifest/i);
  assert.throws(() => auditInputMode('lock', revision, fixture({audit: audited}), [manifestPath, manifestPath]), /manifest/i);
  const reordered = JSON.stringify({scripts: {test: 'node --test'}, dependencies: {}, name: 'example'});
  assert.equal(auditInputMode('lock', revision, fixture({audit: audited, packageJson: reordered}), [manifestPath]).manifests[manifestPath], projection);
});


function stagedFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-shared-audit-cli-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8', stdio: 'pipe'});
  const write = (path, value) => {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  };
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), ...args],
    {cwd: root, encoding: 'utf8', timeout: 10_000});
  const save = () => {git('add', '-A'); git('commit', '-s', '-qm', 'Save independent CLI inputs'); return git('rev-parse', 'HEAD').trim();};
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    write(policyPath, policy());
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'apps/*'\n");
    write('package.json', {name: 'root', private: true});
    write('packages/example/package.json', manifest);
    write('packages/example/src/value.mjs', 'export const value = 1;\n');
    write('apps/second/package.json', {name: 'second', scripts: {test: 'node --test'}, license: 'SEE LICENSE IN LICENSE'});
    write('pnpm-lock.yaml', 'lockfileVersion: \'9.0\'\n');
    write('README.md', 'Guide\n');
    for (const path of paths.filter(path => path.startsWith('scripts/') && path !== policyPath)) write(path, 'export const value = 1;\n');
    save();
    return run({root, git, write, cli, save});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('staged generation is explicit schema valid stable and independent of unstaged files', () => stagedFixture(({root, git, write, cli}) => {
  const original = readFileSync(join(root, policyPath), 'utf8');
  let index = git('write-tree');
  for (const args of [[], ['--write'], ['--write-staged', 'extra'], ['--check'], ['--check', 'HEAD'], ['--check', 'a'.repeat(40), 'extra']]) {
    const result = cli(...args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(readFileSync(join(root, policyPath), 'utf8'), original);
    assert.equal(git('write-tree'), index);
  }
  write('scripts/ci-plan.mjs', 'export const staged = true;\n');
  write('README.md', 'Staged guide\n');
  git('add', '--', 'scripts/ci-plan.mjs', 'README.md');
  index = git('write-tree');
  const result = cli('--write-staged');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const generated = readFileSync(join(root, policyPath), 'utf8');
  const audit = JSON.parse(generated);
  assert.deepEqual(Object.keys(audit).sort(), ['version', ...fields, 'manifests'].sort());
  assert.equal(audit.version, 1);
  assert.deepEqual(audit.manifests, {
    'apps/second/package.json': sha256('{"license":"SEE LICENSE IN LICENSE","name":"second","scripts":{"test":"node --test"}}'),
    [manifestPath]: projection,
  });
  const raw = git('ls-tree', '-rz', '--full-tree', index.trim()).split('\0').slice(0, -1);
  const excluded = {
    docs: [policyPath, 'README.md'],
    identity: [policyPath, 'scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs'],
    gateway: [policyPath, 'scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'],
    lock: [policyPath, 'pnpm-lock.yaml', manifestPath, 'apps/second/package.json'],
  };
  for (const [i, mode] of modes.entries()) assert.equal(audit[fields[i]], sha256(raw.filter(record => !excluded[mode].includes(record.slice(record.indexOf('\t') + 1))).map(record => record + '\0').join('')), mode);
  assert.equal(git('write-tree'), index, 'Generation must never stage its output');
  assert.equal(git('diff', '--name-only').trim(), policyPath, 'Generation writes only the policy');
  write('scripts/identity-upstream.mjs', 'Unstaged and intentionally invalid source');
  write(manifestPath, {name: 'unstaged', scripts: {test: 'different'}});
  write('pnpm-workspace.yaml', 'unsupported live layout');
  assert.equal(cli('--write-staged').status, 0);
  assert.equal(readFileSync(join(root, policyPath), 'utf8'), generated);
  git('add', '--', policyPath);
  assert.equal(cli('--write-staged').status, 0);
  assert.equal(readFileSync(join(root, policyPath), 'utf8'), generated);
  assert.equal(git('diff', '--', policyPath), '');
}));

test('all four audits pass together in a committed checkout and check never writes', () => stagedFixture(({root, git, write, cli, save}) => {
  const old = git('rev-parse', 'HEAD').trim();
  assert.notEqual(cli('--check', old).status, 0, 'Placeholders never qualify');
  const generated = cli('--write-staged');
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const head = save();
  const before = git('status', '--porcelain');
  const checked = cli('--check', head);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  for (const mode of modes) assert.match(checked.stdout, new RegExp('^' + mode + ': current$', 'm'));
  assert.equal(git('status', '--porcelain'), before);
  for (const path of ['scripts/ci-plan.mjs', 'README.md', manifestPath]) write(path, 'Invalid unstaged content');
  assert.equal(cli('--check', head).status, 0, 'Check reads committed blobs');
  assert.notEqual(cli('--check', git('rev-parse', head + '^{tree}').trim()).status, 0, 'Tree IDs are not committed revisions');
  write('scripts/ci-plan.mjs', 'export const changed = true;\n');
  write('README.md', 'Changed guide\n');
  write(manifestPath, {...manifest, license: 'Changed metadata'});
  const stale = save();
  const status = git('status', '--porcelain');
  assert.notEqual(cli('--check', stale).status, 0);
  assert.equal(git('status', '--porcelain'), status);
  assert.notEqual(cli('--check', old).status, 0, 'New head cannot qualify old placeholders');
}));

test('staged generation from a subfolder refuses without overwriting a lookalike policy', () => stagedFixture(({root, git, write, cli}) => {
  const original = readFileSync(join(root, policyPath), 'utf8');
  const healthy = cli('--write-staged');
  assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr);
  assert.notEqual(readFileSync(join(root, policyPath), 'utf8'), original);
  writeFileSync(join(root, policyPath), original);
  const nestedPath = 'packages/example/scripts/ci-input-audit.json';
  const nestedContent = 'Unrelated nested policy\n';
  write(nestedPath, nestedContent);
  const index = git('write-tree');
  const before = git('status', '--porcelain');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), '--write-staged'],
    {cwd: join(root, 'packages/example'), encoding: 'utf8', timeout: 10_000});
  assert.ifError(result.error);
  assert.equal(result.status, 1, `Subfolder generation must refuse: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /repository root/i);
  assert.equal(readFileSync(join(root, policyPath), 'utf8'), original, 'Refusal must preserve the root policy');
  assert.equal(readFileSync(join(root, nestedPath), 'utf8'), nestedContent, 'Refusal must preserve the nested policy');
  assert.equal(git('write-tree'), index, 'Refusal must preserve staged inputs');
  assert.equal(git('status', '--porcelain'), before, 'Refusal must leave the working tree unchanged');
}));

test('committed audit checking from a subfolder remains read only', () => stagedFixture(({root, git, cli, save}) => {
  const generated = cli('--write-staged');
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const head = save();
  const policyBefore = readFileSync(join(root, policyPath), 'utf8');
  const index = git('write-tree');
  const before = git('status', '--porcelain');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), '--check', head],
    {cwd: join(root, 'packages/example'), encoding: 'utf8', timeout: 10_000});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const mode of modes) assert.match(result.stdout, new RegExp('^' + mode + ': current$', 'm'));
  assert.equal(readFileSync(join(root, policyPath), 'utf8'), policyBefore);
  assert.equal(git('write-tree'), index);
  assert.equal(git('status', '--porcelain'), before);
}));

test('staged generation from Git metadata refuses without overwriting a lookalike policy', () => stagedFixture(({root, git, write}) => {
  const original = readFileSync(join(root, policyPath), 'utf8');
  const nestedPath = '.git/scripts/ci-input-audit.json';
  const nestedContent = 'Unrelated Git metadata policy\n';
  write(nestedPath, nestedContent);
  const index = git('write-tree');
  const before = git('status', '--porcelain');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), '--write-staged'],
    {cwd: join(root, '.git'), encoding: 'utf8', timeout: 10_000});
  assert.ifError(result.error);
  assert.equal(result.status, 1, `Generation inside Git metadata must refuse: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /repository root/i);
  assert.equal(readFileSync(join(root, policyPath), 'utf8'), original);
  assert.equal(readFileSync(join(root, nestedPath), 'utf8'), nestedContent);
  assert.equal(git('write-tree'), index);
  assert.equal(git('status', '--porcelain'), before);
}));

test('staged renewal refuses unsupported incomplete and nonregular workspace inputs without writing', () => stagedFixture(({root, git, write, cli}) => {
  const baseline = git('rev-parse', 'HEAD').trim();
  const cases = [
    () => write('pnpm-workspace.yaml', "packages:\n  - 'different/*'\n"),
    () => write('packages/example/package.json', {name: 'second', scripts: {test: 'node --test'}}),
    ...[{}, {test: ''}, {test: '   '}, {test: 5}].map(scripts => () => write(manifestPath, {...manifest, scripts})),
    ...[null, [], 1, {name: '', scripts: {test: 'node --test'}}].map(value => () => write(manifestPath, value)),
    ...['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].map(field => () => write(manifestPath, {...manifest, [field]: {one: 3}})),
    () => write(policyPath, {...policy(), unknown: true}),
    ...[policyPath, 'pnpm-workspace.yaml', 'pnpm-lock.yaml', manifestPath, 'scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs', 'scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'].flatMap(path => [
      () => rmSync(join(root, path)),
      () => {rmSync(join(root, path)); symlinkSync('untrusted', join(root, path));},
      {indexOnly: () => git('update-index', '--chmod=+x', path)},
      {indexOnly: () => git('update-index', '--add', '--cacheinfo', `160000,${baseline},${path}`)},
    ]),
  ];
  for (const [i, change] of cases.entries()) {
    git('reset', '--hard', baseline); git('clean', '-fd');
    if (change.indexOnly) change.indexOnly();
    else {change(); git('add', '-u', '--', '.');}
    const policyEntry = git('ls-files', '--stage', '--', policyPath);
    const before = policyEntry.startsWith('100644 ') ? readFileSync(join(root, policyPath), 'utf8') : null;
    const index = git('write-tree');
    const result = cli('--write-staged');
    assert.notEqual(result.status, 0, `Accepted invalid staged input ${i}: ${result.stdout}${result.stderr}`);
    assert.equal(git('write-tree'), index);
    if (before !== null) assert.equal(readFileSync(join(root, policyPath), 'utf8'), before, `Wrote policy on refusal ${i}`);
  }
}));

test('staged renewal never follows a live policy link outside its output path', () => stagedFixture(({root, cli}) => {
  const target = join(root, 'unrelated.json');
  writeFileSync(target, 'Unrelated owner content\n');
  rmSync(join(root, policyPath));
  symlinkSync(target, join(root, policyPath));
  const result = cli('--write-staged');
  assert.notEqual(result.status, 0, 'A staged regular policy cannot authorise writing through a live link');
  assert.equal(readFileSync(target, 'utf8'), 'Unrelated owner content\n');
}));

test('staged generation refuses a corrupted generated digest before changing output or index', () => stagedFixture(({root, git, write, cli}) => {
  const original = readFileSync(join(root, policyPath), 'utf8');
  const index = git('write-tree');
  const healthy = cli('--write-staged');
  assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr);
  assert.notEqual(readFileSync(join(root, policyPath), 'utf8'), original);
  assert.equal(git('write-tree'), index);
  writeFileSync(join(root, policyPath), original);

  // Corrupt only output serialization: staged input parsing and real Git reads still run.
  write('corrupt-generated-audit.mjs', `const stringify = JSON.stringify;
JSON.stringify = function(value, replacer, space) {
  if (space === 2 && value?.docsInputSha256) {
    JSON.stringify = stringify;
    process.stderr.write('Injected invalid generated digest\\n');
    return stringify({...value, docsInputSha256: 'invalid-generated-digest'}, replacer, space);
  }
  return stringify(value, replacer, space);
};
`);
  const before = git('status', '--porcelain');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'corrupt-generated-audit.mjs')).href,
    fileURLToPath(new URL('./ci-input-audit.mjs', import.meta.url)), '--write-staged'],
  {cwd: root, encoding: 'utf8', timeout: 10_000});
  assert.ifError(result.error);
  assert.match(result.stderr, /Injected invalid generated digest/);
  assert.equal(result.status, 1, `Invalid generated output must be refused: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /Invalid input audit digest: docsInputSha256/);
  assert.equal(readFileSync(join(root, policyPath), 'utf8'), original, 'Refusal must preserve the existing output');
  assert.equal(git('write-tree'), index, 'Refusal must preserve staged inputs');
  assert.equal(git('status', '--porcelain'), before, 'Refusal must leave the working tree unchanged');
}));


test('staged generation refuses a linked scripts directory without changing its outside policy', () => stagedFixture(({root, git, write, cli}) => {
  const healthy = cli('--write-staged');
  assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr);
  const outside = mkdtempSync(join(tmpdir(), 'cloud-audit-outside-'));
  try {
    renameSync(join(root, 'scripts'), join(outside, 'scripts'));
    symlinkSync(join(outside, 'scripts'), join(root, 'scripts'), 'dir');
    const target = join(outside, policyPath);
    const original = 'Unrelated outside policy\n';
    writeFileSync(target, original);
    write('scripts/owner-content.txt', 'Unrelated outside content\n');
    const index = git('write-tree');
    const before = git('status', '--porcelain');
    const result = cli('--write-staged');
    assert.ifError(result.error);
    assert.equal(readFileSync(target, 'utf8'), original, 'Generation must preserve the outside policy');
    assert.equal(result.status, 1, `Linked-directory generation must refuse: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /Audit output directory must be a real directory/);
    assert.equal(readFileSync(join(outside, 'scripts/owner-content.txt'), 'utf8'), 'Unrelated outside content\n');
    assert.equal(git('write-tree'), index, 'Refusal must preserve staged inputs');
    assert.equal(git('status', '--porcelain'), before, 'Refusal must preserve the working tree');
  } finally {rmSync(outside, {recursive: true, force: true});}
}));


test('committed audit checking through a linked scripts directory stays read only', () => stagedFixture(({root, git, cli, save}) => {
  const generated = cli('--write-staged');
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const head = save();
  const outside = mkdtempSync(join(tmpdir(), 'cloud-audit-check-outside-'));
  try {
    renameSync(join(root, 'scripts'), join(outside, 'scripts'));
    symlinkSync(join(outside, 'scripts'), join(root, 'scripts'), 'dir');
    const target = join(outside, policyPath);
    const original = 'Unrelated outside policy\n';
    writeFileSync(target, original);
    const index = git('write-tree');
    const before = git('status', '--porcelain');
    const result = cli('--check', head);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const mode of modes) assert.match(result.stdout, new RegExp('^' + mode + ': current$', 'm'));
    assert.equal(readFileSync(target, 'utf8'), original);
    assert.equal(git('write-tree'), index);
    assert.equal(git('status', '--porcelain'), before);
  } finally {rmSync(outside, {recursive: true, force: true});}
}));

test('committed audit checking with a hard-linked live policy stays read only', () => stagedFixture(({root, git, cli, save}) => {
  const generated = cli('--write-staged');
  assert.ifError(generated.error);
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const head = save();
  const outside = mkdtempSync(join(tmpdir(), 'cloud-audit-check-hardlink-'));
  try {
    const target = join(outside, 'owner-policy.json');
    linkSync(join(root, policyPath), target);
    const original = 'Unrelated live content\n';
    writeFileSync(target, original);
    const index = git('write-tree');
    const before = git('status', '--porcelain');
    const result = cli('--check', head);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const mode of modes) assert.match(result.stdout, new RegExp('^' + mode + ': current$', 'm'));
    assert.equal(readFileSync(target, 'utf8'), original);
    assert.equal(readFileSync(join(root, policyPath), 'utf8'), original);
    assert.equal(git('write-tree'), index);
    assert.equal(git('status', '--porcelain'), before);
  } finally {rmSync(outside, {recursive: true, force: true});}
}));


test('staged generation refuses a hard-linked policy without overwriting its outside alias', () => stagedFixture(({root, git, cli}) => {
  const outside = mkdtempSync(join(tmpdir(), 'cloud-audit-hardlink-'));
  try {
    const target = join(outside, 'owner-policy.json');
    const original = readFileSync(join(root, policyPath), 'utf8');
    linkSync(join(root, policyPath), target);
    const index = git('write-tree');
    const before = git('status', '--porcelain');
    const result = cli('--write-staged');
    assert.ifError(result.error);
    assert.equal(readFileSync(target, 'utf8'), original, 'Generation must preserve the outside alias');
    assert.equal(result.status, 1, `Hard-linked output must refuse: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /Audit output must have exactly one hard link/);
    assert.equal(readFileSync(join(root, policyPath), 'utf8'), original);
    assert.equal(git('write-tree'), index);
    assert.equal(git('status', '--porcelain'), before);
  } finally {rmSync(outside, {recursive: true, force: true});}
}));
