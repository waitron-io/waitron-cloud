import {createPublicKey} from 'node:crypto';
import {isAbsolute,normalize} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '@waitron-cloud/registration';
import {isUuid,type AcceptedGatewayManifest,type ManifestEnvelope} from './manifest.ts';
import {routeBinding} from './forward-report.ts';
import {trafficEnvelopeLifecycle,trafficManifestDigest,verifyTrafficLifecycle} from './traffic-lifecycle.ts';

export interface TrafficMapping {country:'ES';environment:'test';cellId:string;directory:string;writerUid:number;readerGid:number}
function fail(code='traffic_authority_unavailable'):never{throw new Error(code);}
export function validateTrafficMapping(value:unknown):asserts value is TrafficMapping {
 if(!value||typeof value!=='object'||Array.isArray(value))fail();const m=value as TrafficMapping;
 if(Object.keys(m).sort().join(',')!=='cellId,country,directory,environment,readerGid,writerUid'||m.country!=='ES'||m.environment!=='test'||!isUuid(m.cellId)
  ||typeof m.directory!=='string'||!isAbsolute(m.directory)||normalize(m.directory)!==m.directory
  ||!Number.isSafeInteger(m.writerUid)||m.writerUid<0||!Number.isSafeInteger(m.readerGid)||m.readerGid<0)fail();
}

