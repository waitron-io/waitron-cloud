import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';

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
