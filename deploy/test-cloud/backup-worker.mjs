import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isAbsolute,resolve,relative} from 'node:path';
import {createRequire} from 'node:module';
import {parsePlanMode,runWorkerLoop} from '../../packages/registration/src/index.ts';
import {BackupCatalogue} from '../../packages/backups/src/catalogue.ts';
import {BackupKeyVault} from '../../packages/backups/src/keys.ts';
import {BackupWorker,backupWorkerStatus,retryFailedBackupJobs} from '../../packages/backups/src/worker.ts';
import {workerObjects} from '../../packages/backups/src/worker-config.ts';
import {openTestBackupVerifier,claimTestBackupWorker} from './backup-verifier-runtime.mjs';
export {openTestBackupVerifier,claimTestBackupWorker,verifierWaitronRevision} from './backup-verifier-runtime.mjs';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
export async function runTestBackupWorker(env=process.env,args=process.argv.slice(2)){
 const planMode=parsePlanMode(env.CLOUD_TEST_SERVICE_PLANS,env.CLOUD_VENUE_SERVICE_LEVELS);
 if(!['test-free-paid','test-venue-levels'].includes(planMode))throw Error('test_cloud.plan_mode');
 const mode=args[0];if(args.length>1||mode&&!['--once','--status','--retry-failed'].includes(mode)||!env.DATABASE_URL)throw Error('test_cloud.backup_configuration');
 if(!['--status','--retry-failed'].includes(mode)){
  const state=env.CLOUD_VERIFIER_STATE_DIR,config=resolve(env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack');
  if(!state||!isAbsolute(state)||!relative(config,resolve(state)).startsWith('../'))throw Error('test_cloud.backup_configuration');
 }
 const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 const pool=new Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});
 let storage,ownership;pool.on('error',()=>{process.exitCode=1;stop.abort();});
 try{
  await pool.query('SELECT claim_id,lease_until FROM backup_jobs LIMIT 0');
  if(mode==='--status')return console.log(JSON.stringify(await backupWorkerStatus(pool)));
  if(mode==='--retry-failed')return console.log(JSON.stringify({retried:await retryFailedBackupJobs(pool)}));
  const master=env.CLOUD_BACKUP_MASTER_KEY??'';if(!/^[a-fA-F0-9]{64}$/.test(master))throw Error('test_cloud.backup_configuration');
  ownership=await claimTestBackupWorker(pool,shutdown);
  const {verify,controllerScope}=await openTestBackupVerifier({directory:env.CLOUD_VERIFIER_STATE_DIR,image:env.CLOUD_VERIFIER_IMAGE});
  const ca=await readFile(env.CLOUD_BACKUP_CA_FILE,'utf8');storage=workerObjects(env,ca);
  const worker=new BackupWorker(pool,new BackupCatalogue(pool,new BackupKeyVault(Buffer.from(master,'hex')),storage.objects,planMode),verify,controllerScope);
  if(mode==='--once'){await worker.schedule();await worker.runOnce(stop.signal);console.log(JSON.stringify(await worker.status()));}
  else await runWorkerLoop({signal:stop.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:1000,schedule:()=>worker.schedule(),runOnce:async signal=>{try{return await worker.runOnce(signal);}finally{storage.close();}}});
 }finally{storage?.close();try{await ownership?.release();}finally{await pool.end();}process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS)==='existing')await import('../../packages/backups/src/worker-cli.ts');
  else await runTestBackupWorker();
 }catch{console.error('Test Cloud backup worker failed; check private configuration, pinned image and owned verifier state');process.exitCode=1;}
}
