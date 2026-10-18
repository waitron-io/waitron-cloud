import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isLocalStackConfig} from './bootstrap.mjs';

// Compare the selected release's complete ledger, including SQL content, before any
// packaged database consumer starts. Historical binaries need this deployment gate too.
export async function checkConsumerSchema(pool,root){
 const {migrationNames}=await import(pathToFileURL(join(root,'packages/registration/src/migrate.ts')).href);
 const rows=(await pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;
 if(rows.length!==migrationNames.length)throw new Error('schema_incompatible');
 for(const name of migrationNames){
  const digest=createHash('sha256').update(await readFile(join(root,'packages/registration/migrations',name))).digest('hex');
  if(!rows.some(row=>row.name===name&&row.digest===digest))throw new Error('schema_incompatible');
 }
}
export async function checkConsumerDatabase(databaseUrl,root){
 const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
 const pool=new Pool({connectionString:databaseUrl,connectionTimeoutMillis:5000,statement_timeout:10000});
 try{await checkConsumerSchema(pool,root);}finally{await pool.end();}
}

const commands={
 migrate:['packages/registration/src/migrate-cli.ts'],account:['packages/account-http/src/server-cli.ts'],email:['packages/registration/src/email-worker-cli.ts'],
 monitor:['packages/registration/src/monitor-cli.ts'],usage:['packages/registration/src/usage-reconcile-cli.ts','--watch'],probe:['packages/remote-access/src/probe-cli.ts'],
 backup:['packages/backups/src/worker-cli.ts'],gateway:['packages/remote-access/src/gateway-cli.ts'],manifest:['deploy/local-stack/manifest-worker.mjs'],
 reconcile:['packages/remote-access/src/reconciler-cli.ts','/run/reconciler/config.json'],translation:['packages/translation/src/worker-cli.ts']
};
function databaseUrl(config){return `postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`;}
export function runtimeEnvironment(role,config,environment={},origin='http://localhost:3000'){
 if(!['http://localhost:3000','https://waitron.local:3000'].includes(origin))throw new Error('local_stack.origin_invalid');
 const DATABASE_URL=databaseUrl(config),email={DATABASE_URL,CLOUD_EMAIL_ACTIVE_KEY_ID:config.email.activeKeyId,CLOUD_EMAIL_KEYS:JSON.stringify(config.email.keys)};
 const roles={
  migrate:{DATABASE_URL},
  account:{...email,...(environment.CLOUD_TRANSLATION!==undefined?{CLOUD_TRANSLATION:environment.CLOUD_TRANSLATION}:{}),...(config.factor?{CLOUD_FACTOR_ACTIVE_KEY_ID:config.factor.activeKeyId,CLOUD_FACTOR_KEYS:JSON.stringify(config.factor.keys)}:{}),...(environment.CLOUD_FACTOR_POLICY!==undefined?{CLOUD_FACTOR_POLICY:environment.CLOUD_FACTOR_POLICY}:{}),...(environment.CLOUD_STAFF_CERTIFICATES!==undefined?{CLOUD_STAFF_CERTIFICATES:environment.CLOUD_STAFF_CERTIFICATES}:{}),...(config.recovery?{CLOUD_RECOVERY_ACTIVE_KEY_ID:config.recovery.activeKeyId,CLOUD_RECOVERY_KEYS:JSON.stringify(config.recovery.keys)}:{}),...(config.pairing?{CLOUD_PAIRING_ACTIVE_KEY_ID:config.pairing.activeKeyId,CLOUD_PAIRING_KEYS:JSON.stringify(config.pairing.keys)}:{}),CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_RATE_KEY:config.http.rateKey,CLOUD_HTTP_HOST:'0.0.0.0',CLOUD_HTTP_PORT:'3000',CLOUD_PORTAL_ASSETS_DIR:'/app/apps/portal/dist',CLOUD_INSTALLATION_ISSUER_KEY:config.installation.issuerKey},
  email:{...email,CLOUD_PORTAL_ORIGIN:origin,MAILPIT_SMTP_PORT:'1025',CLOUD_MAIL_TRANSPORT:'local'},
  monitor:{...email,...Object.fromEntries(['CLOUD_MONITOR_QUIET_SECONDS','CLOUD_MONITOR_REMINDER_SECONDS'].filter(name=>environment[name]!==undefined).map(name=>[name,environment[name]]))},usage:{DATABASE_URL,...Object.fromEntries(['CLOUD_USAGE_INTERVAL_MS','CLOUD_USAGE_BATCH_SIZE'].filter(name=>environment[name]!==undefined).map(name=>[name,environment[name]]))},probe:{DATABASE_URL},
  backup:{DATABASE_URL,CLOUD_BACKUP_MASTER_KEY:config.backup.masterKey,CLOUD_BACKUP_ENDPOINT:config.storage.endpoint,CLOUD_BACKUP_REGION:config.storage.region,CLOUD_BACKUP_ACCESS_KEY:config.storage.accessKeyId,CLOUD_BACKUP_SECRET_KEY:config.storage.secretAccessKey,CLOUD_BACKUP_CA_FILE:'/run/local-stack/storage-ca.pem',...Object.fromEntries(['CLOUD_VERIFIER_IMAGE','CLOUD_VERIFIER_OWNER','CLOUD_VERIFIER_MEMORY_MIB','CLOUD_VERIFIER_SCRATCH_MIB'].filter(name=>environment[name]!==undefined).map(name=>[name,environment[name]]))},
  gateway:{GATEWAY_STATE_DIR:'/state',GATEWAY_MANIFEST:'/run/local-stack/gateway-manifest.json',GATEWAY_CELL_ID:config.gateway.cellId,GATEWAY_TRUST_KEY:'/run/local-stack/gateway-issuer.pem',GATEWAY_WIREGUARD_KEY:'/run/local-stack/gateway-wireguard.key',GATEWAY_BOT_KEY:'/run/local-stack/gateway-bot.key',GATEWAY_SUBNET:String(config.gateway.subnet)},
  manifest:{LOCAL_STACK_CONFIG_DIR:'/run/local-stack'},reconcile:{DATABASE_URL},
  translation:{DATABASE_URL,...Object.fromEntries(['CLOUD_OPENAI_API_KEY','CLOUD_OPENAI_BASE_URL'].filter(name=>environment[name]!==undefined).map(name=>[name,environment[name]]))}
 };
 if(!Object.hasOwn(roles,role))throw new Error('local_stack.role_invalid');return roles[role];
}
export async function loadRuntime(directory){
 const path=join(directory,'runtime.json'),info=await stat(path);if((info.mode&0o777)!==0o600)throw new Error('local_stack.configuration_permissions');
 try{const value=JSON.parse(await readFile(path,'utf8'));if(!isLocalStackConfig(value))throw Error();return value;}catch{throw new Error('local_stack.configuration_invalid');}
}
export async function launch(role,directory=process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack'){
 if(!Object.hasOwn(commands,role))throw new Error('local_stack.role_invalid');
 const config=await loadRuntime(directory),[script,...args]=commands[role];
 if(role!=='migrate'&&runtimeEnvironment(role,config).DATABASE_URL)await checkConsumerDatabase(databaseUrl(config),'/app');
 const child=spawn(process.execPath,[script,...args],{cwd:'/app',stdio:'inherit',env:{PATH:process.env.PATH,HOME:'/tmp',...runtimeEnvironment(role,config,process.env)}});
 const forward=signal=>child.kill(signal);process.once('SIGINT',forward);process.once('SIGTERM',forward);
 try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?1:0)));});}
 finally{process.removeListener('SIGINT',forward);process.removeListener('SIGTERM',forward);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await launch(process.argv[2]);}catch{console.error('Local stack process failed; check its private configuration and service prerequisites');process.exitCode=1;}
}
