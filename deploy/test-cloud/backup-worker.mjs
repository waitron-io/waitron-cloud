import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {parsePlanMode,runWorkerLoop} from '../../packages/registration/src/index.ts';
import {BackupCatalogue} from '../../packages/backups/src/catalogue.ts';
import {BackupKeyVault} from '../../packages/backups/src/keys.ts';
import {BackupWorker,backupWorkerStatus,retryFailedBackupJobs} from '../../packages/backups/src/worker.ts';
import {workerObjects} from '../../packages/backups/src/worker-config.ts';
import {createContainerWaitronVerifier} from '../../packages/backups/src/container-verifier.ts';
import {openVerifierController} from './verifier-controller.mjs';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg'),execute=promisify(execFile);
export const verifierWaitronRevision='e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee';
export async function openTestBackupVerifier({directory,image}){
 if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw Error('test_cloud.verifier_configuration');
 let info;try{[info]=JSON.parse((await execute('docker',['image','inspect',image],{timeout:10000,maxBuffer:65536})).stdout);}catch{throw Error('test_cloud.verifier_configuration');}
 if(info.Id!==image||info.Config.Labels?.['cloud.waitron-revision']!==verifierWaitronRevision)throw Error('test_cloud.verifier_configuration');
 const owner='waitron-cloud-test-backup',controller=await openVerifierController({directory:join(directory,'verifier-controller'),owner,image});
 return createContainerWaitronVerifier({image,owner,controller,memoryMiB:1024,scratchMiB:256});
}
// A dedicated PostgreSQL session serialises trusted controllers across worker restarts.
export async function claimTestBackupWorker(pool,onLost=()=>{}){
 const client=await pool.connect();let lost=false,released=false;
 const failed=()=>{lost=true;onLost();};client.on('error',failed);
 try{const result=await client.query('SELECT pg_try_advisory_lock(hashtext(current_schema()),7905) AS owned');if(!result.rows[0].owned)throw Error('test_cloud.verifier_busy');}
 catch(error){client.removeListener('error',failed);client.release(lost);throw error;}
 return {async release(){if(released)return;released=true;try{if(!lost)await client.query('SELECT pg_advisory_unlock(hashtext(current_schema()),7905)');}finally{client.removeListener('error',failed);client.release(lost);}}};
}
export async function runTestBackupWorker(env=process.env,args=process.argv.slice(2)){
 if(parsePlanMode(env.CLOUD_TEST_SERVICE_PLANS)!=='test-free-paid')throw Error('test_cloud.plan_mode');
 const mode=args[0];if(args.length>1||mode&&!['--once','--status','--retry-failed'].includes(mode)||!env.DATABASE_URL)throw Error('test_cloud.backup_configuration');
 const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 const pool=new Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});
 let storage,ownership;pool.on('error',()=>{process.exitCode=1;stop.abort();});
 try{
  await pool.query('SELECT claim_id,lease_until FROM backup_jobs LIMIT 0');
  if(mode==='--status')return console.log(JSON.stringify(await backupWorkerStatus(pool)));
  if(mode==='--retry-failed')return console.log(JSON.stringify({retried:await retryFailedBackupJobs(pool)}));
  const master=env.CLOUD_BACKUP_MASTER_KEY??'';if(!/^[a-fA-F0-9]{64}$/.test(master))throw Error('test_cloud.backup_configuration');
  ownership=await claimTestBackupWorker(pool,shutdown);
  const restore=await openTestBackupVerifier({directory:env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack',image:env.CLOUD_VERIFIER_IMAGE});
  const ca=await readFile(env.CLOUD_BACKUP_CA_FILE,'utf8');storage=workerObjects(env,ca);
  const worker=new BackupWorker(pool,new BackupCatalogue(pool,new BackupKeyVault(Buffer.from(master,'hex')),storage.objects,'test-free-paid'),restore);
  if(mode==='--once'){await worker.schedule();await worker.runOnce(stop.signal);console.log(JSON.stringify(await worker.status()));}
  else await runWorkerLoop({signal:stop.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:1000,schedule:()=>worker.schedule(),runOnce:async signal=>{try{return await worker.runOnce(signal);}finally{storage.close();}}});
 }finally{storage?.close();try{await ownership?.release();}finally{await pool.end();}process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS)==='existing')await import('../../packages/backups/src/worker-cli.ts');
  else await runTestBackupWorker();
 }catch{console.error('Test Cloud backup worker failed; check private configuration, pinned image and owned verifier state');process.exitCode=1;}
}
