import assert from 'node:assert/strict';
import {assertInstallationInputs} from './ci-install-inputs.mjs';

const suite = 'test:backup-capacity';
// The TLS fixture creates its data; the SDK may also read host configuration.
// Repository imports, dependency installation and execution wiring retain this audit.
const auditedInputs = [
  '100644 blob f283a731c4f2a605200d48cd7e8f5ddc3c4360cd\tscripts/ci-run-package-group.mjs',
  '100644 blob a986ac7c5f620f7dc05d3529a2db576108b3cd49\tscripts/ci-package-groups.mjs',
  '100644 blob 6798c4293890db910a5e1a179486d47133780d70\tscripts/ci-run-receipts.mjs',
  '100644 blob f27a1562a2f67e7785cfcedc095b3fa854b0f4b2\tscripts/ci-scope.mjs',
  '100644 blob de89cdf8bc9c614cf6c573449a937cb7728f8d09\t.github/workflows/ci.yml',
  '100644 blob c497f12cf9a96298962ce3546e5a70ed423527b6\t.npmrc',
  '100644 blob f4fd86edd4238a024a8662af045989d51c9f3acc\tpackage.json',
  '100644 blob ab4c519931d4a7aafd65f347deec0acf88bf213d\tpackages/backups/package.json',
  '100644 blob 385b39585d41a0e04492a77c4c1095823ad24e50\tpackages/backups/src/object-transfer.ts',
  '100644 blob b3d34989fe2833749ddc6a892c150ea0fecc2df0\tpackages/backups/src/storage.ts',
  '100644 blob 583d808eed0331036c294476452349b1cab5d7ba\tpnpm-lock.yaml',
  '100644 blob 4e708bd3c5b28237a16b37d5ed737ce2d9450496\tpnpm-workspace.yaml',
  '100644 blob a04c03953f886ff1271b576dc910ec90a2417b94\tscripts/backup-capacity-fixture.mjs',
  '100644 blob 4224e8efb12dc63848ba76b7070d40615101d930\tscripts/backup-capacity-fixture.test.mjs',
  '100644 blob 8cd2c7cc6a45591825a581dc7e7e88192f375475\tscripts/verify-backup-capacity-receipt.mjs',
  '100644 blob 85700fb4875d7b4c398eca5a2cd0f3d0eb1afa42\tscripts/verify-backup-capacity-receipt.test.mjs',
  '100644 blob 40ad1f612609f31f427aa150f0e47df04c802ac6\tscripts/verify-backup-transfer-receipt.mjs',
  '100644 blob ea565c1f918f72f3d84d0ae7cd1da511599070ca\tscripts/verify-backup-transfer-receipt.test.mjs',
  '100644 blob 6e606a5efb5613e22433f25cf8eab849e3b7e9ce\ttsconfig.json',
];

export function capacityReceiptPlan(receipts, scope, base, head, git) {
  if (scope.full || !receipts.includes(suite)) return {receipts};
  try {
    for (const sha of [base, head]) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
      assert.equal(entries.pop(), '', 'Incomplete capacity input inventory');
      assertInstallationInputs(entries);
      const inputs = new Set(entries);
      for (const input of auditedInputs) assert.ok(inputs.has(input), `Unaudited capacity input: ${input.split('\t')[1]}`);
    }
    return {receipts: receipts.filter(name => name !== suite), reason: 'Omitted capacity receipt: unchanged audited capacity inputs in both revisions'};
  } catch (error) {
    return {receipts, reason: `Kept capacity receipt: ${error.message}`};
  }
}
