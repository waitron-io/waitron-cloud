import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { RegistrationStore } from '../../src/index.ts';
const { action, binding, accountId, receiptId } = JSON.parse(readFileSync(0, 'utf8'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: process.env.TEST_DATABASE_OPTIONS });
try {
  const store = new RegistrationStore(pool);
  if (action === 'prepare') {
    await store.start(binding);
    await store.approveLocal(binding, receiptId);
    await store.approveCloud(binding, accountId);
  } else {
    process.stdout.write(JSON.stringify(await store.complete(binding)));
  }
} finally {
  await pool.end();
}
