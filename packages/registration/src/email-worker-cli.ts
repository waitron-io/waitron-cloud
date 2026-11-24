import {fileURLToPath} from 'node:url';
import { Pool, type ClientBase } from 'pg';
import { EmailOutbox, EmailWorker, emailDeliveryStatus } from './email-outbox.ts';
import { configuredAccountMailer,configuredSesHandoff } from './configured-mailer.ts';
import {runWorkerLoop} from './worker-loop.ts';

let pool: Pool | undefined;
let schemaRefused = false;
const stop = new AbortController();
const shutdown = () => stop.abort();
const workerConcurrency = 4;
const configurationHint = 'check database, key and mail configuration';
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--once', '--status'].includes(args[0]!))) throw new Error();
  if (!process.env.DATABASE_URL) throw new Error();
  const continuous = args.length === 0;
  const schemaModule = new URL('../../../deploy/local-stack/runtime.mjs', import.meta.url).href;
  const checkSchema = continuous ? (await import(schemaModule)).checkConsumerSchema : undefined;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  pool = new Pool({connectionString: process.env.DATABASE_URL, max: workerConcurrency + 1, connectionTimeoutMillis: 5000, statement_timeout: 10000,
    ...(continuous ? {query_timeout: 11000, async onConnect(client: ClientBase) {
      // A replacement connection must pass the same schema check as the worker at startup.
      try { await checkSchema(client, root); }
      catch (error) {
        if (!schemaRefused && error instanceof Error && error.message === 'schema_incompatible') {
          schemaRefused = true;
          console.error('Email worker refused: schema_incompatible');
          process.exitCode = 1;
          stop.abort();
        }
        throw error;
      }
    }} : {}),
  });
  pool.on('error', () => {
    console.error('Email worker database connection failed');
    if (!continuous || stop.signal.aborted) { process.exitCode = 1; stop.abort(); }
  });
  if (args[0] === '--status') console.log(JSON.stringify(await emailDeliveryStatus(pool)));
  else {
    if (!process.env.CLOUD_EMAIL_KEYS || !process.env.CLOUD_EMAIL_ACTIVE_KEY_ID) throw new Error();
    const outbox = new EmailOutbox({activeKeyId: process.env.CLOUD_EMAIL_ACTIVE_KEY_ID, keys: JSON.parse(process.env.CLOUD_EMAIL_KEYS)});
    const ses=configuredSesHandoff();
    const worker = new EmailWorker(pool, outbox, configuredAccountMailer(ses),{ses});
    if (args[0] === '--once') { await worker.runOnce(); console.log(JSON.stringify(await worker.status())); }
    else await runWorkerLoop({signal:stop.signal,concurrency:workerConcurrency,scheduleIntervalMs:60000,pollIntervalMs:1000,runOnce:()=>worker.runOnce(),onError(error){
      if (stop.signal.aborted) throw error;
      console.error(`Email worker retrying; ${configurationHint}`);
    }});
  }
} catch {
  // Configuration and database errors can include secrets; operational output uses fixed diagnostics.
  if (!schemaRefused) console.error(`Email worker failed; ${configurationHint}`);
  process.exitCode = 1;
} finally {
  try { await pool?.end(); } catch { process.exitCode = 1; }
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
}
