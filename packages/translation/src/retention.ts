import type {Pool} from 'pg';
import {releaseUnstartedAllowance,transaction} from '@waitron-cloud/registration';
export async function sweepTranslationJobs(pool:Pool,limit=100):Promise<{expired:number}>{
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('translation_sweep_limit');
 return transaction(pool,async client=>{
  const ids=(await client.query<{id:string}>(`SELECT id FROM translation_jobs
   WHERE (state IN ('done','partly_done','failed') AND finished_at<=clock_timestamp()-interval '24 hours')
    OR (state IN ('queued','running') AND created_at<=clock_timestamp()-interval '24 hours')
   ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit])).rows.map(r=>r.id);
  if(!ids.length)return {expired:0};
  const unstarted=(await client.query(`SELECT r.id FROM billing_allowance_reservations r JOIN translation_jobs j
   ON j.installation_id=r.installation_id AND j.operation_id=r.operation_id AND j.venue_id=r.venue_id
   WHERE j.id=ANY($1::uuid[]) AND j.state='queued' AND j.started_at IS NULL AND j.lease_count=0 AND j.lease_id IS NULL AND j.allowance_open_calls=0
    AND r.service='content_translation' AND r.state='held' AND r.attempted_at IS NULL`,[ids])).rows;
  for(const row of unstarted)await releaseUnstartedAllowance(client,row.id);
  await client.query('DELETE FROM translation_job_bodies WHERE job_id=ANY($1::uuid[])',[ids]);
  await client.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE id=ANY($1::uuid[])",[ids]);
  return {expired:ids.length};
 });
}
