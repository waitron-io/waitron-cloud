import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runTestCloudClients, runTestCloudCombined, runTestCloudPairedExpiry} from './test-cloud-integration.mjs';

// Losing the trusted checkout requirement must refuse before the first Docker command.
for (const [name, run] of [['clients', runTestCloudClients], ['combined', runTestCloudCombined], ['paired expiry', runTestCloudPairedExpiry]]) {
  test(name + ' refuses source provenance without a pinned Waitron checkout', async () => {
    await assert.rejects(run({image: 'sha256:' + 'a'.repeat(64), waitronImage: 'sha256:' + 'b'.repeat(64),
      sourceProvenance: true, waitronCheckout: ''}), /integration.waitron_checkout_required/);
  });
}

for (const [name, run] of [['clients', runTestCloudClients], ['combined', runTestCloudCombined], ['paired expiry', runTestCloudPairedExpiry]]) test(name + ' refuses a clean Waitron checkout at a different commit before Docker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-waitron-binding-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  try {
    git('init', '-q');
    git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '--allow-empty', '-q', '-s', '-m', 'Other source');
    await assert.rejects(run({sourceProvenance: true, image: 'sha256:' + 'a'.repeat(64), waitronImage: 'sha256:' + 'b'.repeat(64),
      waitronCheckout: root}), /waitron_source.pin/);
  } finally {await rm(root, {recursive: true, force: true});}
});
