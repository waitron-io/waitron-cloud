import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash,createPrivateKey,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {once} from 'node:events';
import {rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer as createNetServer,connect} from 'node:net';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {encodeMachine} from '../packages/registration/src/index.ts';
import {verifyDatabaseRecoveryReceipt} from './verify-database-recovery-receipt.mjs';

const require=createRequire(new URL('../packages/registration/package.json',import.meta.url));
const {Pool}=require('pg');
const image='postgres:18-alpine',output=resolve(process.argv[2]??'/tmp/waitron-cloud-database-recovery-receipt.json');
if(process.argv.length>3)throw new Error('usage: database-recovery-receipt.mjs [RECEIPT.json]');
const id=randomUUID().slice(0,8),prefix=`waitron-cloud-db-recovery-${id}`,network=`${prefix}-network`,primary=`${prefix}-primary`,standby=`${prefix}-standby`,mailpit=`${prefix}-mailpit`,basebackup=`${prefix}-basebackup`,primaryVolume=`${prefix}-primary`,standbyVolume=`${prefix}-standby`;
const containers=[primary,standby,mailpit,basebackup],volumes=[primaryVolume,standbyVolume],passwords={admin:randomBytes(24).toString('hex'),migration:randomBytes(24).toString('hex'),runtime:randomBytes(24).toString('hex'),backup:randomBytes(24).toString('hex')};
const email={activeKeyId:'recovery-v1',keys:{'recovery-v1':randomBytes(32).toString('hex')}},rateKey=randomBytes(32).toString('hex'),issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url');
let account,claimWorker,evidence,failure;

