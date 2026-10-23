import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createLeaseIssuer } from '../../registration/src/installation-proof.ts';

// Only the unavailable PostgreSQL boundary is replaced; authorities and HTTP listeners stay real.
export const probe = {
  fail: '',
  error: new Error('forced fixture setup failure'),
  pools: [] as Pool[],
};
export async function database() {
  const pool = new Pool();
  probe.pools.push(pool);
  const query = async (sql: string) => {
    if ((probe.fail === 'table' && sql.startsWith('CREATE TABLE fiscal_test_authority')) ||
        (probe.fail === 'machine' && sql.startsWith('UPDATE installations SET public_key=')))
      throw probe.error;
    if (sql.startsWith('SELECT venue_id FROM installations'))
      return { rows: [{ venue_id: '10000000-0000-4000-8000-000000000002' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  Object.assign(pool, { query });
  const issuer = createLeaseIssuer(generateKeyPairSync('ed25519').privateKey
    .export({ type: 'pkcs8', format: 'der' }).toString('base64url'));
  return {
    pool, issuer,
    async venue() {
      if (probe.fail === 'venue') throw probe.error;
      return {
        account: randomUUID(), installation: randomUUID(),
        session: { token: 'fixture-session', csrfToken: 'fixture-csrf' },
      };
    },
    async close() { await pool.end(); },
  };
}
