import {createHash,createPublicKey} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {BillingError,recordUsageEvent,transaction,type BillingScope,type CivilDate} from '@waitron-cloud/registration';
import {billingDate} from '../../registration/src/billing-config.ts';
import type {GatewayRoute,ManifestEnvelope} from './manifest.ts';
import {routeBinding} from './forward-report.ts';
import {eligibleRemoteInstallations} from './plan-permissions.ts';
import {validateTrafficMapping,type TrafficMapping} from './traffic-coverage.ts';
import {trafficEnvelopeReport,verifyTrafficReport,type TrafficReport} from './traffic-report.ts';

type Row=Record<string,any>;
type Receipt={state:'accepted'|'replay';processId:string;sequence:number};
type Interval=readonly [number,number];
type TrafficDays={complete:boolean;days:Array<{on:CivilDate;bytes:string}>};
function covers(intervals:Interval[],from:number,until:number):boolean {
 let cursor=from;
 for(const [start,end] of intervals.sort((a,b)=>a[0]-b[0])){
  if(start>cursor)return false;
  cursor=Math.max(cursor,end);if(cursor>=until)return true;
 }
 return cursor>=until;
}
const time=(value:Date):number=>value.getTime();
function fail(code='traffic_authority_unavailable'):never{throw new Error(code);}
function processBound(row:Row|undefined,mapping:TrafficMapping,report:TrafficReport):row is Row {
 return !!row&&row.cell_id===mapping.cellId&&row.country===mapping.country&&row.environment===mapping.environment
  &&row.gateway_id===report.gatewayId&&Number(row.generation)===report.generation;
}
async function replay(client:PoolClient,mapping:TrafficMapping,report:TrafficReport,envelope:ManifestEnvelope):Promise<Receipt|undefined>{
 const saved=(await client.query(`SELECT p.*,r.report_payload,r.report_signature FROM remote_traffic_reports r
  JOIN remote_traffic_processes p ON p.process_id=r.process_id WHERE r.process_id=$1 AND r.sequence=$2`,[report.processId,report.sequence])).rows[0];
 if(!saved)return;
 if(!processBound(saved,mapping,report))fail();
 verifyTrafficReport(envelope,createPublicKey(saved.reporter_public_key));
 if(saved.report_payload!==envelope.payload||saved.report_signature!==envelope.signature)fail('traffic_report_conflict');
 return {state:'replay',processId:report.processId,sequence:report.sequence};
}
async function currentRoute(client:PoolClient,installationId:string):Promise<Row|undefined>{
 return (await client.query(`SELECT p.cell_id AS "cellId",p.installation_id AS "installationId",p.venue_id AS "venueId",host(p.address) AS address,
  p.port,p.peer_public_key AS "peerPublicKey",s.hostname AS "staffHostname",u.hostname AS "publicHostname",i.configuration_revision AS revision,
  v.organisation_id,v.legal_business_id,v.environment
  FROM installations i JOIN venues v ON v.id=i.venue_id
  JOIN remote_placements p ON p.installation_id=i.id AND p.venue_id=i.venue_id
  JOIN remote_hostnames s ON s.venue_id=i.venue_id AND s.kind='staff'
  JOIN remote_hostnames u ON u.venue_id=i.venue_id AND u.kind='public'
  JOIN installation_services service ON service.installation_id=i.id AND service.service='remote_access' AND service.state<>'unconfigured'
  WHERE i.id=$1 AND i.revoked_at IS NULL AND i.superseded_by IS NULL`,[installationId])).rows[0];
}

