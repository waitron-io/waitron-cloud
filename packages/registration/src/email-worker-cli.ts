import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { EmailOutbox, EmailWorker } from './email-outbox.ts';
import { createLocalAccountMailer } from './local-mailer.ts';

let pool: Pool | undefined;
const stop = new AbortController();
const shutdown = () => stop.abort();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--once', '--status'].includes(args[0]!))) throw new Error();
  if (!process.env.DATABASE_URL || !process.env.CLOUD_EMAIL_KEYS || !process.env.CLOUD_EMAIL_ACTIVE_KEY_ID) throw new Error();
  const outbox = new EmailOutbox({activeKeyId: process.env.CLOUD_EMAIL_ACTIVE_KEY_ID, keys: JSON.parse(process.env.CLOUD_EMAIL_KEYS)});
  const mailer = createLocalAccountMailer({port: Number(process.env.MAILPIT_SMTP_PORT ?? 1125), portalOrigin: process.env.CLOUD_PORTAL_ORIGIN});
  pool = new Pool({connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  pool.on('error', () => { console.error('Email worker database connection failed'); process.exitCode = 1; stop.abort(); });
  const worker = new EmailWorker(pool, outbox, mailer);
  if (args[0] === '--status') console.log(JSON.stringify(await worker.status()));
  else if (args[0] === '--once') { await worker.runOnce(); console.log(JSON.stringify(await worker.status())); }
  else {
    while (!stop.signal.aborted) {
      if (!await worker.runOnce()) {
        try { await delay(1000, undefined, {signal: stop.signal}); }
        catch { if (!stop.signal.aborted) throw new Error(); }
      }
    }
  }
} catch {
  // Configuration and database errors can include secrets; operational output uses fixed diagnostics.
  console.error('Email worker failed; check database, key and local mail configuration');
  process.exitCode = 1;
} finally {
  try { await pool?.end(); } catch { process.exitCode = 1; }
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
}
