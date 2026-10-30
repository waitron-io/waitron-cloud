import {createPublicKey} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction,type PlanMode} from '@waitron-cloud/registration';
import {isUuid,type GatewayRoute} from './manifest.ts';
import {routeBinding,verifyForwardReport,type ForwardObservation,type PublicForwardView} from './forward-report.ts';
import {eligibleRemoteInstallations} from './plan-permissions.ts';
import type {ForwardReportMapping} from './forward-report-collector.ts';

const fail=():never=>{throw new Error('invalid_forward_reporter');};
export async function registerForwardReporter(client:PoolClient,input:{cellId:string;gatewayId:string;generation:number;publicKey:string}):Promise<void>{
 if(!isUuid(input.cellId)||!isUuid(input.gatewayId)||!Number.isSafeInteger(input.generation)||input.generation<1||typeof input.publicKey!=='string'||input.publicKey.length>256)fail();
 let publicKey='';try{const key=createPublicKey(input.publicKey);if(key.asymmetricKeyType!=='ed25519')fail();publicKey=key.export({type:'spki',format:'pem'}).toString();}catch{fail();}
 const cell=(await client.query('SELECT sequence FROM remote_cells WHERE id=$1 FOR UPDATE',[input.cellId])).rows[0];if(!cell||Number(cell.sequence)>=Number.MAX_SAFE_INTEGER)fail();
 const old=(await client.query('SELECT generation,public_key FROM remote_forward_reporters WHERE cell_id=$1 FOR UPDATE',[input.cellId])).rows[0];
 if(input.generation!==(old?Number(old.generation)+1:1)||old?.public_key===publicKey)fail();
 await client.query(`INSERT INTO remote_forward_reporters(cell_id,gateway_id,generation,public_key,minimum_manifest_sequence)
  VALUES($1,$2,$3,$4,$5) ON CONFLICT(cell_id) DO UPDATE SET gateway_id=EXCLUDED.gateway_id,generation=EXCLUDED.generation,
  public_key=EXCLUDED.public_key,minimum_manifest_sequence=EXCLUDED.minimum_manifest_sequence,last_sequence=0,next_accept_at='-infinity',revoked_at=NULL`,[input.cellId,input.gatewayId,input.generation,publicKey,Number(cell.sequence)+1]);
}
export async function revokeForwardReporter(client:PoolClient,cellId:string,generation:number):Promise<void>{
 if(!isUuid(cellId)||!Number.isSafeInteger(generation)||generation<1)fail();
 if(!(await client.query('SELECT id FROM remote_cells WHERE id=$1 FOR UPDATE',[cellId])).rowCount)fail();
 const current=(await client.query('SELECT generation FROM remote_forward_reporters WHERE cell_id=$1 FOR UPDATE',[cellId])).rows[0];if(!current||Number(current.generation)!==generation)fail();
 await client.query('UPDATE remote_forward_reporters SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE cell_id=$1',[cellId]);
}
async function lockInstallations(client:PoolClient,ids:string[],mode:PlanMode):Promise<Set<string>|undefined>{
 if(mode==='test-venue-levels')return new Set(await eligibleRemoteInstallations(client,mode,undefined,{installationIds:ids}));
 // A batch can span organisations. Sorted policy locks precede every installation and cell lock.
 await client.query(`SELECT o.id FROM organisations o WHERE EXISTS(SELECT 1 FROM venues v JOIN installations i ON i.venue_id=v.id
  WHERE v.organisation_id=o.id AND i.id=ANY($1::uuid[])) ORDER BY o.id FOR SHARE OF o`,[ids]);
 await client.query('SELECT id FROM installations WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[ids]);
}
async function currentRoute(client:PoolClient,id:string,mode:PlanMode,eligible?:Set<string>){
 if(mode==='test-venue-levels'&&!eligible?.has(id))return;
 return (await client.query(`SELECT p.cell_id AS "cellId",p.installation_id AS "installationId",p.venue_id AS "venueId",host(p.address) AS address,
  p.port,p.peer_public_key AS "peerPublicKey",s.hostname AS "staffHostname",u.hostname AS "publicHostname",i.configuration_revision AS revision,v.environment
  FROM installations i JOIN venues v ON v.id=i.venue_id JOIN organisations o ON o.id=v.organisation_id
  JOIN remote_placements p ON p.installation_id=i.id AND p.venue_id=i.venue_id
  JOIN remote_hostnames s ON s.venue_id=i.venue_id AND s.kind='staff' JOIN remote_hostnames u ON u.venue_id=i.venue_id AND u.kind='public'
  JOIN installation_services service ON service.installation_id=i.id AND service.service='remote_access' AND service.state<>'unconfigured'
  WHERE i.id=$1 AND i.revoked_at IS NULL AND i.superseded_by IS NULL AND ($2 IN ('existing','test-venue-levels') OR (o.service_plan='paid' AND v.environment='test'))`,[id,mode])).rows[0];
}
type Row=Record<string,any>;
function bound(observation:ForwardObservation,route:Row|undefined,cell:Row|undefined,reporter:Row|undefined,now:number):boolean{
 return !!route&&!!cell&&!!reporter&&!reporter.revoked_at&&cell.country==='ES'&&cell.environment===route.environment
  &&route.cellId===observation.cellId&&route.installationId===observation.installationId&&route.venueId===observation.venueId
  &&Number(route.revision)===observation.revision&&routeBinding(route as GatewayRoute)===observation.routeBinding
  &&reporter.gateway_id===observation.gatewayId&&Number(reporter.generation)===observation.generation
  &&observation.manifestSequence>=Number(reporter.minimum_manifest_sequence)&&observation.manifestSequence<=Number(cell.sequence)
  &&observation.observedAt<=now+5000&&observation.manifestExpiresAt>observation.observedAt&&observation.manifestExpiresAt<=observation.observedAt+600000
  &&observation.expiresAt===Math.min(observation.observedAt+300000,observation.manifestExpiresAt)&&observation.expiresAt>now;
}
function fromRow(row:Row):ForwardObservation{
 return {cellId:row.cell_id,gatewayId:row.gateway_id,generation:Number(row.generation),installationId:row.installation_id,venueId:row.venue_id,
  revision:Number(row.configuration_revision),routeId:row.route_id,routeBinding:row.route_binding,manifestSequence:Number(row.manifest_sequence),
  manifestExpiresAt:row.manifest_expires_at.getTime(),observationSequence:Number(row.observation_sequence),category:row.category,observedAt:row.observed_at.getTime(),expiresAt:row.expires_at.getTime()};
}
export class ForwardObservationStore {
 readonly #pool:Pool;readonly #mode:PlanMode;
 constructor(pool:Pool,planMode:PlanMode='existing'){if(!['existing','test-free-paid','test-venue-levels'].includes(planMode))fail();this.#pool=pool;this.#mode=planMode;}
 async record(mapping:ForwardReportMapping,envelope:unknown):Promise<'accepted'|'ignored'>{
  if(mapping.country!=='ES'||!['test','production'].includes(mapping.environment)||!isUuid(mapping.cellId))return 'ignored';
  return transaction(this.#pool,async client=>{
   const initial=(await client.query('SELECT public_key FROM remote_forward_reporters WHERE cell_id=$1',[mapping.cellId])).rows[0];if(!initial)return 'ignored';
   let report;try{report=verifyForwardReport(envelope,createPublicKey(initial.public_key),(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime());}catch{return 'ignored';}
   if(report.cellId!==mapping.cellId)return 'ignored';
   const eligible=await lockInstallations(client,report.observations.map(o=>o.installationId),this.#mode);
   const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR SHARE',[mapping.cellId])).rows[0];
   const reporter=(await client.query('SELECT * FROM remote_forward_reporters WHERE cell_id=$1 FOR UPDATE',[mapping.cellId])).rows[0];
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(!cell||cell.country!==mapping.country||cell.environment!==mapping.environment||!reporter||reporter.revoked_at||reporter.gateway_id!==report.gatewayId
    ||Number(reporter.generation)!==report.generation||Number(reporter.last_sequence)>=report.sequence||reporter.next_accept_at>now)return 'ignored';
   try{report=verifyForwardReport(envelope,createPublicKey(reporter.public_key),now.getTime());}catch{return 'ignored';}
   for(const observation of report.observations){
    const route=await currentRoute(client,observation.installationId,this.#mode,eligible);if(!bound(observation,route,cell,reporter,now.getTime()))continue;
    const prior=(await client.query('SELECT * FROM remote_forward_observations WHERE venue_id=$1 FOR UPDATE',[observation.venueId])).rows[0];
    if(prior){
     const sameStream=prior.cell_id===observation.cellId&&prior.gateway_id===observation.gatewayId&&Number(prior.generation)===observation.generation;
     if(observation.observedAt<prior.observed_at.getTime()||(sameStream&&observation.observationSequence<=Number(prior.observation_sequence)))continue;
    }
    await client.query(`INSERT INTO remote_forward_observations(venue_id,installation_id,cell_id,gateway_id,generation,route_id,configuration_revision,route_binding,
     manifest_sequence,manifest_expires_at,observation_sequence,category,observed_at,received_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(venue_id) DO UPDATE SET
     installation_id=EXCLUDED.installation_id,cell_id=EXCLUDED.cell_id,gateway_id=EXCLUDED.gateway_id,generation=EXCLUDED.generation,route_id=EXCLUDED.route_id,
     configuration_revision=EXCLUDED.configuration_revision,route_binding=EXCLUDED.route_binding,manifest_sequence=EXCLUDED.manifest_sequence,
     manifest_expires_at=EXCLUDED.manifest_expires_at,observation_sequence=EXCLUDED.observation_sequence,category=EXCLUDED.category,
     observed_at=EXCLUDED.observed_at,received_at=EXCLUDED.received_at,expires_at=EXCLUDED.expires_at`,[observation.venueId,observation.installationId,observation.cellId,observation.gatewayId,
     observation.generation,observation.routeId,observation.revision,observation.routeBinding,observation.manifestSequence,new Date(observation.manifestExpiresAt),observation.observationSequence,
     observation.category,new Date(observation.observedAt),now,new Date(observation.expiresAt)]);
   }
   await client.query("UPDATE remote_forward_reporters SET last_sequence=$2,next_accept_at=$3::timestamptz+interval '30 seconds' WHERE cell_id=$1",[mapping.cellId,report.sequence,now]);
   return 'accepted';
  });
 }
 async readCurrent(client:PoolClient,installationId:string):Promise<PublicForwardView|null>{
  if(!isUuid(installationId))return null;
  const eligible=await lockInstallations(client,[installationId],this.#mode);const route=await currentRoute(client,installationId,this.#mode,eligible);if(!route)return null;
  const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR SHARE',[route.cellId])).rows[0];
  const reporter=(await client.query('SELECT * FROM remote_forward_reporters WHERE cell_id=$1 FOR SHARE',[route.cellId])).rows[0];
  const row=(await client.query('SELECT * FROM remote_forward_observations WHERE installation_id=$1',[installationId])).rows[0];if(!row)return null;
  const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now,observation=fromRow(row);
  return bound(observation,route,cell,reporter,now.getTime())?{category:observation.category,observedAt:row.observed_at.toISOString(),expiresAt:row.expires_at.toISOString()}:null;
 }
 async prune(cellId:string):Promise<number>{
  if(!isUuid(cellId))fail();
  return transaction(this.#pool,async client=>{
   // Cleanup takes no policy, installation or cell locks after locking observations.
   const rows=(await client.query(`SELECT f.venue_id FROM remote_forward_observations f
    LEFT JOIN remote_forward_reporters r ON r.cell_id=f.cell_id LEFT JOIN installations i ON i.id=f.installation_id
    LEFT JOIN remote_placements p ON p.installation_id=f.installation_id
    LEFT JOIN venues v ON v.id=f.venue_id LEFT JOIN organisations o ON o.id=v.organisation_id
    LEFT JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access'
    WHERE f.cell_id=$1 AND (f.expires_at<=clock_timestamp() OR r.cell_id IS NULL OR r.revoked_at IS NOT NULL OR r.gateway_id<>f.gateway_id OR r.generation<>f.generation
     OR i.revoked_at IS NOT NULL OR i.superseded_by IS NOT NULL OR i.configuration_revision<>f.configuration_revision OR p.cell_id IS DISTINCT FROM f.cell_id
     OR s.state IS NULL OR s.state='unconfigured' OR ($2='test-free-paid' AND (o.service_plan<>'paid' OR v.environment<>'test')))
    ORDER BY f.venue_id LIMIT 64 FOR UPDATE OF f SKIP LOCKED`,[cellId,this.#mode])).rows;
   if(!rows.length)return 0;
   return (await client.query('DELETE FROM remote_forward_observations WHERE venue_id=ANY($1::uuid[])',[rows.map(r=>r.venue_id)])).rowCount??0;
  });
 }
}
