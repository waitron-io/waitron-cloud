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
   (SELECT max(p.captured_at) FROM backup_points p WHERE p.venue_id=v.id AND p.kind='snapshot' AND p.verification='verified' AND NOT p.deleting AND p.deleted_at IS NULL) AS verified_snapshot_at
   FROM venues v JOIN organisations o ON o.id=v.organisation_id JOIN legal_businesses b ON b.id=v.legal_business_id
   WHERE v.id=ANY($1::uuid[]) AND v.organisation_id=ANY($2::uuid[])`,[installations.map(i=>i.venueId),memberships.rows.map(m=>m.organisation_id)]);
  const result=installations.flatMap(i=>{const row=rows.rows.find(r=>r.id===i.venueId&&r.organisation_id===i.organisationId);if(!row)return [];
   return [{...i,canRevoke:memberships.rows.find(m=>m.organisation_id===i.organisationId).is_owner,overview:{organisationName:row.organisation_name?.trim()??i.organisationId,businessName:row.business_name?.trim()??i.legalBusinessId,countryCode:row.country_code,latestSnapshotAt:row.latest_snapshot_at?.toISOString()??null,verifiedSnapshotAt:row.verified_snapshot_at?.toISOString()??null}}];});
  await resolveSession(client,token,{touch:false});return result;
 });
}
