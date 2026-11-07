import assert from 'node:assert/strict';
import {test} from 'node:test';
import {integrationLitestreamRelease} from './test-fixtures/integration-litestream-release.mjs';

// A fixture fixed to either release would reject the other paired Waitron image.
for (const [version, checksum] of [
  ['0.5.17', 'cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d'],
  ['0.5.18', 'd3687b9fd0f2e9426bbd3da828429ff3f1dfc5c9b74d54fdf028e4ee510e7dea'],
]) test(`selects the checksum-verified ${version} release required by the paired image`, () => {
  assert.deepEqual(integrationLitestreamRelease(`export const LITESTREAM_VERSION = "${version}";`), {
    version, checksum,
    url: `https://github.com/benbjohnson/litestream/releases/download/v${version}/litestream-${version}-linux-x86_64.tar.gz`,
  });
});

for (const source of ['', 'export const LITESTREAM_VERSION = "0.5.19";',
  'export const LITESTREAM_VERSION = "../../outside";']) {
  test(`refuses an absent or unpinned image version: ${JSON.stringify(source)}`, () => {
    assert.throws(() => integrationLitestreamRelease(source), /integration.litestream_version_unpinned/);
  });
}
