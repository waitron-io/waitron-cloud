import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseManifest } from './ui-manifest.mjs';

const source = { repository: 'clintongormley/waitron', commit: '0a93f4d3557b669661ac8f589aad866e2cd9653f', version: '0.1.0' };
const packed = {
  name: '@waitron/ui-core', version: '0.1.0', private: true, type: 'module',
  exports: { '.': { import: './dist/index.js', types: './dist/types/index.d.ts' } },
  peerDependencies: { lit: '^3.2.0' }, files: ['dist', 'README.md'],
  license: 'SEE LICENSE IN dist/LICENSE', scripts: { prepack: 'pnpm build' },
};
test('stages the built package under the organisation with source provenance and no build hooks', () => {
  const manifest = releaseManifest(packed, source);
  assert.equal(manifest.name, '@waitron-io/ui-core');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.scripts, undefined);
  assert.deepEqual(manifest.exports, packed.exports);
  assert.deepEqual(manifest.peerDependencies, packed.peerDependencies);
  assert.equal(manifest.license, packed.license);
  assert.equal(manifest.repository.url, 'https://github.com/waitron-io/waitron-cloud.git');
  assert.deepEqual(manifest.waitronSource, source);
  assert.equal(manifest.publishConfig.registry, 'https://npm.pkg.github.com');
  assert.equal(manifest.publishConfig.access, 'restricted');
  assert.equal(packed.private, true);
});
test('refuses an unexpected package, version or unpinned source', () => {
  assert.throws(() => releaseManifest({ ...packed, name: 'wrong' }, source), /name/);
  assert.throws(() => releaseManifest({ ...packed, version: '0.2.0' }, source), /version/);
  assert.throws(() => releaseManifest(packed, { ...source, commit: 'main' }), /commit/);
  assert.throws(() => releaseManifest(packed, { ...source, repository: 'other/repo' }), /repository/);
});
test('refuses source exports or workspace runtime dependencies', () => {
  assert.throws(() => releaseManifest({ ...packed, exports: { '.': './src/index.ts' } }, source), /built/);
  assert.throws(() => releaseManifest({ ...packed, dependencies: { '@waitron/shared': 'workspace:*' } }, source), /dependencies/);
});

test('stages a reserved release number without rewriting the source version', () => {
  const manifest = releaseManifest(packed, source, '0.2.0');
  assert.equal(manifest.version, '0.2.0');
  assert.deepEqual(manifest.waitronSource, source);
  assert.equal(packed.version, '0.1.0');
  assert.equal(source.version, '0.1.0');
});

test('refuses malformed release numbers while retaining source version validation', () => {
  for (const value of ['', '01.2.0', '0.2', '0.2.0-beta', '0.2.0+build', null, 2]) {
    assert.throws(() => releaseManifest(packed, source, value), /release version/);
  }
  assert.throws(() => releaseManifest({ ...packed, version: '0.2.0' }, source, '0.2.0'), /package version/);
});

test('preserves prerelease source versions on the legacy staging route', () => {
  const manifest = releaseManifest({...packed, version: '0.1.0-rc.1'}, {...source, version: '0.1.0-rc.1'});
  assert.equal(manifest.version, '0.1.0-rc.1');
  assert.equal(manifest.waitronSource.version, '0.1.0-rc.1');
});
