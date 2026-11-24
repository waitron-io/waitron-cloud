import type { Pool, PoolClient } from 'pg';

export type TransactionOptions = {discardOnReadOnly?: boolean};

export async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>, options?: TransactionOptions): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  // A borrowed pg client emits failures itself, including between awaited queries.
  const onError = () => { discard = true; };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if(options?.discardOnReadOnly&&error instanceof Error&&'code' in error&&error.code==='25006')discard=true;
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
    client.removeListener('error', onError);
  }
}
