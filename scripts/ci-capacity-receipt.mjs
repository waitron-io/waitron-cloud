import assert from 'node:assert/strict';

const suite = 'test:backup-capacity';
// The TLS fixture reads only its own generated temporary files. Its repository
// imports, dependency installation and execution wiring must retain this audit.
const auditedInputs = [
  '100644 blob e57300de069beb99f9baeca01220ba13ca64c566\t.github/workflows/ci.yml',
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

const installInputs = [
  "100644 blob 0458d7abeecc6c7cdc016649bbf0aa5918d71cf6\t.dockerignore",
  "100644 blob 70fd08149c5917f95f18f52f66f38172af4312f8\t.env.example",
  "100644 blob 6e29ad9def2a84393d84be5526b7585689c8e079\t.gitignore",
  "100644 blob c497f12cf9a96298962ce3546e5a70ed423527b6\t.npmrc",
  "100644 blob 971b0ee514238e13bf21780566d349a25a5efe96\tapps/portal/package.json",
  "100644 blob eea3c685174e08fd1c096290e1ac0c139c722e1f\tcompose.yaml",
  "100644 blob f4fd86edd4238a024a8662af045989d51c9f3acc\tpackage.json",
  "100644 blob 559d3b0e13eb1cbefcce5e3ec478b35b8b8a1ffb\tpackages/account-http/package.json",
  "100644 blob ab4c519931d4a7aafd65f347deec0acf88bf213d\tpackages/backups/package.json",
  "100644 blob 84eb2b57ce3411e0f05ecd49a02d726018982b79\tpackages/fiscal-allocation/package.json",
  "100644 blob 7384839357d4b0b5322053daa0a0a607ff2787c6\tpackages/identity/package.json",
  "100644 blob 4ad264e2c4428ab69588d2ac1d58f963990a4030\tpackages/operations/package.json",
  "100644 blob 8bd23b3ab5931e0243756e0e9f2e2474304a71a4\tpackages/registration/package.json",
  "100644 blob 14e7a1a511911b087ce0e763abd350922403d872\tpackages/remote-access/package.json",
  "100644 blob 94ea5734a128370ccbecd98615ee8c0e5c263aa0\tpackages/ui-smoke/package.json",
  "100644 blob 583d808eed0331036c294476452349b1cab5d7ba\tpnpm-lock.yaml",
  "100644 blob 4e708bd3c5b28237a16b37d5ed737ce2d9450496\tpnpm-workspace.yaml",
  "100644 blob 6e606a5efb5613e22433f25cf8eab849e3b7e9ce\ttsconfig.json"
];

export function capacityReceiptPlan(receipts, scope, base, head, git) {
  if (scope.full || !receipts.includes(suite)) return {receipts};
  try {
    for (const sha of [base, head]) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
      assert.equal(entries.pop(), '', 'Incomplete capacity input inventory');
      const installation = entries.filter(entry => {
        const path = entry.split('\t')[1];
        return path && ((!path.includes('/') && !path.endsWith('.md')) || /^(?:packages|apps)\/[^/]+\/(?:package.json|\.npmrc|\.pnpmfile\.cjs)$/.test(path));
      });
      assert.deepEqual(installation, installInputs, 'Unaudited dependency installation inputs');
      const inputs = new Set(entries);
      for (const input of auditedInputs) assert.ok(inputs.has(input), `Unaudited capacity input: ${input.split('\t')[1]}`);
    }
    return {receipts: receipts.filter(name => name !== suite), reason: 'Omitted capacity receipt: unchanged audited capacity inputs in both revisions'};
  } catch (error) {
    return {receipts, reason: `Kept capacity receipt: ${error.message}`};
  }
}
