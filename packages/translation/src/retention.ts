import type {Pool} from 'pg';
import {transaction} from '@waitron-cloud/registration';
export async function sweepTranslationJobs(pool:Pool,limit=100):Promise<{expired:number}>{
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('translation_sweep_limit');
 return transaction(pool,async client=>{
  const ids=(await client.query<{id:string}>(`SELECT id FROM translation_jobs
   WHERE (state IN ('done','partly_done','failed') AND finished_at<=clock_timestamp()-interval '24 hours')
    OR (state IN ('queued','running') AND created_at<=clock_timestamp()-interval '24 hours')
   ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit])).rows.map(r=>r.id);
  if(!ids.length)return {expired:0};
  await client.query('DELETE FROM translation_job_bodies WHERE job_id=ANY($1::uuid[])',[ids]);
  await client.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE id=ANY($1::uuid[])",[ids]);
  return {expired:ids.length};
 });
}