/** Immutable report receipts include empty intervals; source, ledger and cursor commit together. */
export class TrafficStore {
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}
 async days(scope:BillingScope,venueId:string,from:CivilDate,until:CivilDate):Promise<TrafficDays>{
  billingDate(from);billingDate(until);if(from>=until)throw new BillingError('invalid_billing_input');
  const lower=Date.parse(from+'T00:00:00.000Z'),upper=Date.parse(until+'T00:00:00.000Z');
  return transaction(this.#pool,async client=>{
   // The journal, receipts, checkpoints and ledger must describe one committed snapshot.
   await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const venue=(await client.query('SELECT environment FROM venues WHERE id=$1 AND organisation_id=$2 AND legal_business_id=$3',
    [venueId,scope.organisationId,scope.legalBusinessId])).rows[0];
   if(!venue)throw new BillingError('billing_scope_not_found');if(venue.environment!=='test')fail();
   const cells=(await client.query(`SELECT DISTINCT cell_id FROM remote_traffic_coverage WHERE venue_id=$1 AND issued_at<$2
    UNION SELECT cell_id FROM remote_placements WHERE venue_id=$1`,[venueId,new Date(upper)])).rows.map(row=>row.cell_id);
   const incomplete:TrafficDays={complete:false,days:[]};if(!cells.length)return incomplete;
   const journal=(await client.query(`SELECT * FROM remote_traffic_coverage WHERE cell_id=ANY($1::uuid[])
    AND issued_at<$3 AND expires_at>$2`,[cells,new Date(lower),new Date(upper)])).rows;
   const processes=(await client.query(`WITH RECURSIVE lifetimes AS (
    SELECT * FROM remote_traffic_processes WHERE cell_id=ANY($1::uuid[]) AND started_at<$3 AND (ended_at IS NULL OR ended_at>$2)
    UNION SELECT p.* FROM remote_traffic_processes p JOIN lifetimes next ON p.process_id=next.predecessor_id
   ) SELECT * FROM lifetimes`,[cells,new Date(lower),new Date(upper)])).rows;
   const ids=processes.map(p=>p.process_id);
   const reports=(await client.query('SELECT * FROM remote_traffic_reports WHERE process_id=ANY($1::uuid[]) ORDER BY process_id,sequence',[ids])).rows;
   const samples=(await client.query(`SELECT * FROM remote_traffic_samples WHERE process_id=ANY($1::uuid[]) AND venue_id=$2
    AND organisation_id=$3 AND legal_business_id=$4 AND from_at<$6 AND until_at>$5`,
    [ids,venueId,scope.organisationId,scope.legalBusinessId,new Date(lower),new Date(upper)])).rows;
   for(const cell of cells){
    const authority=journal.filter(row=>row.cell_id===cell);
    if(!covers(authority.map(row=>[time(row.issued_at),time(row.expires_at)]),lower,upper))return incomplete;
   }
   for(const process of processes){
    const stop=Math.min(process.ended_at?time(process.ended_at):upper,upper);
    let cursor=time(process.started_at),sequence=0n;
    if(process.has_gap)return incomplete;
    for(const report of reports.filter(row=>row.process_id===process.process_id)){
     if(time(report.from_at)>=stop)break;
     if(BigInt(report.sequence)!==sequence+1n||time(report.from_at)!==cursor||!report.complete)return incomplete;
     cursor=time(report.until_at);sequence=BigInt(report.sequence);
    }
    if(cursor<stop)return incomplete;
    if(process.ended_at&&time(process.ended_at)<=upper&&BigInt(process.final_sequence)!==sequence)return incomplete;
    if(process.predecessor_id&&!processes.some(p=>p.process_id===process.predecessor_id&&p.ended_at!==null
     &&BigInt(p.final_sequence)===BigInt(p.last_sequence)&&time(p.last_until)===time(p.ended_at)))return incomplete;
   }
   const routes=journal.filter(row=>row.venue_id===venueId&&row.kind==='route');
   for(const route of routes){
    const start=Math.max(lower,time(route.issued_at)),stop=Math.min(upper,time(route.expires_at));
    const sameBinding=(row:Row)=>row.cell_id===route.cell_id&&row.gateway_id===route.gateway_id&&row.generation===route.generation
     &&row.installation_id===route.installation_id&&row.configuration_revision===route.configuration_revision&&row.route_binding===route.route_binding;
    if(!routes.some(row=>sameBinding(row)&&row.manifest_digest===route.manifest_digest&&row.channel!==route.channel))return incomplete;
    const serving=processes.filter(p=>p.cell_id===route.cell_id&&p.gateway_id===route.gateway_id&&p.generation===route.generation
     &&time(p.started_at)<stop&&(!p.ended_at||time(p.ended_at)>start));
    if(!covers(serving.map(p=>[time(p.started_at),p.ended_at?time(p.ended_at):upper]),start,stop))return incomplete;
    for(const process of serving){
     const a=Math.max(start,time(process.started_at)),b=Math.min(stop,process.ended_at?time(process.ended_at):upper);
     const channel=samples.filter(row=>row.process_id===process.process_id&&sameBinding(row)&&row.channel===route.channel&&row.complete);
     if(!covers(channel.map(row=>[time(row.from_at),time(row.until_at)]),a,b))return incomplete;
    }
   }
   const days=(await client.query(`SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS on,sum(quantity)::text AS bytes
    FROM usage_events WHERE organisation_id=$1 AND venue_id=$2 AND event_type='remote_access.traffic_bytes' AND source_kind='remote_traffic_sample'
    AND occurred_at>=$3 AND occurred_at<$4 GROUP BY 1 ORDER BY 1`,[scope.organisationId,venueId,new Date(lower),new Date(upper)])).rows;
   return {complete:true,days:days.map(row=>({on:row.on,bytes:row.bytes}))};
  });
 }
 async record(mapping:TrafficMapping,input:unknown):Promise<Receipt>{
  validateTrafficMapping(mapping);const report=trafficEnvelopeReport(input),envelope=input as ManifestEnvelope;
  if(report.cellId!==mapping.cellId)fail();
  return transaction(this.#pool,async client=>{
   // Immutable saved receipts have no current-policy side effects and survive retirement or rotation.
   const old=await replay(client,mapping,report,envelope);if(old)return old;
   const initial=(await client.query('SELECT * FROM remote_traffic_processes WHERE process_id=$1',[report.processId])).rows[0];
   if(!processBound(initial,mapping,report))fail();
   verifyTrafficReport(envelope,createPublicKey(initial.reporter_public_key));
   const eligible=new Set(await eligibleRemoteInstallations(client,'test-venue-levels',undefined,{installationIds:report.entries.map(e=>e.installationId)}));
   // Policy and installation locks precede cell/reporter/process locks, as on publication and rotation.
   const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR SHARE',[mapping.cellId])).rows[0];
   const reporter=(await client.query('SELECT * FROM remote_forward_reporters WHERE cell_id=$1 FOR UPDATE',[mapping.cellId])).rows[0];
   const process=(await client.query('SELECT * FROM remote_traffic_processes WHERE process_id=$1 FOR UPDATE',[report.processId])).rows[0];
   const concurrent=await replay(client,mapping,report,envelope);if(concurrent)return concurrent;
   if(!processBound(process,mapping,report)||!cell||cell.country!==mapping.country||cell.environment!==mapping.environment
    ||!reporter||reporter.revoked_at||reporter.gateway_id!==report.gatewayId||Number(reporter.generation)!==report.generation)fail();
   verifyTrafficReport(envelope,createPublicKey(reporter.public_key));
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(Date.parse(report.until)>now.getTime()+5000||Date.parse(report.from)<process.last_until.getTime()
    ||process.ended_at&&(Date.parse(report.until)>process.ended_at.getTime()||report.sequence>Number(process.final_sequence)))fail();
   if(report.sequence!==Number(process.last_sequence)+1)fail('traffic_sequence_gap');
   const routes=new Map<string,Row>();
   for(const entry of report.entries){
    const route=routes.get(entry.installationId)??await currentRoute(client,entry.installationId);
    if(!route||!eligible.has(entry.installationId)||route.environment!=='test'||route.cellId!==mapping.cellId||route.venueId!==entry.venueId
     ||Number(route.revision)!==entry.revision||routeBinding(route as GatewayRoute)!==entry.routeBinding)fail();
    const expected=(await client.query(`SELECT 1 FROM remote_traffic_coverage WHERE cell_id=$1 AND gateway_id=$2 AND generation=$3
     AND installation_id=$4 AND venue_id=$5 AND configuration_revision=$6 AND route_binding=$7 AND channel=$8
     AND issued_at<=$9 AND expires_at>=$10 AND manifest_sequence>=$11 LIMIT 1`,
     [mapping.cellId,report.gatewayId,report.generation,entry.installationId,entry.venueId,entry.revision,entry.routeBinding,entry.channel,
      report.from,report.until,reporter.minimum_manifest_sequence])).rowCount;
    if(!expected)fail();routes.set(entry.installationId,route);
   }
   const digest=createHash('sha256').update(Buffer.from(envelope.payload,'base64url')).digest('hex');
   await client.query(`INSERT INTO remote_traffic_reports(process_id,sequence,from_at,until_at,complete,report_digest,report_payload,report_signature)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[report.processId,report.sequence,report.from,report.until,report.complete,digest,envelope.payload,envelope.signature]);
   for(const entry of report.entries){
    const route=routes.get(entry.installationId)!;
    const sample=(await client.query(`INSERT INTO remote_traffic_samples
     (cell_id,gateway_id,generation,process_id,sequence,organisation_id,legal_business_id,venue_id,installation_id,configuration_revision,route_binding,
      channel,from_at,until_at,complete,ingress,egress,report_digest,report_payload,report_signature)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING source_reference`,
     [mapping.cellId,report.gatewayId,report.generation,report.processId,report.sequence,route.organisation_id,route.legal_business_id,entry.venueId,
      entry.installationId,entry.revision,entry.routeBinding,entry.channel,report.from,report.until,report.complete,entry.ingress,entry.egress,
      digest,envelope.payload,envelope.signature])).rows[0];
    const quantity=BigInt(entry.ingress)+BigInt(entry.egress);
    if(quantity>0n)await recordUsageEvent(client,{organisationId:route.organisation_id,venueId:entry.venueId,type:'remote_access.traffic_bytes',
     quantity,sourceKind:'remote_traffic_sample',sourceReference:sample.source_reference,occurredAt:report.until});
   }
   const expectedChannels=(await client.query(`SELECT DISTINCT installation_id,channel FROM remote_traffic_coverage
    WHERE cell_id=$1 AND gateway_id=$2 AND generation=$3 AND kind='route' AND issued_at<$5 AND expires_at>$4`,
    [mapping.cellId,report.gatewayId,report.generation,report.from,report.until])).rows;
   const measured=new Set(report.entries.map(entry=>entry.installationId+':'+entry.channel));
   const missingChannel=expectedChannels.some(row=>!measured.has(row.installation_id+':'+row.channel));
   await client.query(`UPDATE remote_traffic_processes SET last_sequence=$2,last_until=$3,has_gap=has_gap OR $4 WHERE process_id=$1`,
    [report.processId,report.sequence,report.until,!report.complete||report.from!==process.last_until.toISOString()||missingChannel]);
   return {state:'accepted',processId:report.processId,sequence:report.sequence};
  });
 }
}
