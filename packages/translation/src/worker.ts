import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Pool,PoolClient} from 'pg';
import {readVenuePermissions,recordUsageEvent,requireTestPlanVenue,requireVenueService,transaction,type PlanMode} from '@waitron-cloud/registration';
import {translateBatch,type BatchHooks} from './batch-runner.ts';
import {hasConsent} from './consent.ts';
import {planBatches} from './batching.ts';
import {parseJob,type JobItem} from './job-body.ts';
import {monthSpend,spendingPolicy,type ItemResult,type JobRow} from './job-store.ts';
import type {ModelClient} from './openai-client.ts';
interface StoredBatch {results:ItemResult[];failed:string[];stoppedByCap?:true}
type StoredBatches=Record<string,StoredBatch>;
const failedRefs=(batch:readonly JobItem[])=>batch.filter(item=>item.missing.length>0).map(item=>item.ref);
async function defaultWait(ms:number,signal:AbortSignal){try{await delay(ms,undefined,{signal});}catch{/* an abort ends the wait early */}}
async function recordJobUsage(client:PoolClient,job:JobRow&{finished_at:Date},organisationId:string){
 const occurredAt=job.finished_at.toISOString();
 const measures=[['translation.items_completed',BigInt(job.done)],['translation.input_tokens',BigInt(job.input_tokens)],
  ['translation.output_tokens',BigInt(job.output_tokens)],['translation.cost_micro_usd',BigInt(job.cost_micro_usd)]] as const;
 for(const [type,quantity] of measures)if(quantity>0n)
  await recordUsageEvent(client,{organisationId,venueId:job.venue_id,type,quantity,sourceKind:'translation_job',sourceReference:job.id,occurredAt});
}
export class TranslationWorker {
 readonly #pool:Pool;readonly #client:ModelClient;readonly #concurrency:number;readonly #leaseMs:number;readonly #maxLeases:number;readonly #wait:BatchHooks['wait'];readonly #planMode:PlanMode;
 constructor(pool:Pool,client:ModelClient,options:{batchConcurrency?:number;leaseMs?:number;maxLeases?:number;wait?:BatchHooks['wait'];planMode?:PlanMode}={}){
  this.#planMode=options.planMode===undefined?'existing':options.planMode;requireTestPlanVenue('test',this.#planMode);
  this.#pool=pool;this.#client=client;this.#concurrency=options.batchConcurrency??4;this.#leaseMs=options.leaseMs??600000;
  this.#maxLeases=options.maxLeases??3;this.#wait=options.wait??defaultWait;
  if(this.#concurrency>4||![this.#concurrency,this.#leaseMs,this.#maxLeases].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('translation_worker_options_invalid');
 }
 async runOnce(signal:AbortSignal):Promise<boolean>{
  if(signal.aborted)return false;
  const lease=await this.#lease();
  if(!lease)return false;
  const {job,leaseId}=lease;
  const local=new AbortController(),stop=()=>local.abort();
  signal.addEventListener('abort',stop,{once:true});
  if(signal.aborted)stop();
  try{
   if(this.#planMode!=='test-venue-levels'&&!await transaction(this.#pool,client=>hasConsent(client,job.venue_id))){
    await this.#pool.query(`UPDATE translation_jobs SET state='failed',reason='consent_required',done=0,failed=total,finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL
     WHERE id=$1 AND lease_id=$2 AND state='running'`,[job.id,leaseId]);
    return true;
   }
   const stored=(await this.#pool.query<{body:string;batch_results:StoredBatches}>('SELECT body,batch_results FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows[0];
   if(!stored)return true;
   const parsed=parseJob(stored.body),batches=planBatches(parsed.items);
   const pending=batches.map((batch,index)=>({batch,index})).filter(({index})=>!(String(index) in stored.batch_results));
   if(local.signal.aborted)return true;
   if(job.lease_count>this.#maxLeases){
    for(const {batch,index} of pending)if(local.signal.aborted||!await this.#save(job.id,leaseId,index,{results:[],failed:failedRefs(batch)}))return true;
    if(!local.signal.aborted)await this.#finish(job.id,leaseId,batches.length);return true;
   }
   const hooks=await this.#hooks(job,leaseId,local,lease.permissionRevision);
   const run=async()=>{
    for(let next=pending.shift();next&&!local.signal.aborted;next=pending.shift()){
     const outcome=await translateBatch(parsed,next.batch,this.#client,hooks,local.signal);
     if(local.signal.aborted||outcome.kind==='aborted')return;
     const entry:StoredBatch=outcome.kind==='done'?{results:outcome.results,failed:[]}
      :{results:[],failed:failedRefs(next.batch),...(outcome.reason==='cap_reached'?{stoppedByCap:true as const}:{})};
     if(!await this.#save(job.id,leaseId,next.index,entry,outcome.kind==='done'?outcome:undefined))local.abort();
    }
   };
   const runners=Array.from({length:Math.min(this.#concurrency,pending.length)},()=>run().catch((error:unknown)=>{local.abort();throw error;}));
   const failure=(await Promise.allSettled(runners)).find((s):s is PromiseRejectedResult=>s.status==='rejected');
   if(failure)throw failure.reason;
   if(local.signal.aborted)return true;
   await this.#finish(job.id,leaseId,batches.length);
   return true;
  }finally{signal.removeEventListener('abort',stop);if(signal.aborted)await this.#handBack(job.id,leaseId);}
 }
 async #lease():Promise<{job:JobRow;leaseId:string;permissionRevision?:number}|undefined>{
  return transaction(this.#pool,async client=>{
   // Bounded cleanup can leave old rows behind; they must not receive fresh work leases.
   const projection=this.#planMode==='test-venue-levels'?'id,venue_id':'id';
   // Test-only workers leave production jobs untouched and available to their own workers.
   const environment=this.#planMode==='test-venue-levels'?" AND venue_id IN (SELECT id FROM venues WHERE environment='test')":'';
   const candidate=(await client.query<{id:string;venue_id:string}>(`SELECT ${projection} FROM translation_jobs WHERE state='queued'
    AND created_at>clock_timestamp()-interval '24 hours'${environment}
    OR (state='running' AND lease_until<clock_timestamp() AND created_at>clock_timestamp()-interval '24 hours'${environment})
    ORDER BY created_at,id LIMIT 1${this.#planMode==='test-venue-levels'?'':' FOR UPDATE SKIP LOCKED'}`)).rows[0];
   if(!candidate)return undefined;
   let permissionRevision:number|undefined;
   if(this.#planMode==='test-venue-levels'){
    // Policy precedes job locks; a denied job still leases once so it can finish and free the queue.
    permissionRevision=(await readVenuePermissions(client,candidate.venue_id,this.#planMode)).revision;
    if(!(await client.query(`SELECT id FROM translation_jobs WHERE id=$1 AND venue_id=$2 AND
     ((state='queued' AND created_at>clock_timestamp()-interval '24 hours') OR
      (state='running' AND lease_until<clock_timestamp() AND created_at>clock_timestamp()-interval '24 hours')) FOR UPDATE SKIP LOCKED`,[candidate.id,candidate.venue_id])).rowCount)return undefined;
   }
   const leaseId=randomUUID();
   const job=(await client.query<JobRow>(`UPDATE translation_jobs SET state='running',lease_id=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond',
    lease_count=lease_count+1,started_at=COALESCE(started_at,clock_timestamp()) WHERE id=$1 RETURNING *`,[candidate.id,leaseId,this.#leaseMs])).rows[0]!;
   return {job,leaseId,permissionRevision};
  });
 }
 async #permitted(job:JobRow,leaseId:string,revision:number):Promise<boolean>{
  return transaction(this.#pool,async client=>{
   let permission;
   try{await requireVenueService(client,job.venue_id,'content_translation','test-venue-levels');permission=await readVenuePermissions(client,job.venue_id,'test-venue-levels');}
   catch(error){if(error instanceof Error&&error.message==='permission_denied')return false;throw error;}
   if(permission.revision!==revision)return false;
   if(!(await client.query('SELECT id FROM installations WHERE id=$1 AND venue_id=$2 AND revoked_at IS NULL FOR SHARE',[job.installation_id,job.venue_id])).rowCount)return false;
   if(!(await client.query("SELECT id FROM translation_jobs WHERE id=$1 AND lease_id=$2 AND state='running' AND lease_until>clock_timestamp() FOR SHARE",[job.id,leaseId])).rowCount)return false;
   return hasConsent(client,job.venue_id);
  });
 }
 async #hooks(job:JobRow,leaseId:string,local:AbortController,revision?:number):Promise<BatchHooks>{
  const price=(await this.#pool.query<{input:string;output:string}>('SELECT input_micro_usd_per_million::text AS input,output_micro_usd_per_million::text AS output FROM translation_prices WHERE model=$1',[job.model])).rows[0];
  if(!price)throw new Error('translation_price_missing');
  const input=BigInt(price.input),output=BigInt(price.output);
  const guarded=async(sql:string,values:unknown[])=>{if((await this.#pool.query(sql,values)).rowCount!==1)local.abort();};
  return {
   ...(this.#planMode==='test-venue-levels'?{stillPermitted:()=>this.#permitted(job,leaseId,revision!)}:{}),
   mayCall:()=>transaction(this.#pool,async client=>(await monthSpend(client,job.venue_id))<(await spendingPolicy(client)).cap),
   spent:async usage=>{
    const cost=(BigInt(usage.inputTokens)*input+BigInt(usage.outputTokens)*output+999999n)/1000000n;
    await guarded(`UPDATE translation_jobs SET input_tokens=input_tokens+$3,output_tokens=output_tokens+$4,cost_micro_usd=cost_micro_usd+$5
     WHERE id=$1 AND lease_id=$2 AND state='running'`,[job.id,leaseId,usage.inputTokens,usage.outputTokens,cost.toString()]);
   },
   attempted:()=>guarded(`UPDATE translation_jobs SET lease_until=clock_timestamp()+$3*interval '1 millisecond' WHERE id=$1 AND lease_id=$2 AND state='running'`,[job.id,leaseId,this.#leaseMs]),
   wait:this.#wait,
  };
 }
 async #save(jobId:string,leaseId:string,index:number,entry:StoredBatch,review?:{reviewApplied:number;reviewDropped:number}):Promise<boolean>{
  return transaction(this.#pool,async client=>{
   if(!(await client.query("SELECT 1 FROM translation_jobs WHERE id=$1 AND lease_id=$2 AND state='running' FOR UPDATE",[jobId,leaseId])).rowCount)return false;
   const batches=(await client.query<{batch_results:StoredBatches}>('SELECT batch_results FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0]?.batch_results;
   if(!batches)throw new Error('translation_body_missing');
   if(Object.hasOwn(batches,String(index)))return true;
   batches[String(index)]=entry;
   const entries=Object.values(batches),done=entries.reduce((n,b)=>n+b.results.length,0),failed=entries.reduce((n,b)=>n+b.failed.length,0);
   await client.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[jobId,JSON.stringify(batches)]);
   await client.query(`UPDATE translation_jobs SET done=$2,failed=$3,review_applied=review_applied+$4,review_dropped=review_dropped+$5 WHERE id=$1`,
    [jobId,done,failed,review?.reviewApplied??0,review?.reviewDropped??0]);
   return true;
  });
 }
 async #finish(jobId:string,leaseId:string,batchCount:number):Promise<void>{
  await transaction(this.#pool,async client=>{
   const row=(await client.query<JobRow&{organisation_id:string;batch_results:StoredBatches}>(`SELECT j.*,v.organisation_id,b.batch_results FROM translation_jobs j
    JOIN venues v ON v.id=j.venue_id JOIN translation_job_bodies b ON b.job_id=j.id WHERE j.id=$1 AND j.lease_id=$2 AND j.state='running' FOR UPDATE OF j`,[jobId,leaseId])).rows[0];
   if(!row)return;
   const entries=Object.values(row.batch_results);
   if(entries.length!==batchCount)return;
   const state=row.failed===0?'done':row.done===0?'failed':'partly_done';
   const reason=state==='done'?null:entries.some(e=>e.stoppedByCap)?'limit_reached':state==='failed'?'provider_unavailable':'provider_failed';
   const finished=(await client.query<JobRow&{finished_at:Date}>(`UPDATE translation_jobs SET state=$2,reason=$3,finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL
    WHERE id=$1 RETURNING *`,[jobId,state,reason])).rows[0]!;
   await recordJobUsage(client,finished,row.organisation_id);
  });
 }
 async #handBack(jobId:string,leaseId:string){
  await this.#pool.query(`UPDATE translation_jobs SET lease_until=clock_timestamp(),lease_count=GREATEST(lease_count-1,0)
   WHERE id=$1 AND lease_id=$2 AND state='running'`,[jobId,leaseId]);
 }
}
