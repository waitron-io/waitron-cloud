import assert from 'node:assert/strict';

export function releaseManifest(packed, source) {
  assert.equal(source.repository, 'clintongormley/waitron', 'unexpected source repository');
  assert.match(source.commit, /^[0-9a-f]{40}$/, 'source commit must be pinned');
  assert.equal(packed.name, '@waitron/ui-core', 'unexpected package name');
  assert.equal(packed.version, source.version, 'unexpected package version');
  assert.deepEqual(packed.dependencies ?? {}, {}, 'runtime dependencies must remain external');
  assert(packed.exports?.['.']?.import, 'built exports required');
  for (const target of Object.values(packed.exports).flatMap(value => typeof value === 'string' ? [value] : Object.values(value))) {
    assert(target.startsWith('./dist/') && !target.split('/').includes('..'), 'built exports required');
  }
  const { private: _private, scripts: _scripts, devDependencies: _devDependencies, publishConfig: _publishConfig, ...manifest } = packed;
  return {
    ...manifest,
    name: '@waitron-io/ui-core',
    repository: { type: 'git', url: 'https://github.com/waitron-io/waitron-cloud.git' },
    homepage: `https://github.com/${source.repository}/tree/${source.commit}/packages/ui-core`,
    waitronSource: { ...source },
    publishConfig: { registry: 'https://npm.pkg.github.com', access: 'restricted' },
  };
}
