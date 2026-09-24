import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {BackupCatalogue} from './catalogue.ts';
import {BackupKeyVault} from './keys.ts';
import {BackupWorker,backupWorkerStatus} from './worker.ts';
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
  const result=await pool.query(`WITH selected AS(SELECT id FROM backup_jobs WHERE status='failed' ORDER BY available_at,id LIMIT 100 FOR UPDATE SKIP LOCKED)
   UPDATE backup_jobs SET status='pending',attempts=0,last_error=NULL,available_at=clock_timestamp() WHERE id IN(SELECT id FROM selected)`);
  console.log(JSON.stringify({retried:result.rowCount}));
 }else{
  const master=process.env.CLOUD_BACKUP_MASTER_KEY??'';if(!/^[a-fA-F0-9]{64}$/.test(master))throw Error();
  const restore=await createWaitronVerifier(process.env.WAITRON_CHECKOUT??'');
  const ca=process.env.CLOUD_BACKUP_CA_FILE?await readFile(process.env.CLOUD_BACKUP_CA_FILE,'utf8'):undefined;
  storage=workerObjects(process.env,ca);
  const worker=new BackupWorker(pool,new BackupCatalogue(pool,new BackupKeyVault(Buffer.from(master,'hex')),storage.objects),restore);
  do{
   await worker.schedule();let ran=false;
   try{ran=await worker.runOnce(stop.signal);}finally{storage.close();}
   if(mode==='--once'){console.log(JSON.stringify(await worker.status()));break;}
   if(!ran)try{await delay(1000,undefined,{signal:stop.signal});}catch{if(!stop.signal.aborted)throw Error();}
  }while(!stop.signal.aborted);
 }
}catch{
 // Provider and database errors can contain credentials; emit only a fixed diagnostic.
 console.error('Backup worker failed; check database, storage, key and Waitron verifier configuration');process.exitCode=1;
}finally{
 storage?.close();try{await pool?.end();}catch{process.exitCode=1;}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
