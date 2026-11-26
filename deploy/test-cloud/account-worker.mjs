import {cloudActionDemoEnabled} from '../../packages/registration/src/cloud-action-worker.ts';
import {startCloudActionDemo} from './cloud-action-demo.mjs';
import {openTestCaptureRuntime} from './service-runtime.mjs';
import {openTestRelayRuntime} from './relay-runtime.mjs';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
import { EmailOutbox, createLeaseIssuer, createLeaseTrust, migrationNames, parsePlanMode, allowanceOptionsFromEnv, pruneAddressLookupCalls } from '../../packages/registration/src/index.ts';
import { accountHttpConfig, billingAccountOptionsFromEnv, passwordScreeningFromEnv, factorConfigFromEnv } from '../../packages/account-http/src/config.ts';
import { billingMethodsOptionsFromEnv } from '../../packages/account-http/src/billing-methods.ts';
import { AccountRateLimiter } from '../../packages/account-http/src/rate-limit.ts';
import { addressLookupOptionsFromEnv } from '../../packages/account-http/src/address-lookup.ts';
import { loadPortalAssets } from '../../packages/account-http/src/portal.ts';
import { startAccountServer } from '../../packages/account-http/src/server.ts';
import { startGuestMenuServer } from '../../packages/account-http/src/guest-menu-server.ts';
import { startGuestMenuAuthority } from '../../packages/remote-access/src/guest-menu.ts';
let captures;let actionDemo;
let pool;
let running;
let guest;
let guestAuthority;
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
  const actionDemoEnabled=cloudActionDemoEnabled(process.env);
  const operatorVenues=actionDemoEnabled&&process.env.TEST_CLOUD_AMAZON!=='1';
  const planMode=parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS);
  const billingAccount=billingAccountOptionsFromEnv(process.env,planMode);
  const cellId=process.env.TEST_CLOUD_TUNNEL_CELL_ID;
  const tunnelProvision=cellId===undefined?undefined:{mode:'automatic',cellId};
  const allowances=allowanceOptionsFromEnv(process.env,planMode);
  const staffFlag=process.env.CLOUD_STAFF_CERTIFICATES??'0';if(!['0','1'].includes(staffFlag))throw new Error();
  const staffCertificates=staffFlag==='1';
  const translationFlag=process.env.CLOUD_TRANSLATION??'0';if(!['0','1'].includes(translationFlag))throw new Error();
  if(translationFlag!=='0')throw Error();
  const translation=false;
  const config = accountHttpConfig(process.env);
  const directory=process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack';
  const guestOrigin=process.env.GUEST_ORIGIN,liveGuestMenu=process.env.TEST_CLOUD_LIVE_GUEST_MENU==='1';
  if((guestOrigin||liveGuestMenu)&&(planMode!=='test-venue-levels'||config.production))throw new Error();
  const billingMethods=billingMethodsOptionsFromEnv(process.env,planMode,billingAccount,config.portalOrigin);
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
    const uploadOrigin=process.env.CLOUD_TEST_AMAZON_BACKUPS==='1'?config.portalOrigin:undefined;
    if(uploadOrigin!==undefined&&(planMode!=='test-venue-levels'||process.env.NODE_ENV==='production'))throw Error('test_cloud.amazon_backups');
    captures=planMode!=='existing'?await openTestCaptureRuntime({pool,mode:planMode,stageRoot:process.env.CLOUD_BACKUP_STAGE_ROOT,directory,uploadOrigin}):undefined;
    let relay;
    try{relay=await openTestRelayRuntime({pool,directory,issuer:leaseIssuer,origin:config.portalOrigin,mode:planMode,
      setupExpiresAt:process.env.CLOUD_TEST_RELAY_SETUP_EXPIRES_AT || undefined});}
    catch(error){
      if(error?.message==='test_cloud.relay_setup_expiry')
        console.error('Test relay startup refused: use a UTC timestamp with milliseconds for CLOUD_TEST_RELAY_SETUP_EXPIRES_AT');
      else console.error('Test relay startup failed; restore private keys and check schema');
    }
    if(guestOrigin&&!stopRequested){
      const key=await readFile(join(directory,'lan/key.pem')),cert=await readFile(join(directory,'lan/cert.pem'));
      guest=await startGuestMenuServer({pool,rateKey:config.rateKey,origin:guestOrigin,tls:{key,cert},planMode,
        host:process.env.GUEST_HTTP_HOST??'10.79.0.3',port:Number(process.env.GUEST_HTTP_PORT??3443),
        trustedProxyIps:['10.79.0.2']});
    }
    if(liveGuestMenu&&!stopRequested){
      const ephemeral=Number(portText)===0;
      guestAuthority=await startGuestMenuAuthority({connectionString:process.env.DATABASE_URL},ephemeral?'127.0.0.1':'10.79.0.3',ephemeral?0:3445);
    }
    const addressLookup=addressLookupOptionsFromEnv(process.env);
    running = await startAccountServer({guestOrigin,liveGuestMenu,venueMailDnsSuffix:process.env.CLOUD_VENUE_MAIL_DNS_SUFFIX||undefined,operatorAccountId:actionDemoEnabled?process.env.CLOUD_OPERATOR_ACCOUNT_ID:undefined,operatorVenues,planMode,allowances,staffCertificates,translation,billingAccount,billingMethods,addressLookup,tunnelProvision,captures:captures?.options,relay:relay?.admission,pool, outbox, config, factor, portalAssets, leaseIssuer, leaseTrust, passwordScreening, host: process.env.CLOUD_HTTP_HOST ?? '127.0.0.1', port: Number(portText)});
    if(actionDemoEnabled)actionDemo=await startCloudActionDemo({pool,outbox,operatorAccountId:process.env.CLOUD_OPERATOR_ACCOUNT_ID,directory:process.env.CLOUD_ACTION_DEMO_DIR??'/run/cloud-action-demo',environment:process.env});
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error();
    const guestAddress=guest?.server.address();
    console.log(JSON.stringify({status:'listening',port:address.port,...(guestAuthority?{guestAuthorityPort:guestAuthority.port}:{}),...(guestAddress&&typeof guestAddress!=='string'?{guestPort:guestAddress.port}:{})}));
    const limiter = new AccountRateLimiter(pool, config.rateKey); let pruning = false;
    cleanup = setInterval(async () => {
      if (pruning || stopRequested) return;
      pruning = true;
      try {
        await Promise.all([
          limiter.prune().catch(()=>console.error('Account server rate cleanup failed')),
          pruneAddressLookupCalls(pool).catch(()=>console.error('Address lookup cleanup failed')),
        ]);
      }
      finally {pruning = false;}
    }, 60000); cleanup.unref();
    await stopped;
  }
} catch(error) {
  const code=error instanceof Error?error.message:'';
  if(code.startsWith('billing_methods.'))console.error('Account server refused test payment configuration');
  else if(code==='backup.installation_issuer_required')console.error('Account server requires CLOUD_INSTALLATION_ISSUER_KEY when backup capture is configured');
  else console.error('Account server failed; check database, migrations and configuration');
  process.exitCode = 1;
} finally {
  stop();
  try {await guestAuthority?.close();} catch {process.exitCode = 1;}
  try {await guest?.close();} catch {process.exitCode = 1;}
  try {await actionDemo?.close();await running?.close();} catch {process.exitCode = 1;}
  try {captures?.close();await pool?.end();} catch {process.exitCode = 1;}
  clearInterval(cleanup); clearTimeout(hardDeadline);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
