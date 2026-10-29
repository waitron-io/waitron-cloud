import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createPrivateKey,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {source,seed,digest,identity,ledger,completionRetry,upgradeRevisions,seedAccountState,accountState,factorState,enrolFactor,restoredFactor} from './schema-upgrade-fixture.mjs';
import {storedRows,relayState,identityAccountState,seedRelay,stoppedRelay,restoredRelay} from './schema-upgrade-relay-fixture.mjs';
import {seedMonitoring,monitoringState,legacyMonitoring,restoredMonitoring} from './schema-upgrade-monitoring-fixture.mjs';
import {seedBackupMonitoring,seedLegacyBackups,upgradedBackups,freshBackupEvidence,backupState,restoredBackups} from './schema-upgrade-backup-fixture.mjs';
import {seedBilling,billingState,restoredBilling,emptyBilling} from './schema-upgrade-billing-fixture.mjs';
import {privateObservationDumpArgs} from './database-backup-policy.mjs';
import {verifySchemaUpgradeReceipt} from './verify-schema-upgrade-receipt.mjs';

const driver=resolve(fileURLToPath(new URL('..',import.meta.url)));
const {oldHead,newHead,factor,relayStop=false,monitoringQuiet=false,backupVerification=false,billing=false}=upgradeRevisions(process.argv.slice(3));
const output=resolve(process.argv[2]??'/tmp/cloud-schema-upgrade-receipt.json');

