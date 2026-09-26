import { Pool } from 'pg';
import { EmailOutbox, EmailWorker, emailDeliveryStatus } from './email-outbox.ts';
import { configuredAccountMailer } from './configured-mailer.ts';
import {runWorkerLoop} from './worker-loop.ts';

let pool: Pool | undefined;
const stop = new AbortController();
const shutdown = () => stop.abort();
const workerConcurrency = 4;
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--once', '--status'].includes(args[0]!))) throw new Error();
  if (!process.env.DATABASE_URL) throw new Error();
  pool = new Pool({connectionString: process.env.DATABASE_URL, max: workerConcurrency + 1, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  pool.on('error', () => { console.error('Email worker database connection failed'); process.exitCode = 1; stop.abort(); });
  if (args[0] === '--status') console.log(JSON.stringify(await emailDeliveryStatus(pool)));
  else {
    if (!process.env.CLOUD_EMAIL_KEYS || !process.env.CLOUD_EMAIL_ACTIVE_KEY_ID) throw new Error();
    const outbox = new EmailOutbox({activeKeyId: process.env.CLOUD_EMAIL_ACTIVE_KEY_ID, keys: JSON.parse(process.env.CLOUD_EMAIL_KEYS)});
    const worker = new EmailWorker(pool, outbox, configuredAccountMailer());
    if (args[0] === '--once') { await worker.runOnce(); console.log(JSON.stringify(await worker.status())); }
    else await runWorkerLoop({signal:stop.signal,concurrency:workerConcurrency,scheduleIntervalMs:60000,pollIntervalMs:1000,runOnce:()=>worker.runOnce()});
  }
} catch {
  // Configuration and database errors can include secrets; operational output uses fixed diagnostics.
  console.error('Email worker failed; check database, key and mail configuration');
  process.exitCode = 1;
} finally {
  try { await pool?.end(); } catch { process.exitCode = 1; }
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
}
