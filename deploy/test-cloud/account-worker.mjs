import {openTestCaptureRuntime} from './service-runtime.mjs';
import {createRequire} from 'node:module';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
import { EmailOutbox, createLeaseIssuer, createLeaseTrust, migrationNames, parsePlanMode } from '../../packages/registration/src/index.ts';
import { accountHttpConfig, passwordScreeningFromEnv, factorConfigFromEnv } from '../../packages/account-http/src/config.ts';
import { AccountRateLimiter } from '../../packages/account-http/src/rate-limit.ts';
import { loadPortalAssets } from '../../packages/account-http/src/portal.ts';
import { startAccountServer } from '../../packages/account-http/src/server.ts';
let captures;
let pool;
let running;
let cleanup;
let hardDeadline;
let stopRequested = false;
let resolveStop = () => {};
const stopped = new Promise(resolve => {resolveStop = resolve;});
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
  const planMode=parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS);
  const staffFlag=process.env.CLOUD_STAFF_CERTIFICATES??'0';if(!['0','1'].includes(staffFlag))throw new Error();
  const staffCertificates=staffFlag==='1';
  const translationFlag=process.env.CLOUD_TRANSLATION??'0';if(!['0','1'].includes(translationFlag))throw new Error();
  if(translationFlag!=='0')throw Error();
  const translation=false;
  const config = accountHttpConfig(process.env);
  const factor = factorConfigFromEnv(process.env);
  const passwordScreening = await passwordScreeningFromEnv(process.env);
  const portText = process.env.CLOUD_HTTP_PORT ?? '3000';
  if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new Error();
  const outbox = new EmailOutbox({activeKeyId: process.env.CLOUD_EMAIL_ACTIVE_KEY_ID, keys: JSON.parse(process.env.CLOUD_EMAIL_KEYS)});
  pool = new Pool({connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  pool.on('error', () => {console.error('Account server database connection failed'); process.exitCode = 1; stop();});
  if ((await pool.query('SELECT name FROM schema_migrations WHERE name = ANY($1::text[])', [migrationNames])).rowCount !== migrationNames.length) throw new Error();
  if (!stopRequested) {
    const portalAssets = process.env.CLOUD_PORTAL_ASSETS_DIR ? await loadPortalAssets(process.env.CLOUD_PORTAL_ASSETS_DIR) : undefined;
    const leaseIssuer=process.env.CLOUD_INSTALLATION_ISSUER_KEY ? createLeaseIssuer(process.env.CLOUD_INSTALLATION_ISSUER_KEY) : undefined;
    if(process.env.CLOUD_INSTALLATION_TRUSTED_KEYS&&!leaseIssuer)throw new Error();
    const leaseTrust=leaseIssuer?createLeaseTrust(leaseIssuer,process.env.CLOUD_INSTALLATION_TRUSTED_KEYS):undefined;
    captures=planMode==='test-free-paid'?await openTestCaptureRuntime({pool,mode:planMode,directory:process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack'}):undefined;
    running = await startAccountServer({planMode,staffCertificates,translation,captures:captures?.options,pool, outbox, config, factor, portalAssets, leaseIssuer, leaseTrust, passwordScreening, host: process.env.CLOUD_HTTP_HOST ?? '127.0.0.1', port: Number(portText)});
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
} catch(error) {
  console.error(error instanceof Error&&error.message==='backup.installation_issuer_required'
    ?'Account server requires CLOUD_INSTALLATION_ISSUER_KEY when backup capture is configured'
    :'Account server failed; check database, migrations and configuration'); process.exitCode = 1;
} finally {
  stop();
  try {await running?.close(); captures?.close(); await pool?.end();} catch {process.exitCode = 1;}
  clearInterval(cleanup); clearTimeout(hardDeadline);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
