import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {measureIntegrationAssets} from './test-fixtures/integration-assets.mjs';
import * as probe from './test-fixtures/integration-asset-probe.mjs';

// Publishing manifest paths leaks unapproved fields and trips the receipt's existing lease-data refusal.
for (const kind of ['cloud', 'waitron']) test(kind + ' publishes aggregate asset evidence without manifest paths or extra fields', async () => {
  assert.equal(typeof probe.integrationAssetSummary, 'function', 'Public asset summary is missing');
  const root = await mkdtemp(join(tmpdir(), 'cloud-asset-summary-'));
  const paths = kind === 'cloud' ? ['apps/portal/dist/index.html'] : ['apps/dashboard/dist/index.html', 'apps/server/dist/hour-release.js'];
  const sha = value => createHash('sha256').update(value).digest('hex');
  try {
    for (const path of paths) {await mkdir(join(root, path, '..'), {recursive: true}); await writeFile(join(root, path), 'x');}
    const measured = await measureIntegrationAssets(root, kind);
    const image = 'sha256:' + 'a'.repeat(64);
    const summary = probe.integrationAssetSummary({image, ...measured, secretAccessKey: 'PRIVATE_ASSET_CANARY'});
    assert.deepEqual(summary, {image, kind, files: paths.length, bytes: paths.length,
      manifestSha256: sha(JSON.stringify(paths.map(path => ({path, bytes: 1, sha256: sha('x')}))))});
    for (const word of ['lease', 'path', 'entries', 'secretAccessKey', 'PRIVATE_ASSET_CANARY']) assert.equal(JSON.stringify(summary).includes(word), false, word);
    assert.equal(measured.entries.length, paths.length);
  } finally {await rm(root, {recursive: true, force: true});}
});
