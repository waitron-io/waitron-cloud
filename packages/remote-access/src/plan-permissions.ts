import type {PoolClient} from 'pg';
import {readVenuePlan,type PlanMode} from '@waitron-cloud/registration';

// Acquire policy before installation, cell and job locks. Provisioning may restore
// cleared setup; other paid work requires that explicit provisioning first.
export async function requireRemotePlan(client:PoolClient,id:string,mode:PlanMode,setup=true):Promise<void>{
 if(mode==='existing')return;
 const row=(await client.query('SELECT venue_id FROM installations WHERE id=$1',[id])).rows[0];
 if(!row)throw new Error('installation_unavailable');
 if(await readVenuePlan(client,row.venue_id,mode)!=='paid')throw new Error('permission_denied');
 if(setup&&!(await client.query("SELECT 1 FROM installation_services WHERE installation_id=$1 AND service='remote_access' AND state<>'unconfigured'",[id])).rowCount)throw new Error('permission_denied');
}

// A route publication spans several organisations. Lock their policies in UUID
// order before reading setup. Only those locked organisations can enter this export;
// a concurrently created first placement waits for the next export.
export async function eligibleRemoteInstallations(client:PoolClient,mode:PlanMode):Promise<string[]|undefined>{
 if(mode==='existing')return;
 const policies=(await client.query(`SELECT o.id FROM organisations o WHERE EXISTS(SELECT 1 FROM venues v JOIN remote_placements p ON p.venue_id=v.id WHERE v.organisation_id=o.id) ORDER BY o.id FOR SHARE OF o`)).rows.map(row=>row.id);
 return (await client.query(`SELECT i.id FROM installations i JOIN venues v ON v.id=i.venue_id JOIN organisations o ON o.id=v.organisation_id
  JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access'
  WHERE v.organisation_id=ANY($1::uuid[]) AND o.service_plan='paid' AND v.environment='test' AND s.state<>'unconfigured' AND i.revoked_at IS NULL`,[policies])).rows.map(row=>row.id);
}