function docker(args,{capture=true,timeout=180000}={}){return execFileSync('docker',args,{encoding:'utf8',timeout,stdio:capture?['ignore','pipe','pipe']:'inherit'}).trim();}
function exists(kind,name){try{docker([kind,'inspect',name]);return true;}catch{return false;}}
async function freePort(){const server=createNetServer();await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});const address=server.address();assert(address&&typeof address!=='string');await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));return address.port;}
async function until(check,message,timeout=60000){const deadline=Date.now()+timeout;let last;while(Date.now()<deadline){try{last=await check();if(last)return last;}catch(error){last=error;}await delay(100);}throw new Error(`${message}${last instanceof Error?`: ${last.message}`:''}`);}
function url(user,password,port){return `postgres://${user}:${password}@127.0.0.1:${port}/cloud`;}
function runNode(args,env,input){return execFileSync(process.execPath,args,{cwd:process.cwd(),env:{...process.env,...env},input,encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']}).trim();}
function processHandle(args,env){
 const child=spawn(process.execPath,args,{cwd:process.cwd(),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',value=>{stdout+=String(value);});child.stderr.on('data',value=>{stderr+=String(value);});
 const exited=once(child,'exit').then(([code,signal])=>({code,signal,stdout,stderr}));return{child,exited,get stdout(){return stdout;},get stderr(){return stderr;}};
}
async function stopProcess(handle,signal='SIGTERM'){if(!handle)return;if(handle.child.exitCode===null&&handle.child.signalCode===null)handle.child.kill(signal);await Promise.race([handle.exited,delay(5000).then(()=>{if(handle.child.exitCode===null)handle.child.kill('SIGKILL');return handle.exited;})]);}
async function waitPostgres(container,user='cloud_admin'){await until(()=>{try{return docker(['exec',container,'psql','-X','-U',user,'-d','cloud','-Atqc','SELECT 1'])==='1';}catch{return false;}},`${container} did not become ready`,60000);}
function psql(container,sql){return docker(['exec',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','cloud_admin','-d','cloud','-Atqc',sql]);}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
function digest(value){return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function privateKey(value){return createPrivateKey({key:Buffer.from(value,'base64url'),format:'der',type:'pkcs8'});}
function proof(origin,installation,action,operationId,lease='',body={}){const bytes=encodeMachine({origin,action,installationId:installation.installationId,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});return{payload:bytes.toString('base64url'),signature:sign(null,bytes,privateKey(installation.privateKey)).toString('base64url')};}
async function machine(port,accountPort,action,envelope){return fetch(`http://127.0.0.1:${port}/api/installations/${action}`,{method:'POST',headers:{host:`127.0.0.1:${accountPort}`,'content-type':'application/json'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(10000)});}
async function startAccount(databaseUrl,port,origin){
 const handle=processHandle(['packages/account-http/src/server-cli.ts'],{DATABASE_URL:databaseUrl,CLOUD_EMAIL_ACTIVE_KEY_ID:email.activeKeyId,CLOUD_EMAIL_KEYS:JSON.stringify(email.keys),CLOUD_HTTP_RATE_KEY:rateKey,CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_PORT:String(port),CLOUD_HTTP_HOST:'127.0.0.1',CLOUD_INSTALLATION_ISSUER_KEY:issuerKey,NODE_ENV:'test'});
 await until(()=>{if(handle.child.exitCode!==null)throw new Error(handle.stderr);const line=handle.stdout.trim().split('\n').find(value=>value.startsWith('{'));return line&&JSON.parse(line).port===port;},'account server did not start');return handle;
}
async function droppedRequest(accountPort,path,body){
 let response='';let resolveBackend,rejectBackend;const backendDone=new Promise((resolve,reject)=>{resolveBackend=resolve;rejectBackend=reject;});
 const server=createNetServer(client=>{const upstream=connect(accountPort,'127.0.0.1');client.pipe(upstream);upstream.once('data',chunk=>{response+=chunk.toString('utf8');client.destroy();upstream.destroy();resolveBackend();});upstream.once('error',rejectBackend);client.once('error',()=>{});});
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});const address=server.address();assert(address&&typeof address!=='string');const encoded=JSON.stringify(body);
 const callerReceivedBytes=await new Promise((resolve,reject)=>{const client=connect(address.port,'127.0.0.1',()=>client.write(`POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${accountPort}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(encoded)}\r\nConnection: close\r\n\r\n${encoded}`));let received=0;client.on('data',chunk=>{received+=chunk.length;});client.once('error',reject);client.once('close',()=>resolve(received));});
 await backendDone;await new Promise(resolve=>server.close(resolve));const match=response.match(/^HTTP\/1\.1 (\d{3}) /);assert(match);return{discardedBackendStatus:Number(match[1]),callerReceivedBytes};
}
async function mailCount(port){const response=await fetch(`http://127.0.0.1:${port}/api/v1/messages?limit=20`,{signal:AbortSignal.timeout(3000)});assert.equal(response.status,200);const list=await response.json();assert.equal(Number(list.total),list.messages.length);return list.messages.length;}
async function cleanup(){
 await Promise.allSettled([stopProcess(account),stopProcess(claimWorker)]);account=undefined;claimWorker=undefined;
 for(const name of containers)try{docker(['rm','-f','-v',name]);}catch{}
 for(const name of volumes)try{docker(['volume','rm',name]);}catch{}
 try{docker(['network','rm',network]);}catch{}
 return{containers:containers.filter(name=>exists('container',name)).length,volumes:volumes.filter(name=>exists('volume',name)).length,networks:Number(exists('network',network))};
}

try{
 await rm(output,{force:true});
 const ports={primary:await freePort(),standby:await freePort(),account:await freePort(),smtp:await freePort(),mailpit:await freePort()},origin=`http://127.0.0.1:${ports.account}`;
 docker(['network','create',network]);docker(['volume','create',primaryVolume]);docker(['volume','create',standbyVolume]);
 docker(['run','--detach','--name',mailpit,'--network',network,'--publish',`127.0.0.1:${ports.smtp}:1025`,'--publish',`127.0.0.1:${ports.mailpit}:8025`,'axllent/mailpit:v1.31.1']);
 const mailpitReady=await until(async()=>{try{return(await fetch(`http://127.0.0.1:${ports.mailpit}/api/v1/messages`,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'Mailpit did not become ready');
 docker(['run','--detach','--name',primary,'--network',network,'--network-alias','primary','--publish',`127.0.0.1:${ports.primary}:5432`,'--env','PGDATA=/var/lib/postgresql/data','--env','POSTGRES_USER=cloud_admin','--env',`POSTGRES_PASSWORD=${passwords.admin}`,'--env','POSTGRES_DB=cloud','--volume',`${primaryVolume}:/var/lib/postgresql/data`,image,'postgres','-c','wal_level=replica','-c','max_wal_senders=4','-c','hot_standby=on']);
 await waitPostgres(primary);const primaryProcess=psql(primary,'SELECT 1')==='1';assert.equal(primaryProcess,true);
 psql(primary,`REVOKE CREATE ON DATABASE cloud FROM PUBLIC;
CREATE ROLE cloud_migrate LOGIN PASSWORD '${passwords.migration}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE cloud_app LOGIN PASSWORD '${passwords.runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE cloud_backup LOGIN PASSWORD '${passwords.backup}' NOSUPERUSER NOCREATEDB NOCREATEROLE REPLICATION;
ALTER DATABASE cloud OWNER TO cloud_migrate; ALTER SCHEMA public OWNER TO cloud_migrate;
GRANT CONNECT ON DATABASE cloud TO cloud_migrate,cloud_app; REVOKE EXECUTE ON FUNCTION pg_promote(boolean,integer) FROM PUBLIC;`);
 docker(['exec',primary,'sh','-c',`printf '%s\\n' 'host replication cloud_backup 0.0.0.0/0 scram-sha-256' >> "$PGDATA/pg_hba.conf"`]);psql(primary,'SELECT pg_reload_conf()');
 const migrationUrl=url('cloud_migrate',passwords.migration,ports.primary),runtimePrimary=url('cloud_app',passwords.runtime,ports.primary),adminPrimary=url('cloud_admin',passwords.admin,ports.primary);
 runNode(['packages/registration/src/migrate-cli.ts'],{DATABASE_URL:migrationUrl});
 psql(primary,`GRANT USAGE ON SCHEMA public TO cloud_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cloud_app; GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO cloud_app; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cloud_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cloud_migrate IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO cloud_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cloud_migrate IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO cloud_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cloud_migrate IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO cloud_app;`);
 const appPool=new Pool({connectionString:runtimePrimary}),adminPool=new Pool({connectionString:adminPrimary}),migrationPool=new Pool({connectionString:migrationUrl});
 const roleRows=(await adminPool.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname",[['cloud_app','cloud_backup','cloud_migrate']])).rows;
 const role=(name)=>{const row=roleRows.find(value=>value.rolname===name);assert(row);return{name,superuser:row.rolsuper,createDatabase:row.rolcreatedb,createRole:row.rolcreaterole,replication:row.rolreplication};};
 const canMigrate=Number((await migrationPool.query('SELECT count(*) FROM schema_migrations')).rows[0].count)===26;await migrationPool.end();assert.equal(canMigrate,true);
 const canReadApplication=Number((await appPool.query('SELECT count(*) FROM schema_migrations')).rows[0].count)===26;assert.equal(canReadApplication,true);let canCreateSchema=true;try{await appPool.query('CREATE SCHEMA recovery_escape');}catch(error){assert.equal(error.code,'42501');canCreateSchema=false;}assert.equal(canCreateSchema,false);
 const canPromote=(await adminPool.query("SELECT has_function_privilege('cloud_app','pg_promote(boolean,integer)','EXECUTE') AS allowed")).rows[0].allowed;assert.equal(canPromote,false);
 let backupRead=true;const backupPool=new Pool({connectionString:url('cloud_backup',passwords.backup,ports.primary),connectionTimeoutMillis:2000});try{await backupPool.query('SELECT * FROM schema_migrations LIMIT 1');}catch(error){assert.equal(error.code,'42501');backupRead=false;}finally{await backupPool.end();}assert.equal(backupRead,false);
 const seeded=JSON.parse(runNode(['scripts/database-recovery-fixture.mjs','seed'],{DATABASE_URL:runtimePrimary,CLOUD_EMAIL_ACTIVE_KEY_ID:email.activeKeyId,CLOUD_EMAIL_KEYS:JSON.stringify(email.keys)}));assert.equal(seeded.installations.length,2);
 const baseBackupAt=new Date().toISOString();docker(['run','--rm','--name',basebackup,'--network',network,'--env',`PGPASSWORD=${passwords.backup}`,'--env','PGDATA=/var/lib/postgresql/data','--volume',`${standbyVolume}:/var/lib/postgresql/data`,image,'sh','-c','rm -rf "$PGDATA"/* && pg_basebackup -h primary -U cloud_backup -D "$PGDATA" -Fp -Xs -P'],{timeout:300000});
 docker(['run','--rm','--env','PGDATA=/var/lib/postgresql/data','--volume',`${standbyVolume}:/var/lib/postgresql/data`,image,'sh','-c',`touch "$PGDATA/standby.signal"; printf "%s\\n" "primary_conninfo = 'host=primary port=5432 user=cloud_backup password=${passwords.backup}'" >> "$PGDATA/postgresql.auto.conf"`]);
 docker(['run','--detach','--name',standby,'--network',network,'--publish',`127.0.0.1:${ports.standby}:5432`,'--env','PGDATA=/var/lib/postgresql/data','--volume',`${standbyVolume}:/var/lib/postgresql/data`,image,'postgres','-c','hot_standby=on']);await waitPostgres(standby);
 const adminStandby=url('cloud_admin',passwords.admin,ports.standby),standbyPool=new Pool({connectionString:adminStandby});const standbyProcess=(await standbyPool.query('SELECT pg_is_in_recovery() AS recovery')).rows[0].recovery;assert.equal(standbyProcess,true);
 account=await startAccount(runtimePrimary,ports.account,origin);const accountServerProcess=account.child.exitCode===null;assert.equal(accountServerProcess,true);
 claimWorker=processHandle(['scripts/database-recovery-fixture.mjs','claim'],{DATABASE_URL:runtimePrimary,CLOUD_EMAIL_ACTIVE_KEY_ID:email.activeKeyId,CLOUD_EMAIL_KEYS:JSON.stringify(email.keys)});
 const claim=await until(()=>{const line=claimWorker.stdout.trim().split('\n').find(value=>value.startsWith('{'));if(claimWorker.child.exitCode!==null)throw new Error(claimWorker.stderr);return line&&JSON.parse(line);},'email worker did not claim its message');assert.equal(claim.claimed,seeded.messageId);
 const emailWorkerProcess=claimWorker.child.exitCode===null;assert.equal(emailWorkerProcess,true);await adminPool.query("UPDATE email_outbox SET lease_until=clock_timestamp()+interval '5 seconds' WHERE id=$1 AND status='processing'",[seeded.messageId]);
 const controlOperationId=randomUUID();let controlResponse=await machine(ports.account,ports.account,'renew',proof(origin,seeded.installations[1],'renew',controlOperationId));assert.equal(controlResponse.status,200,await controlResponse.clone().text());
 const operationId=randomUUID(),renew=proof(origin,seeded.installations[0],'renew',operationId),discarded=await droppedRequest(ports.account,'/api/installations/renew',renew);assert.equal(discarded.discardedBackendStatus,200);assert.equal(discarded.callerReceivedBytes,0);
 const stored=await until(async()=>{const result=await appPool.query('SELECT result FROM installation_operations WHERE installation_id=$1 AND operation_id=$2',[seeded.installations[0].installationId,operationId]);return result.rows[0]?.result;},'lost-reply operation did not commit');const durableResultDigest=digest(stored);
 const primaryLsn=(await adminPool.query('SELECT pg_current_wal_lsn()::text AS lsn')).rows[0].lsn;
 const replay=await until(async()=>{const result=await standbyPool.query('SELECT pg_last_wal_replay_lsn()::text AS lsn,pg_wal_lsn_diff($1::pg_lsn,pg_last_wal_replay_lsn())::float8 AS lag',[primaryLsn]);return Number(result.rows[0].lag)<=0&&result.rows[0];},'standby did not replay the recovery point');const replayLsn=replay.lsn,confirmedLagBytes=Math.max(0,Number(replay.lag));
 const claimAtInterruption=(await adminPool.query('SELECT status,lease_until>clock_timestamp() AS lease_live FROM email_outbox WHERE id=$1',[seeded.messageId])).rows[0];assert.equal(claimAtInterruption.status,'processing');assert.equal(claimAtInterruption.lease_live,true);
 await appPool.end();await adminPool.end();await standbyPool.end();const primaryStoppedAt=new Date().toISOString(),outageStarted=Date.now();docker(['stop','--time','1',primary]);
 const databaseUnavailableDuringOutage=await until(async()=>{try{const response=await fetch(`${origin}/api/health/ready`,{headers:{host:`127.0.0.1:${ports.account}`},signal:AbortSignal.timeout(1000)});return !response.ok;}catch{return true;}},'account API remained ready after primary stopped');
 await stopProcess(claimWorker,'SIGKILL');claimWorker=undefined;await stopProcess(account);account=undefined;
 const promotionStarted=Date.now();docker(['exec','--user','postgres',standby,'pg_ctl','promote','-D','/var/lib/postgresql/data','-w','-t','60']);const promotedAt=new Date().toISOString(),promotionMs=Date.now()-promotionStarted;
 const runtimeStandby=url('cloud_app',passwords.runtime,ports.standby),recoveredPool=new Pool({connectionString:runtimeStandby});await until(async()=>!(await recoveredPool.query('SELECT pg_is_in_recovery() AS recovery')).rows[0].recovery,'standby did not promote');
 account=await startAccount(runtimeStandby,ports.account,origin);const recoveredAt=new Date().toISOString(),outageMs=Date.now()-outageStarted;
 let response=await machine(ports.account,ports.account,'renew',renew);assert.equal(response.status,200,await response.clone().text());const retry=await response.json(),retryResultDigest=digest(retry);
 const operationCount=Number((await recoveredPool.query('SELECT count(*) FROM installation_operations WHERE installation_id=$1 AND operation_id=$2',[seeded.installations[0].installationId,operationId])).rows[0].count),singleDurableResult=operationCount===1;assert.equal(singleDurableResult,true);assert.equal(retryResultDigest,durableResultDigest);
 response=await machine(ports.account,ports.account,'configuration',proof(origin,seeded.installations[0],'configuration',randomUUID(),retry.lease));const firstBody=await response.json(),leaseUsable=response.status===200,firstOwnConfiguration=leaseUsable&&firstBody.installationId===seeded.installations[0].installationId&&firstBody.installationId!==seeded.installations[1].installationId;assert.equal(firstOwnConfiguration,true,JSON.stringify(firstBody));
 response=await machine(ports.account,ports.account,'configuration',proof(origin,seeded.installations[0],'configuration',operationId,retry.lease));const changedBody=await response.json(),changedActionRejected=response.status===400&&changedBody.error==='conflict';assert.equal(changedActionRejected,true,JSON.stringify(changedBody));
 const cross={...seeded.installations[0],installationId:seeded.installations[1].installationId};response=await machine(ports.account,ports.account,'renew',proof(origin,cross,'renew',randomUUID()));const crossTenantRejected=response.status===401;assert.equal(crossTenantRejected,true,await response.clone().text());
 const secondRenewId=randomUUID();response=await machine(ports.account,ports.account,'renew',proof(origin,seeded.installations[1],'renew',secondRenewId));assert.equal(response.status,200,await response.clone().text());const secondLease=(await response.json()).lease;response=await machine(ports.account,ports.account,'configuration',proof(origin,seeded.installations[1],'configuration',randomUUID(),secondLease));const secondBody=await response.json(),secondOwnConfiguration=response.status===200&&secondBody.installationId===seeded.installations[1].installationId&&secondBody.installationId!==seeded.installations[0].installationId;assert.equal(secondOwnConfiguration,true,JSON.stringify(secondBody));
 const postBackupWriteRecovered=Number((await recoveredPool.query('SELECT count(*) FROM installation_operations WHERE installation_id=$1 AND operation_id=$2',[seeded.installations[1].installationId,controlOperationId])).rows[0].count)===1;assert.equal(postBackupWriteRecovered,true);
 await until(async()=>(await recoveredPool.query('SELECT lease_until<=clock_timestamp() AS expired FROM email_outbox WHERE id=$1',[seeded.messageId])).rows[0]?.expired,'interrupted email claim did not expire',10000);
 const workerOutput=runNode(['packages/registration/src/email-worker-cli.ts','--once'],{DATABASE_URL:runtimeStandby,CLOUD_EMAIL_ACTIVE_KEY_ID:email.activeKeyId,CLOUD_EMAIL_KEYS:JSON.stringify(email.keys),CLOUD_MAIL_TRANSPORT:'local',MAILPIT_SMTP_PORT:String(ports.smtp),CLOUD_PORTAL_ORIGIN:origin,NODE_ENV:'test'});assert(JSON.parse(workerOutput).counts.sent===1);
 const claimRecovered=(await recoveredPool.query("SELECT status='sent' AS recovered FROM email_outbox WHERE id=$1",[seeded.messageId])).rows[0].recovered,deliveredOnce=await mailCount(ports.mailpit)===1;assert.equal(claimRecovered,true);assert.equal(deliveredOnce,true);
 await recoveredPool.end();
 evidence={cloud:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!==''},measuredAt:new Date().toISOString(),environment:{postgresImage:image,primaryProcess,standbyProcess,accountServerProcess,emailWorkerProcess,mailpit:mailpitReady},roles:{migration:{...role('cloud_migrate'),canMigrate},runtime:{...role('cloud_app'),canReadApplication,canCreateSchema,canPromote},replication:{...role('cloud_backup'),canReadApplication:backupRead}},recovery:{baseBackupAt,primaryStoppedAt,promotedAt,recoveredAt,primaryLsn,replayLsn,confirmedLagBytes,databaseUnavailableDuringOutage,postBackupWriteRecovered,promotionMs,outageMs},operation:{...discarded,durableResultDigest,retryResultDigest,singleDurableResult,leaseUsable,changedActionRejected},worker:{statusAtInterruption:claimAtInterruption.status,leaseLiveAtInterruption:claimAtInterruption.lease_live,claimRecovered,deliveredOnce},isolation:{firstOwnConfiguration,secondOwnConfiguration,crossTenantRejected}};
}catch(error){failure=error;}finally{
 const cleanupResult=await cleanup();if(evidence)evidence.cleanup=cleanupResult;
}
if(failure)throw failure;
const receipt=verifyDatabaseRecoveryReceipt({schemaVersion:1,...evidence});await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({output,verified:true,recovery:receipt.recovery,cleanup:receipt.cleanup}));
