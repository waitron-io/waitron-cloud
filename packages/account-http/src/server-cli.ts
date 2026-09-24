import { Pool } from 'pg';
import { EmailOutbox, createLeaseIssuer } from '@waitron-cloud/registration';
import { accountHttpConfig } from './config.ts';
import { AccountRateLimiter } from './rate-limit.ts';
import { loadPortalAssets } from './portal.ts';
import { startAccountServer } from './server.ts';
let pool: Pool | undefined;
let running: Awaited<ReturnType<typeof startAccountServer>> | undefined;
let cleanup: ReturnType<typeof setInterval> | undefined;
let hardDeadline: ReturnType<typeof setTimeout> | undefined;
let stopRequested = false;
let resolveStop: () => void = () => {};
const stopped = new Promise<void>(resolve => {resolveStop = resolve;});
const stop = () => {
  if (stopRequested) return;
  stopRequested = true; clearInterval(cleanup); resolveStop();
  // A database operation may outlive the socket drain; bound the process lifetime too.
  hardDeadline = setTimeout(() => {console.error('Account server shutdown deadline exceeded'); process.exit(1);}, 11000);
  hardDeadline.unref();
};
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  if (process.argv.length !== 2 || !process.env.DATABASE_URL || !process.env.CLOUD_EMAIL_ACTIVE_KEY_ID || !process.env.CLOUD_EMAIL_KEYS) throw new Error();
  const config = accountHttpConfig(process.env);
  const portText = process.env.CLOUD_HTTP_PORT ?? '3000';
  if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new Error();
  const outbox = new EmailOutbox({activeKeyId: process.env.CLOUD_EMAIL_ACTIVE_KEY_ID, keys: JSON.parse(process.env.CLOUD_EMAIL_KEYS)});
  pool = new Pool({connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  pool.on('error', () => {console.error('Account server database connection failed'); process.exitCode = 1; stop();});
  if ((await pool.query("SELECT name FROM schema_migrations WHERE name IN ('007_account_http.sql','008_pairing.sql','009_installation_lifecycle.sql','010_remote_access.sql','011_managed_backups.sql')")).rowCount !== 5) throw new Error();
  if (!stopRequested) {
    const portalAssets = process.env.CLOUD_PORTAL_ASSETS_DIR ? await loadPortalAssets(process.env.CLOUD_PORTAL_ASSETS_DIR) : undefined;
    const leaseIssuer=process.env.CLOUD_INSTALLATION_ISSUER_KEY ? createLeaseIssuer(process.env.CLOUD_INSTALLATION_ISSUER_KEY) : undefined;
    running = await startAccountServer({pool, outbox, config, portalAssets, leaseIssuer, host: process.env.CLOUD_HTTP_HOST ?? '127.0.0.1', port: Number(portText)});
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error();
    console.log(JSON.stringify({status: 'listening', port: address.port}));
    const limiter = new AccountRateLimiter(pool, config.rateKey); let pruning = false;
    cleanup = setInterval(async () => {
      if (pruning || stopRequested) return;
      pruning = true;
      try {await limiter.prune();} catch {console.error('Account server rate cleanup failed');}
      finally {pruning = false;}
    }, 60000); cleanup.unref();
    await stopped;
  }
} catch {
  console.error('Account server failed; check database, migrations and configuration'); process.exitCode = 1;
} finally {
  stop();
  try {await running?.close(); await pool?.end();} catch {process.exitCode = 1;}
  clearInterval(cleanup); clearTimeout(hardDeadline);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
