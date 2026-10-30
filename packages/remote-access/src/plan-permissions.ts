import type {PoolClient} from 'pg';
import {readVenuePlan,readVenuePermissions,requireVenueService,type PlanMode} from '@waitron-cloud/registration';

// Acquire policy before installation, cell and job locks. Provisioning may restore
// cleared setup; other paid work requires that explicit provisioning first.
export async function requireRemotePlan(client:PoolClient,id:string,mode:PlanMode,setup=true):Promise<void>{
 if(mode==='existing')return;
 const row=(await client.query('SELECT venue_id FROM installations WHERE id=$1',[id])).rows[0];
 if(!row)throw new Error('installation_unavailable');
 if(mode==='test-venue-levels'){
  await requireVenueService(client,row.venue_id,'remote_access',mode);
  if(setup&&!(await client.query("SELECT 1 FROM installation_services WHERE installation_id=$1 AND service='remote_access' AND state<>'unconfigured'",[id])).rowCount)throw new Error('permission_denied');
  return;
 }
 if(await readVenuePlan(client,row.venue_id,mode)!=='paid')throw new Error('permission_denied',{cause:'remote_plan_required'});
 if(setup&&!(await client.query("SELECT 1 FROM installation_services WHERE installation_id=$1 AND service='remote_access' AND state<>'unconfigured'",[id])).rowCount)throw new Error('permission_denied',{cause:'remote_setup_required'});
}

// A route publication spans several organisations. Lock their policies in UUID
// order before reading setup. Only those locked organisations can enter this export;
// a concurrently created first placement waits for the next export. A cell export
// includes incoming moves, whose active placement still belongs to another cell.
type EligibilityScope={installationIds?:string[];lock?:'SHARE'|'UPDATE'|false};
export async function legacyRemoteExclusion(client:PoolClient,mode:PlanMode,knownInstalled?:boolean):Promise<string>{
 if(mode!=='test-free-paid')return '';
 const installed=knownInstalled??(await client.query(`SELECT to_regclass('billing_service_authority') IS NOT NULL
  OR EXISTS(SELECT 1 FROM schema_migrations WHERE name='046_venue_service_authority.sql') AS installed`)).rows[0].installed;
 return installed?' AND NOT EXISTS(SELECT 1 FROM billing_service_authority a WHERE a.venue_id=v.id)':'';
}
export async function eligibleRemoteInstallations(client:PoolClient,mode:PlanMode,cellId?:string,scope:EligibilityScope={}):Promise<string[]|undefined>{
 if(mode==='existing')return;
 if(mode==='test-venue-levels')return eligibleVenueInstallations(client,cellId,scope);
 const captured=await lockLegacyRemoteScope(client,cellId,scope.installationIds);
 const exclusion=await legacyRemoteExclusion(client,mode,captured.venue_authority);
 return (await client.query(`SELECT i.id FROM installations i JOIN venues v ON v.id=i.venue_id JOIN organisations o ON o.id=v.organisation_id
  JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access'
  WHERE v.organisation_id=ANY($1::uuid[]) AND v.id=ANY($2::uuid[]) AND o.service_plan='paid' AND v.environment='test' AND s.state<>'unconfigured' AND i.revoked_at IS NULL${exclusion}
  AND ($3::uuid[] IS NULL OR i.id=ANY($3::uuid[]))`,[captured.organisations,captured.venues,scope.installationIds??null])).rows.map(row=>row.id);
}