const {Pool}=createRequire(new URL('../packages/registration/package.json',import.meta.url))('pg');
const root=await mkdtemp(join(tmpdir(),'cloud-schema-upgrade-')),old=join(root,'old'),next=join(root,'new');
const id=randomUUID().slice(0,8),containers=[`cloud-upgrade-${id}`,`cloud-recovery-${id}`,`cloud-upgrade-mail-${id}`];
if(factor||relayStop||monitoringQuiet||backupVerification||billing)containers.push(`cloud-factor-recovery-${id}`);
const factorKeys={activeKeyId:'factor-v1',keys:{'factor-v1':randomBytes(32).toString('hex')}};
const password=randomBytes(24).toString('hex'),email={activeKeyId:'upgrade-v1',keys:{'upgrade-v1':randomBytes(32).toString('hex')}};
const pairing={activeKeyId:'pairing-v1',keys:{'pairing-v1':randomBytes(32).toString('hex')}};
const rateKey=randomBytes(32).toString('hex'),issuer=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url');
const handles=new Set(),pools=[],checks={},timings={},volumes=[];
let receipt,failure,phase='checkouts';
function run(command,args,options={}){
 try{return execFileSync(command,args,{cwd:driver,encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe'],...options});}
 catch{throw new Error(`schema upgrade command failed: ${command} (arguments and output withheld)`);}
}
const docker=(...args)=>run('docker',args).trim();
const git=(...args)=>run('git',args).trim();
function child(root,args,env){
 const processHandle=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 const handle={child:processHandle,stdout:'',stderr:'',done:false};handles.add(handle);
 processHandle.stdout.on('data',bytes=>handle.stdout+=bytes);processHandle.stderr.on('data',bytes=>handle.stderr+=bytes);
 handle.exit=new Promise((resolve,reject)=>{processHandle.once('error',reject);processHandle.once('exit',(code,signal)=>{handle.done=true;handle.code=code;handle.signal=signal;resolve(code);});});
 return handle;
}
async function stop(handle){
 if(!handle||handle.done)return;
 handle.child.kill('SIGTERM');
 const timer=setTimeout(()=>handle.child.kill('SIGKILL'),12000);
 try{await handle.exit;}finally{clearTimeout(timer);}
}
async function until(check,label,timeout=30000){
 const end=Date.now()+timeout;
 while(Date.now()<end){const value=await check();if(value)return value;await delay(100);}
 throw Error(`schema upgrade timed out: ${label}`);
}
const environment=url=>({DATABASE_URL:url,CLOUD_EMAIL_ACTIVE_KEY_ID:email.activeKeyId,CLOUD_EMAIL_KEYS:JSON.stringify(email.keys),CLOUD_PAIRING_ACTIVE_KEY_ID:pairing.activeKeyId,CLOUD_PAIRING_KEYS:JSON.stringify(pairing.keys),CLOUD_HTTP_RATE_KEY:rateKey,CLOUD_INSTALLATION_ISSUER_KEY:issuer,CLOUD_PORTAL_ORIGIN:'http://127.0.0.1:3000',CLOUD_HTTP_HOST:'127.0.0.1',CLOUD_HTTP_PORT:'0',NODE_ENV:'test'});
function node(root,args,env){return run(process.execPath,args,{cwd:root,env:{...process.env,...env}}).trim();}
async function database(name){
 docker('run','-d','--name',name,'-p','127.0.0.1::5432','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=cloud','postgres:18-alpine');
 for(const mount of JSON.parse(docker('inspect',name))[0].Mounts)if(mount.Type==='volume')volumes.push(mount.Name);
 const port=docker('port',name,'5432/tcp').split(':').at(-1),url=`postgres://postgres:${password}@127.0.0.1:${port}/cloud`;
 const pool=new Pool({connectionString:url,connectionTimeoutMillis:1000,statement_timeout:10000});pools.push(pool);
 await until(async()=>{try{return(await pool.query('SELECT 1')).rowCount===1;}catch{return false;}},'postgres');
 return{url,pool};
}
const gate=join(driver,'deploy/local-stack/schema-consumer.mjs');
function accountRequest(url,options={}){
 return new Promise((resolve,reject)=>{
  const request=httpRequest(url,{method:options.method??'GET',headers:{...options.headers,host:'127.0.0.1:3000'},timeout:10000},response=>{
   const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode})));response.on('error',reject);
  });
  request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('account request timed out')));request.end(options.body);
 });
}
async function startAccount(root,url,refused=false){
 const handle=child(root,[gate,'packages/account-http/src/server-cli.ts'],environment(url));
 if(refused){
  await until(()=>handle.done,'refused consumer');
  assert.equal(handle.code,1);assert.equal(handle.stdout.includes('listening'),false);
  assert.match(handle.stderr,/Consumer refused: schema_incompatible/);
  return true;
 }
 const port=await until(()=>{assert.equal(handle.done,false,'account unexpectedly exited');const line=handle.stdout.split('\n').find(line=>line.startsWith('{'));return line&&JSON.parse(line).port;},'account listening');
 const response=await accountRequest(`http://127.0.0.1:${port}/api/health/ready`,{headers:{host:'127.0.0.1:3000'}});assert.equal(response.status,200);
 return{handle,port};
}
async function tenantRequests(root,account,state){
 const {encodeMachine}=await source(root,'packages/registration/src/index.ts');
 async function request(installation,action,operationId,lease=''){
  const bytes=encodeMachine({origin:'http://127.0.0.1:3000',action,installationId:installation.installationId,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:'{}'});
  const privateKey=createPrivateKey({key:Buffer.from(installation.privateKey,'base64url'),format:'der',type:'pkcs8'});
  return accountRequest(`http://127.0.0.1:${account.port}/api/installations/${action}`,{method:'POST',headers:{host:'127.0.0.1:3000','content-type':'application/json'},body:JSON.stringify({payload:bytes.toString('base64url'),signature:sign(null,bytes,privateKey).toString('base64url')}),signal:AbortSignal.timeout(10000)});
 }
 for(const installation of state.installations){
  const operationId=installation.retryId??=randomUUID();
  let response=await request(installation,'renew',operationId);assert.equal(response.status,200);const result=await response.json();
  if(installation.retryDigest)assert.equal(digest(result),installation.retryDigest);else installation.retryDigest=digest(result);
  response=await request(installation,'configuration',randomUUID(),result.lease);assert.equal(response.status,200);assert.equal((await response.json()).installationId,installation.installationId);
 }
 const cross={...state.installations[0],installationId:state.installations[1].installationId};
 assert.equal((await request(cross,'renew',randomUUID())).status,401);
 return true;
}
try{
 await rm(output,{force:true});
 console.log(JSON.stringify({phase:'checkouts',oldHead,newHead}));
 for(const [path,head] of [[old,oldHead],[next,newHead]]){
  run('git',['clone','--quiet','--no-hardlinks','--no-checkout',driver,path]);run('git',['checkout','--quiet','--detach',head],{cwd:path});
  run('pnpm',['install','--frozen-lockfile'],{cwd:path,timeout:180000});
 }
 phase='databases';console.log(JSON.stringify({phase}));
 const primary=await database(containers[0]);
 docker('run','-d','--name',containers[2],'-p','127.0.0.1::1025','-p','127.0.0.1::8025','axllent/mailpit:v1.31.1');
 for(const mount of JSON.parse(docker('inspect',containers[2]))[0].Mounts)if(mount.Type==='volume')volumes.push(mount.Name);
 const smtp=docker('port',containers[2],'1025/tcp').split(':').at(-1),mailPort=docker('port',containers[2],'8025/tcp').split(':').at(-1);
 await until(async()=>{try{return(await fetch(`http://127.0.0.1:${mailPort}/api/v1/messages`)).ok;}catch{return false;}},'mailpit');
 node(old,['packages/registration/src/migrate-cli.ts'],environment(primary.url));
 const state=await seed(old,primary.pool,email,(factor||relayStop||monitoringQuiet||backupVerification||billing)?pairing:undefined);
 if(factor||relayStop||monitoringQuiet||backupVerification||billing)await seedAccountState(old,primary.pool,state);
 let relayProof,relayAccounts,monitoringProof,monitoringBackup,monitoringBefore,backupProof,backupBefore,backupAfter,backupDump;
 const backupChecks={},billingChecks={};
 let billingProof,billingBefore,billingDump;
 if(relayStop||monitoringQuiet||backupVerification||billing){await enrolFactor(old,primary.pool,state,factorKeys);relayProof=await seedRelay(old,primary.pool,state,issuer);relayAccounts=await identityAccountState(primary.pool);}
 if(monitoringQuiet)await seedMonitoring(old,primary.pool,state,email);
 if(backupVerification||billing)await seedBackupMonitoring(old,primary.pool,email);
 if(backupVerification||billing){backupProof=await seedLegacyBackups(old,primary.pool,state);backupBefore=await backupState(primary.pool);monitoringBefore=await monitoringState(primary.pool);}
 const beforeAccounts=factor?await accountState(primary.pool):null,beforeIdentity=await identity(primary.pool),oldLedger=await ledger(primary.pool);
 assert.equal(oldLedger.length,billing?44:backupVerification?42:monitoringQuiet?36:relayStop?35:factor?34:26);
 const oldAccount=await startAccount(old,primary.url);checks.oldStarted=true;
 await tenantRequests(old,oldAccount,state);await stop(oldAccount.handle);
 // Freeze the recovery point with no running consumers; keys stay outside pg_dump.
 const fullOldLedger=(relayStop||monitoringQuiet||backupVerification||billing)?(await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows:null;
 const beforeRows=(relayStop||monitoringQuiet||backupVerification||billing)?await storedRows(primary.pool,monitoringQuiet||backupVerification||billing):null,beforeRelay=(relayStop||monitoringQuiet||backupVerification||billing)?await relayState(primary.pool):null;
 const backup=run('docker',['exec',containers[0],'pg_dump','-U','postgres','-d','cloud','-Fc',...privateObservationDumpArgs],{encoding:null});
 const pendingBefore=(await primary.pool.query('SELECT * FROM email_outbox WHERE id=$1',[state.messageId])).rows[0];
 checks.newRefusedOld=await startAccount(next,primary.url,true);
 phase='upgrade';console.log(JSON.stringify({phase}));
 const upgradeStart=Date.now(),lock=await primary.pool.connect();
 try{
  await lock.query('BEGIN');const blocker=(await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await lock.query((relayStop||monitoringQuiet||backupVerification||billing)?'LOCK TABLE schema_migrations IN SHARE MODE':factor?'LOCK TABLE cloud_sessions IN ACCESS SHARE MODE':'LOCK TABLE pairing_requests IN ACCESS SHARE MODE');
  const migration=child(next,['packages/registration/src/migrate-cli.ts'],{...environment(primary.url),PGAPPNAME:`upgrade-${id}`});
  const blocked=await until(async()=>{const result=await primary.pool.query("SELECT pid,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[`upgrade-${id}`]);const row=result.rows[0];return row&&row.blockers.includes(blocker)&&(!(relayStop||monitoringQuiet||backupVerification||billing)||row.query.startsWith('INSERT INTO schema_migrations'))?row:false;},'migration blocked on schema lock');
  await primary.pool.query('SELECT pg_terminate_backend($1)',[blocked.pid]);
  await until(()=>migration.done,'interrupted migration exit');assert.notEqual(migration.code,0);checks.migrationInterrupted=true;
 }finally{await lock.query('ROLLBACK');lock.release();}
 assert.deepEqual(await ledger(primary.pool),oldLedger);
 if(relayStop||monitoringQuiet||backupVerification||billing)assert.deepEqual((await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,fullOldLedger);
 if(billing){
  assert.equal((await primary.pool.query("SELECT to_regclass('billing_businesses') AS table_name")).rows[0].table_name,null);
  assert.deepEqual(await storedRows(primary.pool,true),beforeRows);
 }else if(backupVerification){
  assert.equal((await primary.pool.query("SELECT to_regclass('backup_verification_attempts') AS table_name")).rows[0].table_name,null);
  assert.deepEqual(await storedRows(primary.pool,true),beforeRows);
 }else if(monitoringQuiet){
  assert.equal((await primary.pool.query("SELECT to_regclass('venue_alert_episodes') AS table_name")).rows[0].table_name,null);
  assert.deepEqual(await storedRows(primary.pool,true),beforeRows);
 }else if(relayStop){
  assert.equal((await primary.pool.query("SELECT to_regclass('relay_control') AS table_name")).rows[0].table_name,null);
  assert.deepEqual(await storedRows(primary.pool),beforeRows);
 }else{
 const constraint=(await primary.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='pairing_requests_code_hash_check'")).rows[0].definition;
 assert.equal(constraint.includes('v1:'),factor);
 if(factor)assert.equal((await primary.pool.query("SELECT to_regclass('cloud_authenticator_factors') AS table_name")).rows[0].table_name,null);
 }
 checks.rollbackComplete=true;
 checks.newRefusedInterrupted=await startAccount(next,primary.url,true);
 node(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url));
 node(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url));
 const newLedger=await ledger(primary.pool);assert.equal(newLedger.length,billing?45:backupVerification?43:monitoringQuiet?37:relayStop?36:factor?35:27);checks.retryApplied=true;
 if(billing){
  assert.deepEqual(newLedger.slice(0,44),oldLedger);
  assert.deepEqual((await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,44),fullOldLedger);
  for(const row of oldLedger)assert.deepEqual(await readFile(join(next,'packages/registration/migrations',row.name)),await readFile(join(old,'packages/registration/migrations',row.name)),row.name);
  billingChecks.oldSqlUnchanged=true;
  const currentRows=await storedRows(primary.pool,true);
  for(const name of Object.keys(beforeRows))assert.deepEqual(currentRows[name],beforeRows[name],name+' preserved by billing migration');
  billingChecks.oldRowsPreserved=true;billingChecks.emptyBillingAfterUpgrade=await emptyBilling(primary.pool);
  assert.deepEqual(await relayState(primary.pool),beforeRelay);checks.relayStatePreserved=true;
  assert.deepEqual(await identityAccountState(primary.pool),relayAccounts);checks.accountStatePreserved=true;
  assert.deepEqual(await monitoringState(primary.pool),monitoringBefore);checks.monitoringStatePreserved=true;
  const allBefore=await storedRows(primary.pool,true);
  const parallel=[child(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url)),child(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url))];
  for(const migration of parallel)assert.equal(await migration.exit,0);
  assert.deepEqual(await storedRows(primary.pool,true),allBefore);
  assert.deepEqual((await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,44),fullOldLedger);billingChecks.restartIdempotent=true;
 }
 if(backupVerification){
  assert.deepEqual(newLedger.slice(0,42),oldLedger);
  assert.deepEqual((await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,42),fullOldLedger);
  backupChecks.oldSqlUnchanged=true;
  Object.assign(backupChecks,await upgradedBackups(next,primary.pool,state,backupProof));
  assert.deepEqual(await relayState(primary.pool),beforeRelay);checks.relayStatePreserved=true;
  assert.deepEqual(await identityAccountState(primary.pool),relayAccounts);checks.accountStatePreserved=true;
  assert.deepEqual(await monitoringState(primary.pool),monitoringBefore);checks.monitoringStatePreserved=true;
  const allBefore=await storedRows(primary.pool,true);
  const parallel=[child(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url)),child(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url))];
  for(const migration of parallel)assert.equal(await migration.exit,0);
  assert.deepEqual(await storedRows(primary.pool,true),allBefore);backupChecks.restartIdempotent=true;
 }
 if(monitoringQuiet){
  assert.deepEqual(newLedger.slice(0,36),oldLedger);assert.deepEqual((await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,36),fullOldLedger);
  const currentRows=await storedRows(primary.pool,true);
  for(const name of Object.keys(beforeRows)){
   if(name==='service_alert_deliveries')for(const row of currentRows[name]){delete row.value.episode_id;delete row.value.notification;}
   assert.deepEqual(currentRows[name],beforeRows[name],name+' preserved by migration');
  }
  assert.deepEqual(await relayState(primary.pool),beforeRelay);checks.relayStatePreserved=true;
  assert.deepEqual(await identityAccountState(primary.pool),relayAccounts);checks.accountStatePreserved=true;
  const parallel=[child(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url)),child(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url))];
  for(const migration of parallel)assert.equal(await migration.exit,0);
  assert.deepEqual((await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,36),fullOldLedger);
  await primary.pool.query("INSERT INTO schema_migrations(name,digest) VALUES('038_fixture_future.sql',$1)",['0'.repeat(64)]);
  try{await startAccount(next,primary.url,true);}finally{await primary.pool.query("DELETE FROM schema_migrations WHERE name='038_fixture_future.sql'");}
 }
 if(relayStop){
  assert.deepEqual(newLedger.slice(0,35),oldLedger);
  assert.deepEqual((await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,35),fullOldLedger);
  assert.deepEqual(await storedRows(primary.pool),beforeRows);
  assert.deepEqual(await relayState(primary.pool),beforeRelay);checks.relayStatePreserved=true;
  assert.deepEqual(await identityAccountState(primary.pool),relayAccounts);checks.accountStatePreserved=true;
  assert.deepEqual(JSON.parse(node(next,['packages/registration/src/relay-control-cli.ts','--status'],environment(primary.url))),{stopped:false});checks.defaultRunning=true;
 }
 if(!factor&&!relayStop&&!monitoringQuiet&&!backupVerification&&!billing){
 assert.equal(JSON.parse(node(next,['packages/registration/src/pairing-codes-cli.ts','--once'],environment(primary.url))).upgraded,1);
 assert.equal(JSON.parse(node(next,['packages/registration/src/pairing-codes-cli.ts','--once'],environment(primary.url))).upgraded,0);
 const {PairingStore}=await source(next,'packages/registration/src/pairing.ts');
 assert.equal((await new PairingStore(primary.pool,pairing).start(state.pending)).state,'awaiting_cloud');checks.pairingUpgraded=true;
 }else if(factor){assert.deepEqual(await accountState(primary.pool),beforeAccounts);checks.accountStatePreserved=true;}
 checks.oldRefusedNew=await startAccount(old,primary.url,true);
 if(backupVerification)backupChecks.oldBinaryRefused=checks.oldRefusedNew;
 const newAccount=await startAccount(next,primary.url);checks.newStarted=true;
 assert.deepEqual(await identity(primary.pool),beforeIdentity);checks.identityPreserved=true;
 checks.tenantsIsolated=await tenantRequests(next,newAccount,state);
 checks.completionRetry=await completionRetry(next,primary.pool,state);
 assert.deepEqual((await primary.pool.query('SELECT * FROM email_outbox WHERE id=$1',[state.messageId])).rows[0],pendingBefore);checks.pendingMailPreserved=true;
 const mailEnv={...environment(primary.url),CLOUD_MAIL_TRANSPORT:'local',MAILPIT_SMTP_PORT:smtp};
 node(next,[gate,'packages/registration/src/email-worker-cli.ts','--once'],mailEnv);
 node(next,[gate,'packages/registration/src/email-worker-cli.ts','--once'],mailEnv);
 assert.equal((await primary.pool.query('SELECT status FROM email_outbox WHERE id=$1',[state.messageId])).rows[0].status,'sent');
 assert.equal((await(await fetch(`http://127.0.0.1:${mailPort}/api/v1/messages`)).json()).total,1);checks.mailDelivered=true;
 await stop(newAccount.handle);
 if(monitoringQuiet)checks.legacyNoRetroactiveMail=await legacyMonitoring(next,primary.pool,email);
 let factorProof,factorBackup,factorBefore,stoppedBackup,stoppedRows,fullNewLedger;
 if(relayStop){
  const command=mode=>JSON.parse(node(next,['packages/registration/src/relay-control-cli.ts',mode],environment(primary.url)));
  assert.deepEqual(command('--stop'),{stopped:true});
  const restarted=await startAccount(next,primary.url);await stop(restarted.handle);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(primary.url));
  assert.deepEqual(command('--status'),{stopped:true});
  await stoppedRelay(next,primary.pool,relayProof,Number(smtp));checks.stopRestartPreserved=true;
  stoppedRows=await storedRows(primary.pool,true);fullNewLedger=(await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  stoppedBackup=run('docker',['exec',containers[0],'pg_dump','-U','postgres','-d','cloud','-Fc',...privateObservationDumpArgs],{encoding:null});
 }
 if(factor){
  factorProof=await enrolFactor(next,primary.pool,state,factorKeys);checks.factorEnrolled=true;factorBefore=await factorState(primary.pool);
  factorBackup=run('docker',['exec',containers[0],'pg_dump','-U','postgres','-d','cloud','-Fc',...privateObservationDumpArgs],{encoding:null});
 }
 if(backupVerification){
  Object.assign(backupChecks,await freshBackupEvidence(next,primary.pool,state,backupProof));
  backupAfter=await backupState(primary.pool);
  backupDump=run('docker',['exec',containers[0],'pg_dump','-U','postgres','-d','cloud','-Fc',...privateObservationDumpArgs],{encoding:null});
 }
 if(billing){
  billingProof=await seedBilling(next,primary.pool,state);billingBefore=await billingState(primary.pool);
  await restoredBilling(next,primary.pool,billingProof,billingBefore);
  for(const name of ['billingRowsPreserved','pricesFrozen','eventRetryStable','eventCollisionRefused','foreignScopeRefused'])billingChecks[name]=true;
  billingDump=run('docker',['exec',containers[0],'pg_dump','-U','postgres','-d','cloud','-Fc',...privateObservationDumpArgs],{encoding:null});
 }
 timings.upgradeMs=Date.now()-upgradeStart;
 if(monitoringQuiet){email.smtpPort=Number(smtp);monitoringProof=await seedMonitoring(next,primary.pool,state,email);monitoringBefore=await monitoringState(primary.pool);monitoringBackup=run('docker',['exec',containers[0],'pg_dump','-U','postgres','-d','cloud','-Fc',...privateObservationDumpArgs],{encoding:null});}
 const upgradedMonitoringDigest=monitoringQuiet?digest(await storedRows(primary.pool,true)):null;
 const upgradedRelayDigest=relayStop?digest({ledger:(await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,rows:await storedRows(primary.pool,true)}):null;
 const upgradedDigest=digest({ledger:await ledger(primary.pool),identity:await identity(primary.pool),mail:(await primary.pool.query('SELECT * FROM email_outbox ORDER BY id')).rows,pairing:(await primary.pool.query('SELECT * FROM pairing_requests ORDER BY id')).rows});
 phase='restore';console.log(JSON.stringify({phase}));
 const recoveryStart=Date.now(),recovered=await database(containers[1]);
 run('docker',['exec','-i',containers[1],'pg_restore','-U','postgres','-d','cloud','--exit-on-error'],{input:backup,encoding:null});
 assert.deepEqual(await ledger(recovered.pool),oldLedger);assert.deepEqual(await identity(recovered.pool),beforeIdentity);checks.backupRestored=true;
 const {EmailOutbox}=await source(old,'packages/registration/src/index.ts');
 const restoredMail=(await recovered.pool.query('SELECT * FROM email_outbox WHERE id=$1',[state.messageId])).rows[0];
 assert.deepEqual(restoredMail,pendingBefore);
 assert.throws(()=>new EmailOutbox({activeKeyId:email.activeKeyId,keys:{[email.activeKeyId]:randomBytes(32).toString('hex')}}).open(restoredMail));
 assert.equal(new EmailOutbox(email).open(restoredMail).email,'upgrade-one@example.test');checks.wrongKeyRefused=true;
 const recoveredAccount=await startAccount(old,recovered.url);
 await tenantRequests(old,recoveredAccount,state);await completionRetry(old,recovered.pool,state);
 const oldPairing=await source(old,'packages/registration/src/pairing.ts');assert.equal((await new oldPairing.PairingStore(recovered.pool,(factor||relayStop||monitoringQuiet||backupVerification||billing)?pairing:undefined).start(state.pending)).state,'awaiting_cloud');
 node(old,[gate,'packages/registration/src/email-worker-cli.ts','--once'],{...mailEnv,DATABASE_URL:recovered.url});
 assert.equal((await recovered.pool.query('SELECT status FROM email_outbox WHERE id=$1',[state.messageId])).rows[0].status,'sent');
 checks.oldRecovered=true;await stop(recoveredAccount.handle);
 if(billing){
  assert.deepEqual(await backupState(recovered.pool),backupBefore);
  assert.deepEqual(await identityAccountState(recovered.pool),relayAccounts);
  assert.deepEqual(await relayState(recovered.pool),beforeRelay);assert.deepEqual(await monitoringState(recovered.pool),monitoringBefore);
  const recoveredKey=(await recovered.pool.query('SELECT sealed FROM backup_key_versions WHERE venue_id=$1',[backupProof.venueId])).rows[0];
  assert.deepEqual(backupProof.vault.open(backupProof.venueId,1,recoveredKey.sealed),backupProof.keys);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(recovered.url));billingChecks.oldBackupUpgradeEmpty=await emptyBilling(recovered.pool);
  const restored=await database(containers[3]);run('docker',['exec','-i',containers[3],'pg_restore','-U','postgres','-d','cloud','--exit-on-error'],{input:billingDump,encoding:null});
  assert.deepEqual(await ledger(restored.pool),newLedger);
  await restoredBilling(next,restored.pool,billingProof,billingBefore);
  billingChecks.newBackupRestored=true;
  for(const name of ['restoredPayments','restoredTrials','restoredHostedDays','restoredEvents','restoredPrices','restoredRetryStable'])billingChecks[name]=true;
  const beforeRestart=await storedRows(restored.pool,true);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(restored.url));
  assert.deepEqual(await storedRows(restored.pool,true),beforeRestart);
  const restarted=await startAccount(next,restored.url);await stop(restarted.handle);
  await restoredBilling(next,restored.pool,billingProof,billingBefore);
  assert.deepEqual(await billingState(primary.pool),billingBefore);
  assert.deepEqual(await backupState(primary.pool),backupBefore);
 }
 if(backupVerification){
  assert.deepEqual(await backupState(recovered.pool),backupBefore);
  assert.deepEqual(await identityAccountState(recovered.pool),relayAccounts);
  assert.deepEqual(await relayState(recovered.pool),beforeRelay);assert.deepEqual(await monitoringState(recovered.pool),monitoringBefore);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(recovered.url));
  await upgradedBackups(next,recovered.pool,state,backupProof);
  const restored=await database(containers[3]);run('docker',['exec','-i',containers[3],'pg_restore','-U','postgres','-d','cloud','--exit-on-error'],{input:backupDump,encoding:null});
  assert.deepEqual(await ledger(restored.pool),newLedger);
  Object.assign(backupChecks,await restoredBackups(next,restored.pool,backupProof,backupAfter));
  const beforeRestart=await storedRows(restored.pool,true);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(restored.url));
  assert.deepEqual(await storedRows(restored.pool,true),beforeRestart);
  const restarted=await startAccount(next,restored.url);await stop(restarted.handle);
  await restoredBackups(next,restored.pool,backupProof,backupAfter);
  assert.deepEqual(await backupState(primary.pool),backupAfter);
 }

 if(monitoringQuiet){
  assert.deepEqual(await relayState(recovered.pool),beforeRelay);assert.deepEqual(await identityAccountState(recovered.pool),relayAccounts);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(recovered.url));checks.oldBackupUpgradeNoRetroactiveMail=await legacyMonitoring(next,recovered.pool,email);
  const restored=await database(containers[3]);run('docker',['exec','-i',containers[3],'pg_restore','-U','postgres','-d','cloud','--exit-on-error'],{input:monitoringBackup,encoding:null});
  assert.deepEqual(await ledger(restored.pool),newLedger);assert.equal(digest(await monitoringState(restored.pool)),digest(monitoringBefore));checks.newBackupRestored=true;
  assert.deepEqual(await relayState(restored.pool),beforeRelay);assert.deepEqual(await identityAccountState(restored.pool),relayAccounts);
  const restarted=await startAccount(next,restored.url);await stop(restarted.handle);
  Object.assign(checks,await restoredMonitoring(next,restored.pool,monitoringProof,email));
  assert.equal(digest(await monitoringState(primary.pool)),digest(monitoringBefore));
 }
 if(relayStop){
  assert.deepEqual(await relayState(recovered.pool),beforeRelay);
  assert.deepEqual((await recovered.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,fullOldLedger);
  assert.deepEqual(await identityAccountState(recovered.pool),relayAccounts);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(recovered.url));
  assert.deepEqual((await ledger(recovered.pool)).slice(0,35),oldLedger);
  assert.deepEqual(await relayState(recovered.pool),beforeRelay);
  assert.deepEqual(await identityAccountState(recovered.pool),relayAccounts);
  assert.deepEqual(JSON.parse(node(next,['packages/registration/src/relay-control-cli.ts','--status'],environment(recovered.url))),{stopped:false});checks.oldBackupUpgradeDefault=true;
  const restored=await database(containers[3]);
  run('docker',['exec','-i',containers[3],'pg_restore','-U','postgres','-d','cloud','--exit-on-error'],{input:stoppedBackup,encoding:null});
  assert.deepEqual(await ledger(restored.pool),newLedger);assert.deepEqual((await restored.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,fullNewLedger);assert.deepEqual(await storedRows(restored.pool,true),stoppedRows);
  node(next,['packages/registration/src/migrate-cli.ts'],environment(restored.url));
  assert.deepEqual(await storedRows(restored.pool,true),stoppedRows);
  const restarted=await startAccount(next,restored.url);await stop(restarted.handle);
  assert.deepEqual(JSON.parse(node(next,['packages/registration/src/relay-control-cli.ts','--status'],environment(restored.url))),{stopped:true});
  checks.stopRestorePreserved=true;
  await stoppedRelay(next,restored.pool,relayProof,Number(smtp));checks.restoredStopEffective=true;
  await restoredRelay(next,restored.pool,relayProof,Number(smtp),async()=>{assert.deepEqual(JSON.parse(node(next,['packages/registration/src/relay-control-cli.ts','--resume'],environment(restored.url))),{stopped:false});});
  for(const name of ['restoredRelayKeys','restoredRelayWrongKeysRefused','restoredRelayMissingKeysRefused','resumeEffective'])checks[name]=true;
 }
 if(factor){
  assert.deepEqual(await accountState(recovered.pool),beforeAccounts);
  const restored=await database(containers[3]);
  run('docker',['exec','-i',containers[3],'pg_restore','-U','postgres','-d','cloud','--exit-on-error'],{input:factorBackup,encoding:null});
  assert.deepEqual(await factorState(restored.pool),factorBefore);checks.factorRestored=true;
  await restoredFactor(next,restored.pool,factorProof,factorKeys);
  for(const name of ['factorMatchingKey','factorWrongKeyRefused','factorMissingKeyRefused','factorBindingRefused'])checks[name]=true;
 }
 timings.recoveryMs=Date.now()-recoveryStart;
 if(monitoringQuiet)assert.equal(digest(await storedRows(primary.pool,true)),upgradedMonitoringDigest);
 if(relayStop)assert.equal(digest({ledger:(await primary.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,rows:await storedRows(primary.pool,true)}),upgradedRelayDigest);
 assert.equal(digest({ledger:await ledger(primary.pool),identity:await identity(primary.pool),mail:(await primary.pool.query('SELECT * FROM email_outbox ORDER BY id')).rows,pairing:(await primary.pool.query('SELECT * FROM pairing_requests ORDER BY id')).rows}),upgradedDigest);checks.upgradedUnchanged=true;
 receipt={schemaVersion:billing?6:backupVerification?5:monitoringQuiet?4:relayStop?3:factor?2:1,driver:{head:git('rev-parse','HEAD'),dirty:git('status','--porcelain')!==''},releases:{old:{head:oldHead,migrations:oldLedger.length,digest:digest(oldLedger)},new:{head:newHead,migrations:newLedger.length,digest:digest(newLedger)}},checks,...(billing?{billingStore:billingChecks}:backupVerification?{backupVerification:backupChecks}:{}),timings,measuredAt:new Date().toISOString(),limitations:[billing?'Only the supplied 44-to-45 pair, synthetic account/factor/relay/monitoring, backups and country billing state, PostgreSQL 18 and local Mailpit; no provider, invoice, enforcement or live recovery.':backupVerification?'Only the supplied 42-to-43 pair with synthetic account/factor/relay/monitoring and backup evidence, PostgreSQL 18 and local Mailpit. Evidence is synthetic; this proves no archive, image, provider or fiscal operation.':monitoringQuiet?'Only the supplied 36-to-37 pair, synthetic accounts/factors/relay and monitoring state, PostgreSQL 18 and local Mailpit; no provider or customer data.':relayStop?'Only the supplied 35-to-36 pair, populated synthetic account/factor/relay state, PostgreSQL 18 and local Mailpit; no provider or customer data.':factor?'Only the supplied 34-to-35 pair, synthetic passkey rows, PostgreSQL 18 and local Mailpit; no provider or customer data.':'Only this pinned 26-to-27 pair, PostgreSQL 18 and local Mailpit; no provider or customer data.','Consumers run as real host Node processes through the current deployment gate; historical binaries have no intrinsic future-schema gate. Container image rebuild remains the separate local-stack proof.','Consumers stop during migration; no mixed-version or online upgrade, downgrade migration, traffic routing or availability target.','Recovery restores the pre-upgrade logical backup and matching external keys into another database; post-backup writes are not recovered.',...(monitoringQuiet?['A separate post-upgrade backup preserves captured notification deadlines and recipients; restored workers refuse wrong or missing email keys. A valid late sent receipt authorizes one recovery; uncertainty and inbox delivery remain outside this receipt.']:[]),...(relayStop?['The stopped backup is restored separately with matching external relay keys; an older pre-stop backup starts not-stopped after upgrade. Ordinary consumer startup remains relay-off.']:[])]};
}catch(error){failure=error;if(billing)console.error(JSON.stringify({event:'schema-upgrade-failed',phase,code:/^[A-Z0-9_]{1,32}$/.test(error?.code??'')?error.code:'proof_failed',location:error?.stack?.match(/schema-upgrade-[a-z-]+\.mjs:\d+:\d+/)?.[0]??'unknown'}));}
finally{
 for(const handle of handles)await stop(handle);
 for(const pool of pools)await pool.end();
 for(const name of containers)try{docker('rm','-f','-v',name);}catch{}
 await rm(root,{recursive:true,force:true});
}
const remainingContainers=new Set(docker('ps','-a','--format','{{.Names}}').split('\n'));
const remainingVolumes=new Set(docker('volume','ls','--format','{{.Name}}').split('\n'));
const cleanup={containers:containers.filter(name=>remainingContainers.has(name)).length,volumes:volumes.filter(name=>remainingVolumes.has(name)).length,checkouts:Number(existsSync(root))};
if(failure)throw new Error(`Schema upgrade proof failed; cleanup ${JSON.stringify(cleanup)}`,billing?undefined:{cause:failure});
receipt.cleanup=cleanup;verifySchemaUpgradeReceipt(receipt);await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({output,checks,timings,cleanup}));