/** Expected serving authority is country evidence, separate from the exporter's signed claims. */
export class TrafficCoverageStore {
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}
 async expect(client:PoolClient,manifest:AcceptedGatewayManifest):Promise<void>{
  if(manifest.version!==2||!isUuid(manifest.cellId)||!Number.isSafeInteger(manifest.sequence)||manifest.sequence<1
   ||!Number.isSafeInteger(manifest.issuedAt)||manifest.issuedAt<0||!Number.isSafeInteger(manifest.expiresAt)
   ||manifest.expiresAt<=manifest.issuedAt||manifest.expiresAt-manifest.issuedAt>600000)fail();
  const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR SHARE',[manifest.cellId])).rows[0];
  const reporter=(await client.query('SELECT * FROM remote_forward_reporters WHERE cell_id=$1 FOR SHARE',[manifest.cellId])).rows[0];
  const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  if(!cell||cell.country!=='ES'||cell.environment!=='test'||!reporter||reporter.revoked_at||reporter.gateway_id!==manifest.reporter.gatewayId
   ||Number(reporter.generation)!==manifest.reporter.generation||manifest.sequence<Number(reporter.minimum_manifest_sequence)
   ||manifest.sequence>Number(cell.sequence)||manifest.expiresAt<=now.getTime()||manifest.issuedAt>now.getTime()+60000)fail();
  const digest=trafficManifestDigest(manifest);
  const base=[manifest.cellId,manifest.reporter.gatewayId,manifest.reporter.generation,digest,manifest.sequence,new Date(manifest.issuedAt),new Date(manifest.expiresAt)];
  if(!manifest.routes.length){
   await client.query(`INSERT INTO remote_traffic_coverage(cell_id,gateway_id,generation,manifest_digest,manifest_sequence,issued_at,expires_at,kind)
    VALUES($1,$2,$3,$4,$5,$6,$7,'empty') ON CONFLICT DO NOTHING`,base);return;
  }
  for(const route of manifest.routes){
   const scope=(await client.query(`SELECT v.organisation_id,v.legal_business_id FROM venues v JOIN installations i ON i.venue_id=v.id
    WHERE v.id=$1 AND i.id=$2 AND v.environment='test'`,[route.venueId,route.installationId])).rows[0];if(!scope)fail();
   for(const channel of ['staff','public'])await client.query(`INSERT INTO remote_traffic_coverage
    (cell_id,gateway_id,generation,manifest_digest,manifest_sequence,issued_at,expires_at,kind,organisation_id,legal_business_id,venue_id,installation_id,configuration_revision,route_binding,channel)
    VALUES($1,$2,$3,$4,$5,$6,$7,'route',$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
    [...base,scope.organisation_id,scope.legal_business_id,route.venueId,route.installationId,route.revision,routeBinding(route),channel]);
  }
 }
 async recordLifecycle(mapping:TrafficMapping,envelope:unknown):Promise<void>{
  validateTrafficMapping(mapping);const value=trafficEnvelopeLifecycle(envelope),e=envelope as ManifestEnvelope;
  if(value.cellId!==mapping.cellId)fail();
  await transaction(this.#pool,async client=>{
   // Cell and reporter locks precede process locks, matching reporter rotation and publication.
   const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR SHARE',[mapping.cellId])).rows[0];
   const reporter=(await client.query('SELECT * FROM remote_forward_reporters WHERE cell_id=$1 FOR UPDATE',[mapping.cellId])).rows[0];
   const saved=(await client.query('SELECT * FROM remote_traffic_processes WHERE process_id=$1 FOR UPDATE',[value.processId])).rows[0];
   if(saved){
    if(saved.cell_id!==mapping.cellId||saved.country!==mapping.country||saved.environment!==mapping.environment
     ||saved.gateway_id!==value.gatewayId||Number(saved.generation)!==value.generation)fail('traffic_lifecycle_conflict');
    verifyTrafficLifecycle(envelope,createPublicKey(saved.reporter_public_key));
    // Accepted retries survive rotation and expiry; they neither reopen nor extend a process.
    const payload=value.kind==='start'?saved.start_payload:saved.end_payload,signature=value.kind==='start'?saved.start_signature:saved.end_signature;
    if(payload===e.payload&&signature===e.signature)return;
    if(value.kind==='start'||saved.end_payload!==null||saved.start_manifest_digest!==value.manifestDigest
     ||saved.started_at.toISOString()!==value.startedAt||saved.predecessor_id!==value.predecessorId
     ||value.finalSequence!<Number(saved.last_sequence)||Date.parse(value.endedAt!)<saved.last_until.getTime())fail('traffic_lifecycle_conflict');
   }
   if(!cell||cell.country!==mapping.country||cell.environment!==mapping.environment||!reporter||reporter.revoked_at
    ||reporter.gateway_id!==value.gatewayId||Number(reporter.generation)!==value.generation)fail();
   verifyTrafficLifecycle(envelope,createPublicKey(reporter.public_key));
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(Date.parse(value.startedAt)>now.getTime()+5000||value.endedAt!==null&&Date.parse(value.endedAt)>now.getTime()+5000)fail();
   if(value.kind==='end'){
    if(!saved)fail();
    await client.query(`UPDATE remote_traffic_processes SET ended_at=$2,final_sequence=$3,end_payload=$4,end_signature=$5 WHERE process_id=$1`,
     [value.processId,value.endedAt,value.finalSequence,e.payload,e.signature]);return;
   }
   const expected=(await client.query(`SELECT 1 FROM remote_traffic_coverage WHERE cell_id=$1 AND gateway_id=$2 AND generation=$3
    AND manifest_digest=$4 AND issued_at<=$5 AND expires_at>$5 AND expires_at>$6 LIMIT 1`,
    [value.cellId,value.gatewayId,value.generation,value.manifestDigest,value.startedAt,now])).rowCount;
   if(!expected)fail();
   if(value.predecessorId!==null){
    const prior=(await client.query('SELECT cell_id,started_at FROM remote_traffic_processes WHERE process_id=$1',[value.predecessorId])).rows[0];
    if(!prior||prior.cell_id!==value.cellId||prior.started_at.getTime()>Date.parse(value.startedAt))fail();
   }
   await client.query(`INSERT INTO remote_traffic_processes
    (cell_id,gateway_id,generation,process_id,reporter_public_key,start_manifest_digest,started_at,start_payload,start_signature,predecessor_id,last_until)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7)`,
    [value.cellId,value.gatewayId,value.generation,value.processId,reporter.public_key,value.manifestDigest,value.startedAt,e.payload,e.signature,value.predecessorId]);
  });
 }
}