// Materialise every organisation lock before venue locks. The parent protects even
// absent authority; the next statement observes enrolment committed during a wait.
export async function lockLegacyRemoteScope(client:PoolClient,cellId?:string,installationIds?:string[]):Promise<{organisations:string[];venues:string[];venue_authority:boolean}>{
 return (await client.query(`WITH policies AS MATERIALIZED (
  SELECT o.id FROM organisations o WHERE EXISTS(
   SELECT 1 FROM venues v JOIN remote_placements p ON p.venue_id=v.id JOIN installations i ON i.id=p.installation_id AND i.venue_id=v.id
   WHERE v.organisation_id=o.id AND ($2::uuid[] IS NULL OR i.id=ANY($2::uuid[]))
   AND ($1::uuid IS NULL OR p.cell_id=$1 OR EXISTS(SELECT 1 FROM remote_cell_moves m
    WHERE m.installation_id=p.installation_id AND m.target_cell_id=$1 AND m.state IN ('staged','ready'))))
  ORDER BY o.id FOR SHARE OF o
 ), locked_venues AS MATERIALIZED (
  SELECT v.id FROM venues v WHERE v.organisation_id=ANY(ARRAY(SELECT id FROM policies))
  AND EXISTS(SELECT 1 FROM remote_placements p JOIN installations i ON i.id=p.installation_id AND i.venue_id=p.venue_id
   WHERE p.venue_id=v.id AND ($2::uuid[] IS NULL OR i.id=ANY($2::uuid[]))
   AND ($1::uuid IS NULL OR p.cell_id=$1 OR EXISTS(SELECT 1 FROM remote_cell_moves m
    WHERE m.installation_id=p.installation_id AND m.target_cell_id=$1 AND m.state IN ('staged','ready'))))
  ORDER BY v.id FOR SHARE OF v
 ) SELECT ARRAY(SELECT id FROM policies) AS organisations,ARRAY(SELECT id FROM locked_venues) AS venues,
  (to_regclass('billing_service_authority') IS NOT NULL
   OR EXISTS(SELECT 1 FROM schema_migrations WHERE name='046_venue_service_authority.sql')) AS venue_authority`,[cellId??null,installationIds??null])).rows[0];
}

// Capture bindings before locks, then lock every organisation and venue before any
// installation. Expiry can clear setup while reading the first venue's authority.
async function eligibleVenueInstallations(client:PoolClient,cellId:string|undefined,scope:EligibilityScope):Promise<string[]>{
 const candidates=(await client.query(`SELECT i.id,i.venue_id,v.organisation_id,v.legal_business_id
  FROM installations i JOIN venues v ON v.id=i.venue_id JOIN remote_placements p ON p.installation_id=i.id AND p.venue_id=i.venue_id
  WHERE ($1::uuid IS NULL OR p.cell_id=$1 OR EXISTS(SELECT 1 FROM remote_cell_moves m
   WHERE m.installation_id=i.id AND m.target_cell_id=$1 AND m.state IN ('staged','ready')))
  AND ($2::uuid[] IS NULL OR i.id=ANY($2::uuid[])) ORDER BY i.id`,[cellId??null,scope.installationIds??null])).rows;
 await client.query('SELECT id FROM organisations WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[candidates.map(r=>r.organisation_id)]);
 const venues=(await client.query('SELECT id,organisation_id,legal_business_id,environment FROM venues WHERE id=ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE',[candidates.map(r=>r.venue_id)])).rows;
 const allowed=new Set<string>();
 for(const venue of venues){
  if(venue.environment!=='test')continue;
  const permission=await readVenuePermissions(client,venue.id,'test-venue-levels');
  if(permission.level==='connected'||permission.level==='hosted')allowed.add(venue.id);
 }
 const lock=scope.lock===false?'':` FOR ${scope.lock??'SHARE'} OF i`;
 // A joined service keeps the statement's pre-wait snapshot. Lock installations
 // first, then read their setup in a new statement after the writer has committed.
 if(lock)await client.query(`SELECT i.id FROM installations i WHERE i.id=ANY($1::uuid[]) ORDER BY i.id${lock}`,[candidates.map(r=>r.id)]);
 const current=(await client.query(`SELECT i.id,i.venue_id,v.organisation_id,v.legal_business_id FROM installations i JOIN venues v ON v.id=i.venue_id
  JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access'
  WHERE i.id=ANY($1::uuid[]) AND i.revoked_at IS NULL AND i.superseded_by IS NULL AND s.state<>'unconfigured' ORDER BY i.id`,[candidates.map(r=>r.id)])).rows;
 const original=new Map(candidates.map(r=>[r.id,r]));
 return current.filter(row=>{
  const before=original.get(row.id);
  return before&&allowed.has(row.venue_id)&&row.venue_id===before.venue_id&&row.organisation_id===before.organisation_id&&row.legal_business_id===before.legal_business_id;
 }).map(row=>row.id);
}
