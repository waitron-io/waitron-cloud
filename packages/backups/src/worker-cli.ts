import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {runWorkerLoop} from '@waitron-cloud/registration';
import {BackupCatalogue} from './catalogue.ts';
import {BackupKeyVault} from './keys.ts';
import {BackupWorker,backupWorkerStatus,retryFailedBackupJobs} from './worker.ts';
import {workerObjects} from './worker-config.ts';
import {createWaitronVerifier} from './waitron-verifier.ts';
let pool:Pool|undefined,storage:ReturnType<typeof workerObjects>|undefined;
const stop=new AbortController(),shutdown=()=>stop.abort();
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const args=process.argv.slice(2),mode=args[0];
 if(args.length>1||(mode&&!['--once','--status','--retry-failed'].includes(mode))||!process.env.DATABASE_URL)throw Error();
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});
 pool.on('error',()=>{console.error('Backup worker database connection failed');process.exitCode=1;stop.abort();});
 await pool.query('SELECT claim_id,lease_until FROM backup_jobs LIMIT 0');
 if(mode==='--status')console.log(JSON.stringify(await backupWorkerStatus(pool)));
 else if(mode==='--retry-failed'){
  console.log(JSON.stringify({retried:await retryFailedBackupJobs(pool)}));
 }else{
  const master=process.env.CLOUD_BACKUP_MASTER_KEY??'';if(!/^[a-fA-F0-9]{64}$/.test(master))throw Error();
  const restore=await createWaitronVerifier(process.env.WAITRON_CHECKOUT??'');
  const ca=process.env.CLOUD_BACKUP_CA_FILE?await readFile(process.env.CLOUD_BACKUP_CA_FILE,'utf8'):undefined;
  storage=workerObjects(process.env,ca);
  const worker=new BackupWorker(pool,new BackupCatalogue(pool,new BackupKeyVault(Buffer.from(master,'hex')),storage.objects),restore);
  if(mode==='--once'){
   await worker.schedule();try{await worker.runOnce(stop.signal);}finally{storage.close();}
   console.log(JSON.stringify(await worker.status()));
  }else await runWorkerLoop({signal:stop.signal,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:1000,
   schedule:()=>worker.schedule(),runOnce:async signal=>{try{return await worker.runOnce(signal);}finally{storage?.close();}}});
 }
}catch{
 // Provider and database errors can contain credentials; emit only a fixed diagnostic.
 console.error('Backup worker failed; check database, storage, key and Waitron verifier configuration');process.exitCode=1;
}finally{
 storage?.close();try{await pool?.end();}catch{process.exitCode=1;}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
