import assert from 'node:assert/strict';
import {capacityReceiptPlan} from './ci-capacity-receipt.mjs';
import {databaseReceiptPlan} from './ci-database-receipt.mjs';
import {gatewayReceiptPlan} from './ci-gateway-receipt.mjs';
import {localStackReceiptPlan} from './ci-local-stack-receipt.mjs';

const suite = 'test:two-venue-milestone-receipt';
const command = 'node --test scripts/milestone-proof-helpers.test.mjs scripts/verify-managed-recovery-receipt.test.mjs scripts/verify-two-venue-milestone-receipt.test.mjs';
// These exact readers exercise pure validation/composition. Their subprocess and
// file-reader CLI blocks are guarded and do not run when the tests import them.
// Changed readers or execution wiring require a new audit before omitting work.
const auditedInputs = [
  '100644 blob f283a731c4f2a605200d48cd7e8f5ddc3c4360cd\tscripts/ci-run-package-group.mjs',
  '100644 blob a986ac7c5f620f7dc05d3529a2db576108b3cd49\tscripts/ci-package-groups.mjs',
  '100644 blob 6798c4293890db910a5e1a179486d47133780d70\tscripts/ci-run-receipts.mjs',
  '100644 blob f27a1562a2f67e7785cfcedc095b3fa854b0f4b2\tscripts/ci-scope.mjs',
  '100644 blob de89cdf8bc9c614cf6c573449a937cb7728f8d09\t.github/workflows/ci.yml',
  '100644 blob 498083173ee9995b076e8fa6ab6c68d34496182a\tscripts/cloud-two-venue-milestone-receipt.mjs',
  '100644 blob 8236607cb5a5e5b00ab32dbc1e6bce08dc0e4cff\tscripts/managed-recovery-receipt.fixture.mjs',
  '100644 blob f121f0fd23d7089e299183cb8c837d1592ee69e4\tscripts/milestone-proof-helpers.mjs',
  '100644 blob cf15ce32589d502b531edf3d2d6b8853a4aaeaf5\tscripts/milestone-proof-helpers.test.mjs',
  '100644 blob 8cd2c7cc6a45591825a581dc7e7e88192f375475\tscripts/verify-backup-capacity-receipt.mjs',
  '100644 blob 40ad1f612609f31f427aa150f0e47df04c802ac6\tscripts/verify-backup-transfer-receipt.mjs',
  '100644 blob b6a7d5881d3b1ac01c63db82d659ca17248df351\tscripts/verify-managed-recovery-receipt.mjs',
  '100644 blob deea5a57d198528cfe7a3c01e6f72ff228bf6e65\tscripts/verify-managed-recovery-receipt.test.mjs',
  '100644 blob 50c6c90d396af2d2b60bd5ab467007960af4c178\tscripts/verify-two-venue-milestone-receipt.mjs',
  '100644 blob c9c926755c5a6a80653c2c8b0e07f3a2376a6f84\tscripts/verify-two-venue-milestone-receipt.test.mjs',
];

function milestoneReceiptPlan(receipts, scope, base, head, git) {
  if (scope.full || !receipts.includes(suite)) return {receipts};
  try {
    for (const sha of [base, head]) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
      assert.equal(entries.pop(), '', 'Incomplete receipt input inventory');
      const inputs = new Set(entries);
      for (const input of auditedInputs) assert.ok(inputs.has(input), `Unaudited receipt input: ${input.split('\t')[1]}`);
      const manifest = JSON.parse(git('show', `${sha}:package.json`));
      assert.equal(manifest.scripts?.[suite], command, 'Unaudited milestone test command');
    }
    return {receipts: receipts.filter(name => name !== suite), reason: 'Omitted milestone receipt: unchanged audited milestone inputs in both revisions'};
  } catch (error) {
    return {receipts, reason: `Kept milestone receipt: ${error.message}`};
  }
}

export function receiptPlan(receipts, scope, base, head, git) {
  const milestone = milestoneReceiptPlan(receipts, scope, base, head, git);
  const capacity = capacityReceiptPlan(milestone.receipts, scope, base, head, git);
  const database = databaseReceiptPlan(capacity.receipts, scope, base, head, git);
  const gateway = gatewayReceiptPlan(database.receipts, scope, base, head, git);
  const localStack = localStackReceiptPlan(gateway.receipts, scope, base, head, git);
  return {receipts: localStack.receipts, reason: [milestone.reason, capacity.reason, database.reason, gateway.reason, localStack.reason].filter(Boolean).join('; ')};
}
