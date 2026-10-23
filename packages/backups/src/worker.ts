import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '@waitron-cloud/registration';
import type {BackupCatalogue} from './catalogue.ts';
import {isBackupCancellation} from './cancellation.ts';
import type {DataRestoreVerifier} from './container-verifier.ts';
import {lockVerificationPolicy} from './verification-admission.ts';
interface Job {id:string;kind:'verify'|'retention'|'incoming';venue_id:string;target_id:string;claim_id:string;attempts:number;}
export class BackupWorker {
 readonly #pool:Pool;readonly #catalogue:BackupCatalogue;readonly #restore:DataRestoreVerifier;readonly #scope:string;
 constructor(pool:Pool,catalogue:BackupCatalogue,restore:DataRestoreVerifier,controllerScope:string){if(typeof controllerScope!=='string'||!controllerScope||controllerScope.length>128)throw Error('backup.verifier_configuration');this.#pool=pool;this.#catalogue=catalogue;this.#restore=restore;this.#scope=controllerScope;}
 async schedule(){
  let count=0;
  const points=await this.#pool.query(`INSERT INTO backup_jobs(kind,venue_id,target_id)
   SELECT 'verify',p.venue_id,p.id FROM backup_points p JOIN venues v ON v.id=p.venue_id
   WHERE v.environment='test' AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM backup_jobs j WHERE j.kind='verify' AND j.target_id=p.id)
   ORDER BY p.captured_at,p.id LIMIT 100 ON CONFLICT(kind,target_id) DO NOTHING`);count+=points.rowCount??0;
  for(const kind of ['retention','incoming']){
   const result=await this.#pool.query(`INSERT INTO backup_jobs(kind,venue_id,target_id)
    SELECT $1,l.venue_id,l.venue_id FROM backup_locations l JOIN venues v ON v.id=l.venue_id WHERE v.environment='test'
    AND NOT EXISTS(SELECT 1 FROM backup_jobs j WHERE j.kind=$1 AND j.target_id=l.venue_id)
    ORDER BY l.venue_id LIMIT 100 ON CONFLICT(kind,target_id) DO NOTHING`,[kind]);count+=result.rowCount??0;
  }
  return count;
 }
 async runOnce(signal:AbortSignal=new AbortController().signal){
  if(signal.aborted)return false;
  const job=await transaction(this.#pool,async client=>{
   const policy=await lockVerificationPolicy(client);
   const row=(await client.query(`SELECT j.* FROM backup_jobs j JOIN venues v ON v.id=j.venue_id
    WHERE v.environment='test' AND (j.kind<>'verify' OR $1::boolean) AND ((j.status='pending' AND j.available_at<=clock_timestamp()) OR(j.status='running' AND j.lease_until<=clock_timestamp()))
    ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,[!!policy?.target])).rows[0] as Job|undefined;
   if(!row)return undefined;
   if(row.attempts>=8){await client.query("UPDATE backup_jobs SET status='failed',claim_id=NULL,lease_until=NULL,last_error='attempts_exhausted' WHERE id=$1",[row.id]);return null;}
   return (await client.query("UPDATE backup_jobs SET status='running',claim_id=$2,lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1,runs=runs+1 WHERE id=$1 RETURNING *",[row.id,randomUUID()])).rows[0] as Job;
  });
  if(job===undefined)return false;if(job===null)return true;
  if(job.kind==='verify'){
   const available=await this.#pool.query("SELECT 1 FROM backup_points WHERE id=$1 AND venue_id=$2 AND kind='snapshot' AND NOT deleting AND deleted_at IS NULL",[job.target_id,job.venue_id]);
   if(!available.rowCount){try{await this.#finish(job,true);}catch(error){if(!(error instanceof Error&&error.message==='backup.claim_expired'))throw error;}return true;}
   // Admission owns the entire verification transition; stale work has no worker fallback.
   await this.#catalogue.verifyClaim({id:job.id,venueId:job.venue_id,pointId:job.target_id,claimId:job.claim_id,number:job.attempts,controllerScope:this.#scope},this.#restore,signal);
   return true;
  }
  try{
   if(signal.aborted)throw Error('backup.cancelled');
   if(job.kind==='retention')await this.#catalogue.cleanupOne(job.venue_id,new Date(),client=>this.#fence(client,job));
   else await this.#catalogue.cleanupCapture(job.venue_id,client=>this.#fence(client,job));
   await this.#finish(job);
  }catch(error){
   try{await transaction(this.#pool,async client=>{
    await this.#fence(client,job);
    if(isBackupCancellation(error,signal)){
     // Shutdown hands back retry budget only while this worker still owns the lease.
     await client.query(`UPDATE backup_jobs SET status='pending',attempts=GREATEST(0,attempts-1),available_at=clock_timestamp(),claim_id=NULL,lease_until=NULL WHERE id=$1`,[job.id]);
    }else await client.query(`UPDATE backup_jobs SET failures=failures+1,last_error='operation_failed',status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,
     available_at=clock_timestamp()+LEAST(900,30*power(2,attempts-1))*interval '1 second',claim_id=NULL,lease_until=NULL WHERE id=$1`,[job.id]);
   });}catch(failure){if(!(failure instanceof Error&&failure.message==='backup.claim_expired'))throw failure;}
  }
  return true;
 }
 async #fence(client:PoolClient,job:Job){
  // Lock before reading the clock: a wait for another transaction can outlast the lease.
  await client.query('SELECT id FROM backup_jobs WHERE id=$1 FOR UPDATE',[job.id]);
  const live=await client.query("SELECT 1 FROM backup_jobs WHERE id=$1 AND claim_id=$2 AND status='running' AND lease_until>clock_timestamp()",[job.id,job.claim_id]);
  if(!live.rowCount)throw Error('backup.claim_expired');
 }
 async #finish(job:Job,retired=false){
  await transaction(this.#pool,async client=>{
   await this.#fence(client,job);
   await client.query(`UPDATE backup_jobs SET status=$3,attempts=0,last_error=NULL,claim_id=NULL,lease_until=NULL,last_success_at=clock_timestamp(),
    available_at=clock_timestamp()+$4*interval '1 second' WHERE id=$1 AND claim_id=$2`,[job.id,job.claim_id,retired?'completed':'pending',job.kind==='verify'?604800:60]);
  });
 }
 async retryFailed(){return retryFailedBackupJobs(this.#pool);}
 async status(){return backupWorkerStatus(this.#pool);}
}
export async function backupWorkerStatus(pool:Pool){
 const counts={pending:0,running:0,failed:0,completed:0};
 const rows=await pool.query('SELECT status,count(*)::integer AS count FROM backup_jobs GROUP BY status');for(const row of rows.rows)counts[row.status as keyof typeof counts]=row.count;
 const metrics=(await pool.query(`SELECT count(*) FILTER(WHERE(status='pending' AND available_at<=clock_timestamp()) OR(status='running' AND lease_until<=clock_timestamp()))::integer AS due,
  COALESCE(sum(runs),0)::float8 AS runs,COALESCE(sum(failures),0)::float8 AS failures,
  min(CASE WHEN status='running' THEN lease_until ELSE available_at END) FILTER(WHERE(status='pending' AND available_at<=clock_timestamp()) OR(status='running' AND lease_until<=clock_timestamp())) AS oldest_due_at FROM backup_jobs`)).rows[0];
 return {counts,due:metrics.due,runs:metrics.runs,failures:metrics.failures,oldestDueAt:metrics.oldest_due_at?.toISOString()??null};
}

export async function retryFailedBackupJobs(pool:Pool){
 const result=await pool.query(`WITH selected AS(SELECT id FROM backup_jobs WHERE status='failed' ORDER BY available_at,id LIMIT 100 FOR UPDATE SKIP LOCKED)
  UPDATE backup_jobs SET status='pending',attempts=0,last_error=NULL,available_at=clock_timestamp() WHERE id IN(SELECT id FROM selected)`);return result.rowCount??0;
}
