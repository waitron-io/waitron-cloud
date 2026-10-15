import assert from 'node:assert/strict';
import {assertInstallationInputs} from './ci-install-inputs.mjs';

const suite = 'test:public-gateway-limits';
// The executed tests reach the public gate and fallback page through real TLS
// sockets. All file reads use freshly generated keys; the validator CLI is guarded.
// Changed imports, installation inputs or execution wiring require a new audit.
const auditedInputs = [
  '100644 blob f283a731c4f2a605200d48cd7e8f5ddc3c4360cd\tscripts/ci-run-package-group.mjs',
  '100644 blob a986ac7c5f620f7dc05d3529a2db576108b3cd49\tscripts/ci-package-groups.mjs',
  '100644 blob 6798c4293890db910a5e1a179486d47133780d70\tscripts/ci-run-receipts.mjs',
  '100644 blob f27a1562a2f67e7785cfcedc095b3fa854b0f4b2\tscripts/ci-scope.mjs',
  '100644 blob de89cdf8bc9c614cf6c573449a937cb7728f8d09\t.github/workflows/ci.yml',
  '100644 blob 1f2ce2487e4344c25808f2e7a0dc022c09e818bb\tpackages/remote-access/src/public-gate.ts',
  '100644 blob 19f8152c87c79b3de48b298b32eebf93cd02ef02\tpackages/remote-access/src/public-unavailable.ts',
  '100644 blob e5a0fb1ca44c628cbc92299bb9f6ba4cd4f4c987\tscripts/public-gateway-limits.mjs',
  '100644 blob 10bf7fb3e89f8eced7ec9e0555aafc51c49bcc64\tscripts/public-gateway-limits.test.mjs',
  '100644 blob 977f56b09f95201a49ababd0d7cfd8c0a8adc355\tscripts/public-gateway-limits-receipt-fixture.mjs',
  '100644 blob 271b33525212b7057c51a18cee9f28f590ff5161\tscripts/verify-public-gateway-limits-receipt.mjs',
  '100644 blob 0db370a43ab0ebe6d0e3fdd476fec65562de17d8\tscripts/verify-public-gateway-limits-receipt.test.mjs',
];

export function gatewayReceiptPlan(receipts, scope, base, head, git) {
  if (scope.full || !receipts.includes(suite)) return {receipts};
  try {
    for (const sha of [base, head]) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
      assert.equal(entries.pop(), '', 'Incomplete public gateway input inventory');
      assertInstallationInputs(entries);
      const inputs = new Set(entries);
      for (const input of auditedInputs) assert.ok(inputs.has(input), `Unaudited public gateway input: ${input.split('\t')[1]}`);
    }
    return {receipts: receipts.filter(name => name !== suite), reason: 'Omitted public gateway receipt: unchanged audited public gateway inputs in both revisions'};
  } catch (error) {
    return {receipts, reason: `Kept public gateway receipt: ${error.message}`};
  }
}
