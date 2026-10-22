import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
import {readBoundedJsonObject} from './request.ts';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const timestamp=(value:Date|null)=>value?.toISOString()??null;
async function diagnostic(client:PoolClient,accountId:string,installationId:string){
 const row=(await client.query(`SELECT i.id,i.venue_id,v.environment,i.configuration_revision,i.revoked_at,i.last_contact_at,i.lease_expires_at,clock_timestamp() AS generated_at
  FROM installations i JOIN venues v ON v.id=i.venue_id JOIN organisation_memberships m ON m.organisation_id=v.organisation_id
  WHERE i.id=$1 AND m.account_id=$2 AND m.is_owner FOR SHARE OF i`,[installationId,accountId])).rows[0];
 if(!row)throw new AccountHttpError(403,'forbidden');
 const services=(await client.query(`SELECT s.service,s.state,
  CASE WHEN i.revoked_at IS NULL AND o.revision=i.configuration_revision AND o.received_at>clock_timestamp()-interval '5 minutes'
    AND o.observed_at>clock_timestamp()-interval '5 minutes' THEN o.health ELSE 'unknown' END AS health,o.observed_at
  FROM installation_services s JOIN installations i ON i.id=s.installation_id
  LEFT JOIN installation_observations o ON o.installation_id=s.installation_id AND o.service=s.service
  WHERE s.installation_id=$1 AND s.service<>'content_translation' ORDER BY s.service`,[installationId])).rows;
 const monitor=(await client.query(`SELECT m.checked_at,COALESCE(m.checked_at>clock_timestamp()-interval '5 minutes',false) AS fresh,
  EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=$2 AND s.state<>'unconfigured' AND s.service<>'content_translation') AS enabled
  FROM (SELECT $1::uuid AS venue_id) target LEFT JOIN venue_monitors m ON m.venue_id=target.venue_id`,[row.venue_id,installationId])).rows[0];
 const incidents=(await client.query("SELECT kind,opened_at,changed_at FROM venue_incidents WHERE venue_id=$1 AND status='open' ORDER BY kind",[row.venue_id])).rows;
 const remoteRows=(await client.query(`SELECT service.kind,r.status,r.checked_at,r.certificate_not_after,
  COALESCE(r.checked_at>clock_timestamp()-interval '5 minutes',false) AS fresh
  FROM (VALUES('public'::text),('staff'::text)) service(kind)
  LEFT JOIN remote_placements p ON p.installation_id=$1 AND p.venue_id=$2
  LEFT JOIN remote_hostnames h ON h.venue_id=p.venue_id AND h.kind=service.kind
  LEFT JOIN remote_probe_observations r ON r.installation_id=p.installation_id AND r.venue_id=p.venue_id AND r.service=service.kind
   AND r.configuration_revision=$3 AND r.hostname=h.hostname ORDER BY service.kind`,[installationId,row.venue_id,row.configuration_revision])).rows;
 const backups=(await client.query(`SELECT max(p.captured_at) AS latest,
  max(p.captured_at) FILTER(WHERE q.current_verification='verified') AS verified FROM backup_points p
  LEFT JOIN backup_point_qualification q ON q.point_id=p.id
  WHERE p.installation_id=$1 AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL`,[installationId])).rows[0];
 const remoteChecks=Object.fromEntries(remoteRows.map(item=>[item.kind,item.checked_at?{status:item.fresh?item.status:'unknown',checkedAt:item.checked_at.toISOString(),certificateNotAfter:timestamp(item.certificate_not_after)}:null]));
 return {version:1 as const,generatedAt:row.generated_at.toISOString(),installation:{installationId:row.id,venueId:row.venue_id,environment:row.environment,revision:row.configuration_revision,
  access:{status:row.revoked_at?'revoked' as const:'active' as const,lastContactAt:timestamp(row.last_contact_at),leaseExpiresAt:timestamp(row.lease_expires_at)},
  services:services.map(item=>({service:item.service,state:item.state,health:item.health,observedAt:timestamp(item.observed_at)})),
  backups:{latestSnapshotAt:timestamp(backups.latest),verifiedSnapshotAt:timestamp(backups.verified)},
  monitoring:{enabled:monitor.enabled,fresh:monitor.fresh,checkedAt:timestamp(monitor.checked_at),
   incidents:incidents.map(item=>({kind:item.kind,openedAt:item.opened_at.toISOString(),changedAt:item.changed_at.toISOString()})),remoteChecks}}};
}

export async function diagnosticsResponse(c:Context,options:{pool:Pool;origin:string;secure:boolean;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 if(c.req.path!=='/api/account/diagnostics/read')throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==options.origin)throw new AccountHttpError(403,'forbidden');
 const body=await readBoundedJsonObject(c.req.raw),keys=Object.keys(body);
 if(keys.length!==1||keys[0]!=='installationId'||typeof body.installationId!=='string'||!uuid.test(body.installationId))throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,options.secure)??'',csrf=c.req.header('x-csrf-token')??'';
 const session=await transaction(options.pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
 await options.consume([{scope:'diagnostics-account',subject:session.accountId,limit:30,windowSeconds:60}]);
 return c.json(await transaction(options.pool,async client=>{
  const current=await resolveSession(client,token,{csrfToken:csrf,touch:false});
  const result=await diagnostic(client,current.accountId,body.installationId as string);
  await resolveSession(client,token,{csrfToken:csrf,touch:false});
  const permission=await client.query(`SELECT 1 FROM installations i JOIN venues v ON v.id=i.venue_id
   JOIN organisation_memberships m ON m.organisation_id=v.organisation_id WHERE i.id=$1 AND m.account_id=$2 AND m.is_owner FOR SHARE OF m`,[body.installationId,current.accountId]);
  if(!permission.rowCount)throw new AccountHttpError(403,'forbidden');return result;
 }));
}
