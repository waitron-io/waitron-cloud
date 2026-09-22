import { Pool } from 'pg';
import { EmailOutbox, EmailWorker } from '../../src/email-outbox.ts';
const pool = new Pool({connectionString: process.env.TEST_DATABASE_URL});
const outbox = new EmailOutbox({activeKeyId: 'first', keys: JSON.parse(process.env.EMAIL_TEST_KEYS!)});
const crash = async () => { process.exit(23); };
await new EmailWorker(pool, outbox, {sendVerification: crash, sendPasswordReset: crash, sendPasswordChanged: crash}).runOnce();
await pool.end();
