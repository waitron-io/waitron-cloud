import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { migrationNames } from '../src/migrate.ts';

test('retained fiscal registry migration keeps its ledger position and original digest', async () => {
  assert.equal(migrationNames[37], '038_fiscal_allocation_registry.sql');
  const sql = await readFile(new URL('../migrations/038_fiscal_allocation_registry.sql', import.meta.url));
  assert.equal(createHash('sha256').update(sql).digest('hex'),
    '8828e2ca25fbff5bcfd61136b2b2d7501a654e3580225fd2ffac7e191f259fee');
});
