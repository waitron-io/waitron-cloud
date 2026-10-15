import assert from 'node:assert/strict';
import {assertInstallationInputs} from './ci-install-inputs.mjs';

const suite = 'test:local-stack';
// The suite imports deployment helpers and package readers, reads Compose, and
// spawns configuration/error probes. Pin whole deployment and migration trees
// to cover wildcard test discovery and directory reads, including new entries.
// Changed readers, installation inputs or execution wiring require a new audit.
const auditedInputs = [
  '100644 blob f283a731c4f2a605200d48cd7e8f5ddc3c4360cd\tscripts/ci-run-package-group.mjs',
  '100644 blob a986ac7c5f620f7dc05d3529a2db576108b3cd49\tscripts/ci-package-groups.mjs',
  '100644 blob de89cdf8bc9c614cf6c573449a937cb7728f8d09\t.github/workflows/ci.yml',
  '100644 blob a7776e95aa79764b5d00ff8b2bf983ab501d102e\tpackages/operations/src/metrics.ts',
  '100644 blob e06930b7229ac44a14187f449a582497e9df177d\tpackages/registration/src/migrate.ts',
  '100644 blob 499fc6c5da992a85931d8e9b3b1c8ed7bb7bbf46\tpackages/registration/src/transaction.ts',
  '100644 blob 3b9b040fb57c302e36bb91ccca2d7099dde5a5df\tpackages/remote-access/src/manifest.ts',
  '100644 blob 6798c4293890db910a5e1a179486d47133780d70\tscripts/ci-run-receipts.mjs',
  '100644 blob a8e639db9004f362aabb26ad4371fb01885c4dff\tscripts/ci-scope.mjs',
  '100644 blob 47212306f96eab384e924a109df54cf538724712\tscripts/local-stack-compose.mjs',
  '100644 blob 934507c9ffbd92ea5e18977d5709b78a93ede37b\tscripts/local-stack-compose.test.mjs',
  '100644 blob 8e54dcf26a5d541514504ca7913df8f8846fd868\tscripts/local-stack-lifecycle.mjs',
  '100644 blob 6ddc2f4cb174353a959aa7a20187d7f48da3de49\tscripts/local-stack-lifecycle.test.mjs',
  '100644 blob b78f339a55ff5e235d0c3dfbdb3fdc128b161eff\tscripts/scheduled-usage-proof.mjs',
  '100644 blob 9d80cb3140deed9b2706729e67a9a9e522e844ff\tscripts/scheduled-usage-proof.test.mjs',
  '100644 blob 3047df9c50f4a49a4e8bf8ebe9e9691167fa1cca\tscripts/schema-upgrade-fixture.mjs',
  '100644 blob 7289a91d7db9ee9bd60f57714863e774ed53e4d8\tscripts/schema-upgrade-fixture.test.mjs',
  '100644 blob ddefa6bad91a971182a53654489aabe8756ad49e\tscripts/verify-local-stack-receipt.mjs',
  '100644 blob 605d580964419dff1eb8e978bb6d419f672735a6\tscripts/verify-local-stack-receipt.test.mjs',
  '100644 blob 93a68009deab2db176176ba358296cf57f8baa12\tscripts/verify-schema-upgrade-receipt.mjs',
  '100644 blob 7a91a211182a07160e0238f8ac936691e771fb13\tscripts/verify-schema-upgrade-receipt.test.mjs',
];
const auditedDirectories = [
  '040000 tree 1388b4b8c35fae4cd0df38c6338f9afbc284cf8e\tdeploy/local-stack',
  '040000 tree 8420ab5f67fc01ca2ba923ebe87cef9fb2a16797\tpackages/registration/migrations',
];

export function localStackReceiptPlan(receipts, scope, base, head, git) {
  if (scope.full || !receipts.includes(suite)) return {receipts};
  try {
    for (const sha of [base, head]) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
      assert.equal(entries.pop(), '', 'Incomplete local-stack input inventory');
      assertInstallationInputs(entries);
      const inputs = new Set(entries);
      for (const input of auditedInputs) assert.ok(inputs.has(input), `Unaudited local-stack input: ${input.split('\t')[1]}`);
      const directories = git('ls-tree', '-z', sha, '--', 'deploy/local-stack', 'packages/registration/migrations').split('\0');
      assert.equal(directories.pop(), '', 'Incomplete local-stack directory inventory');
      assert.deepEqual(directories, auditedDirectories, 'Unaudited local-stack directory inputs');
    }
    return {receipts: receipts.filter(name => name !== suite), reason: 'Omitted local-stack receipt: unchanged audited local-stack inputs in both revisions'};
  } catch (error) {
    return {receipts, reason: `Kept local-stack receipt: ${error.message}`};
  }
}
