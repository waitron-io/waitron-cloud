const checksums = new Map([
  ['0.5.17', 'cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d'],
  ['0.5.18', 'd3687b9fd0f2e9426bbd3da828429ff3f1dfc5c9b74d54fdf028e4ee510e7dea'],
]);

export function integrationLitestreamRelease(source) {
  const version = /^export const LITESTREAM_VERSION = ["']([^"']+)["'];$/m.exec(source)?.[1];
  const checksum = checksums.get(version);
  if (!checksum) throw Error('integration.litestream_version_unpinned');
  return {version, checksum,
    url: `https://github.com/benbjohnson/litestream/releases/download/v${version}/litestream-${version}-linux-x86_64.tar.gz`};
}
