import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {TranslationError} from './errors.ts';
import {collectPage,maxCollectBytes,validateCollectLimit,type BatchResults} from './collect-page.ts';
import type {SubmitFingerprint} from './submit-proof.ts';
import {translationModel,translationPromptVersion,translationProvider} from './service.ts';
function fail(code:ConstructorParameters<typeof TranslationError>[0],fits?:number):never{throw new TranslationError(code,fits);}
export type JobState='queued'|'running'|'done'|'partly_done'|'failed'|'collected'|'expired';
export interface ItemResult {ref:string;names:Record<string,string>;placeholder:boolean;corrections:{field:string;wrong:string;right:string}[]}
export interface JobRow {id:string;installation_id:string;venue_id:string;operation_id:string;job_sha256:string;job_bytes:number;state:JobState;reason:string|null;
 total:number;done:number;failed:number;input_tokens:string;output_tokens:string;cost_micro_usd:string;review_applied:number;review_dropped:number;
 provider:string;model:string;prompt_version:string;lease_id:string|null;lease_until:Date|null;lease_count:number;
 created_at:Date;started_at:Date|null;finished_at:Date|null;collected_at:Date|null}
export async function lockVenue(client:PoolClient,venueId:string){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-venue:'||$1,0))",[venueId]);}
export async function findSubmitted(client:PoolClient,installationId:string,operationId:string,f:SubmitFingerprint){
 const row=(await client.query<JobRow>('SELECT * FROM translation_jobs WHERE installation_id=$1 AND operation_id=$2',[installationId,operationId])).rows[0];
 if(row&&(row.job_sha256!==f.jobSha256||row.job_bytes!==f.jobBytes))fail('conflict');
 return row;
}
export async function spendingPolicy(client:PoolClient){
 const r=(await client.query('SELECT monthly_cap_micro_usd::text AS cap,estimate_micro_usd_per_item::text AS per FROM translation_policy')).rows[0];
 if(!r)throw new Error('translation_policy_missing');return {cap:BigInt(r.cap),perItem:BigInt(r.per)};
}
export async function monthSpend(client:PoolClient,venueId:string):Promise<bigint>{
 return BigInt((await client.query(`SELECT COALESCE(sum(cost_micro_usd),0)::text AS spent FROM translation_jobs
  WHERE venue_id=$1 AND created_at>=date_trunc('month',clock_timestamp(),'UTC')`,[venueId])).rows[0].spent);
}
export async function createJob(client:PoolClient,input:{installationId:string;venueId:string;operationId:string;fingerprint:SubmitFingerprint;body:string;total:number}){
 if((await client.query("SELECT 1 FROM translation_jobs WHERE venue_id=$1 AND state IN ('queued','running')",[input.venueId])).rowCount)fail('job_running');
 const {cap,perItem}=await spendingPolicy(client),left=cap-await monthSpend(client,input.venueId),total=BigInt(input.total);
 if(total*perItem>left){const fits=left<=0n?0n:left/perItem;fail('limit_reached',Number(fits<total?fits:total));}
 const row=(await client.query<JobRow>(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,total,provider,model,prompt_version)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[randomUUID(),input.installationId,input.venueId,input.operationId,input.fingerprint.jobSha256,input.fingerprint.jobBytes,input.total,translationProvider,translationModel,translationPromptVersion])).rows[0]!;
 await client.query('INSERT INTO translation_job_bodies(job_id,body) VALUES($1,$2)',[row.id,input.body]);
 return row;
}
export function submitView(r:JobRow){return {version:1,jobId:r.id,state:r.state,total:r.total};}
export function statusView(r:JobRow){return {version:1,jobId:r.id,state:r.state,total:r.total,done:r.done,failed:r.failed,...((r.state==='partly_done'||r.state==='failed')&&r.reason?{reason:r.reason}:{})};}
export async function readJob(client:PoolClient,installationId:string,jobId:string){
 const row=(await client.query<JobRow>('SELECT * FROM translation_jobs WHERE id=$1 AND installation_id=$2 FOR UPDATE',[jobId,installationId])).rows[0];
 return row??fail('job_not_found');
}
export async function collectJob(client:PoolClient,row:JobRow,cursor:unknown=0,byteLimit:number=maxCollectBytes){
 validateCollectLimit(byteLimit);
 if(!Number.isSafeInteger(cursor)||Number(cursor)<0||Number(cursor)>=row.total)fail('invalid_request');
 if(row.state==='collected'||row.state==='expired')fail('expired');
 if(row.state!=='done'&&row.state!=='partly_done')fail('not_ready');
 const stored=(await client.query('SELECT body,batch_results FROM translation_job_bodies WHERE job_id=$1',[row.id])).rows[0];
 if(!stored)fail('expired');
 const items=JSON.parse(stored.body).items as {ref:string;missing:string[]}[];
 if(items.filter(item=>item.missing.length>0).length!==row.total)throw new Error('translation_outcomes_invalid');
 return collectPage(row.id,row.state,items,stored.batch_results as BatchResults,cursor,byteLimit);
}
export async function releaseJob(client:PoolClient,row:JobRow){
 if(row.state==='expired')fail('expired');
 if(row.state==='queued'||row.state==='running')fail('not_ready');
 if(row.state!=='collected'){
  await client.query('DELETE FROM translation_job_bodies WHERE job_id=$1',[row.id]);
  await client.query("UPDATE translation_jobs SET state='collected',collected_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=$1",[row.id]);
 }
 return {version:1,jobId:row.id,state:'collected'};
}
