import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const consumers = ['apps/portal', 'packages/ui-smoke'];
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const stableVersion = version => typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(version)
  ? version.split('+')[0].split('.').map(BigInt) : null;
const newerThan = (version, installed) => {
  for (let i = 0; i < 3; i++) if (version[i] !== installed[i]) return version[i] > installed[i];
  return false;
};

export function evaluateUiLag(installed, metadata, now = Date.now()) {
  const version = stableVersion(installed);
  if (!version || !metadata?.versions || !Object.hasOwn(metadata.versions, installed) || !Number.isFinite(now)) return {status: 'unknown'};
  let missing = false;
  let earliest;
  for (const candidate of Object.keys(metadata.versions)) {
    const parsed = stableVersion(candidate);
    if (!parsed || !newerThan(parsed, version)) continue;
    const time = metadata.time?.[candidate];
    const published = typeof time === 'string' ? Date.parse(time) : NaN;
    if (!Number.isFinite(published)) { missing = true; continue; }
    if (!earliest || published < earliest.published) earliest = {version: candidate, published};
  }
  if (earliest && now - earliest.published > sevenDays) return {status: 'overdue', newerVersion: earliest.version, publishedAt: new Date(earliest.published).toISOString()};
  return {status: missing ? 'unknown' : 'current'};
}

export async function checkUiLag({root = fileURLToPath(new URL('..', import.meta.url)), now = Date.now(),
  token = process.env.NODE_AUTH_TOKEN, fetchImpl = fetch, report = console.log} = {}) {
  let versions, metadata;
  try {
    // Both exact manifest pins are installed by the shared frozen lockfile in CI.
    versions = consumers.map(path => JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')).dependencies?.['@waitron-io/ui-core']);
    const signal = AbortSignal.timeout(15_000);
    metadata = {versions: {}, time: {}};
    // GitHub's npm metadata omits publication times; version API created_at supplies them.
    for (let page = 1; ; page++) {
      const response = await fetchImpl(`https://api.github.com/orgs/waitron-io/packages/npm/ui-core/versions?per_page=100&page=${page}`, {
        headers: {Accept: 'application/vnd.github+json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
        signal, redirect: 'error',
      });
      if (!response.ok) throw new Error('Registry lookup failed');
      const versions = await response.json();
      if (!Array.isArray(versions)) throw new Error('Invalid version metadata');
      for (const version of versions) {
        metadata.versions[version.name] = {};
        metadata.time[version.name] = version.created_at;
      }
      if (versions.length < 100) break;
    }
  } catch {
    report('::warning::Shared UI version lag is unchecked: registry or version metadata is unavailable.');
    return 0;
  }
  let code = 0;
  for (const [i, path] of consumers.entries()) {
    const result = evaluateUiLag(versions[i], metadata, now);
    if (result.status === 'overdue') {
      report(`::error::${path}: shared UI ${versions[i]} is overdue; ${result.newerVersion} was published ${result.publishedAt}. Update within seven days of the first newer stable release.`);
      code = 1;
    } else if (result.status === 'unknown') {
      report(`::warning::${path}: shared UI version lag is unchecked because required version metadata is missing.`);
    } else {
      report(`${path}: shared UI ${versions[i]} is within the seven-day update window.`);
    }
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await checkUiLag();
