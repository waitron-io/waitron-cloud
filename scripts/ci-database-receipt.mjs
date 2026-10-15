import assert from 'node:assert/strict';
import {assertInstallationInputs} from './ci-install-inputs.mjs';

const suite = 'test:database-recovery-receipt';
// The recovery drill is syntax-checked, not executed. The tests import the
// validator and migration-count helper, including migrate.ts and transaction.ts.
// Changed readers, imports or installation inputs require renewed evidence.
const auditedInputs = [
  '100644 blob 91bd1b06d5bacbdeaa06b35f2ff3b9916bf00879\t.github/workflows/ci.yml',
  '100644 blob e06930b7229ac44a14187f449a582497e9df177d\tpackages/registration/src/migrate.ts',
  '100644 blob 499fc6c5da992a85931d8e9b3b1c8ed7bb7bbf46\tpackages/registration/src/transaction.ts',
  '100644 blob 39ebcc2a20fb61bb8a606d79459f5f922330e39f\tscripts/database-recovery-fixture.mjs',
  '100644 blob 59ccb5b2c8976529682613bc8af332f8bc7e4f9a\tscripts/database-recovery-migrations.mjs',
  '100644 blob cc1885e25382c212367a77cc03954c6698e0dd0f\tscripts/database-recovery-migrations.test.mjs',
  '100644 blob dea89a49f19068dbf1eab6e0000ed1b6ca7b9bdd\tscripts/database-recovery-receipt.mjs',
  '100644 blob fe9f673a1700978a082ce3e801afc79b2fbe1595\tscripts/verify-database-recovery-receipt.mjs',
  '100644 blob 3e8ea857a22f04f8456fc7959e219cf98a49bbdf\tscripts/verify-database-recovery-receipt.test.mjs',
];

export function databaseReceiptPlan(receipts, scope, base, head, git) {
  if (scope.full || !receipts.includes(suite)) return {receipts};
  try {
    for (const sha of [base, head]) {
      assert.match(sha, /^[a-f0-9]{40}$/);
      const entries = git('ls-tree', '-rz', '--full-tree', sha).split('\0');
      assert.equal(entries.pop(), '', 'Incomplete database recovery input inventory');
      assertInstallationInputs(entries);
      const inputs = new Set(entries);
      for (const input of auditedInputs) assert.ok(inputs.has(input), `Unaudited database recovery input: ${input.split('\t')[1]}`);
    }
    return {receipts: receipts.filter(name => name !== suite), reason: 'Omitted database recovery receipt: unchanged audited database recovery inputs in both revisions'};
  } catch (error) {
    return {receipts, reason: `Kept database recovery receipt: ${error.message}`};
  }
}
