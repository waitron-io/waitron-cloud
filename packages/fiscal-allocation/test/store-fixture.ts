import { randomUUID } from 'node:crypto';
import { fixture } from '../../registration/test/fixtures/relay-worker.ts';
import { authorityFixture, policy } from './continuity-fixture.ts';
import { bases, reserve, key } from './fixtures.ts';
import { FiscalAllocationStore } from '../src/store.ts';
import type { ContinuityAuthority, RegistryOptions } from '../src/policy.ts';

export async function storeFixture() {
  const f = await fixture();
  let a: Awaited<ReturnType<typeof authorityFixture>> | undefined;
  async function close() {
    try {
      await a?.close();
    } finally {
      await f.close();
    }
  }
  try {
    a = await authorityFixture();
    await f.pool.query(`CREATE TABLE fiscal_test_authority(account_id uuid PRIMARY KEY,
      entitlement boolean NOT NULL DEFAULT true, custody boolean NOT NULL DEFAULT true,
      operator_verified boolean NOT NULL DEFAULT true, bases jsonb NOT NULL)`);
    async function venue() {
      const v = await f.venue();
      const id = (
        await f.pool.query('SELECT venue_id FROM installations WHERE id=$1', [v.installation])
      ).rows[0].venue_id;
      await f.pool.query('INSERT INTO fiscal_test_authority(account_id,bases) VALUES($1,$2)', [
        v.account,
        JSON.stringify(bases),
      ]);
      return { ...v, id, input: { ...reserve(), venueId: id, operationId: randomUUID() } };
    }
    const options = testOptions(a.adapter());
    return {
      f,
      a,
      options,
      venue,
      store: new FiscalAllocationStore(f.pool, options),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function blocked(pool: import('pg').Pool) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const r = await pool.query(
      "SELECT query FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
      [pool.options.application_name],
    );
    if (r.rowCount) return r.rows[0].query;
  }
  throw Error('the registry did not reach its real database lock');
}

export function testOptions(authority: ContinuityAuthority): RegistryOptions {
  return {
    signer: key(),
    trust: authority.verification.receipts,
    continuity: authority,
    policy,
    entitlement: {
      async check(c, accountId, _venue, action) {
        const r = (
          await c.query(
            'SELECT entitlement FROM fiscal_test_authority WHERE account_id=$1 FOR SHARE',
            [accountId],
          )
        ).rows[0];
        return { allowed: !!r && (action === 'read' || r.entitlement), version: 'entitlement-1' };
      },
    },
    custody: {
      async check(c, accountId) {
        const r = (
          await c.query('SELECT * FROM fiscal_test_authority WHERE account_id=$1 FOR SHARE', [
            accountId,
          ])
        ).rows[0];
        return {
          custodianId: r?.custody ? 'custodian-1' : '',
          custodyVersion: 'custody-1',
          operatorBindingVerified: !!r?.operator_verified,
          requiredBases: r?.bases ?? [],
        };
      },
    },
  };
}
