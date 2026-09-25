import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction,type InstallationView} from '@waitron-cloud/registration';
/** Recheck authority after lifecycle reads; overview metadata never contains storage authority. */
export async function venueOverview(pool:Pool,token:string,installations:InstallationView[]){
 return transaction(pool,async client=>{
  const session=await resolveSession(client,token,{touch:false});
  const memberships=await client.query('SELECT organisation_id,is_owner FROM organisation_memberships WHERE account_id=$1 FOR SHARE',[session.accountId]);
  const rows=await client.query(`SELECT v.id,v.organisation_id,o.name AS organisation_name,b.name AS business_name,b.country_code,
   (SELECT max(p.captured_at) FROM backup_points p WHERE p.venue_id=v.id AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL) AS latest_snapshot_at,
   (SELECT max(p.captured_at) FROM backup_points p WHERE p.venue_id=v.id AND p.kind='snapshot' AND p.verification='verified' AND NOT p.deleting AND p.deleted_at IS NULL) AS verified_snapshot_at,
   mon.checked_at,COALESCE(mon.checked_at>clock_timestamp()-interval '5 minutes',false) AS monitor_fresh,
   (v.environment='test' AND n.revoked_at IS NULL AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=n.id AND s.state<>'unconfigured')) AS monitor_enabled,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',x.kind,'openedAt',x.opened_at,'changedAt',x.changed_at) ORDER BY x.kind) FROM venue_incidents x WHERE x.venue_id=v.id AND x.status='open'
    AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=n.id AND s.state<>'unconfigured'
     AND (x.kind='disconnected' OR (x.kind IN ('snapshot_stale','verification_failed') AND s.service='retained_snapshots')))),'[]') AS incidents
   FROM venues v JOIN organisations o ON o.id=v.organisation_id JOIN legal_businesses b ON b.id=v.legal_business_id JOIN installations n ON n.venue_id=v.id AND n.superseded_by IS NULL LEFT JOIN venue_monitors mon ON mon.venue_id=v.id
   WHERE v.id=ANY($1::uuid[]) AND v.organisation_id=ANY($2::uuid[])`,[installations.map(i=>i.venueId),memberships.rows.map(m=>m.organisation_id)]);
  const result=installations.flatMap(i=>{const row=rows.rows.find(r=>r.id===i.venueId&&r.organisation_id===i.organisationId);if(!row)return [];
   return [{...i,monitoring:{enabled:row.monitor_enabled,fresh:row.monitor_fresh,checkedAt:row.checked_at?.toISOString()??null,incidents:row.monitor_enabled?row.incidents:[]},canRevoke:memberships.rows.find(m=>m.organisation_id===i.organisationId).is_owner,overview:{organisationName:row.organisation_name?.trim()??i.organisationId,businessName:row.business_name?.trim()??i.legalBusinessId,countryCode:row.country_code,latestSnapshotAt:row.latest_snapshot_at?.toISOString()??null,verifiedSnapshotAt:row.verified_snapshot_at?.toISOString()??null}}];});
  await resolveSession(client,token,{touch:false});return result;
 });
}
