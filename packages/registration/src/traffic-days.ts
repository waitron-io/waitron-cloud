import type {PoolClient} from 'pg';
import {BillingError,type BillingScope} from './billing-types.ts';
import {billingDate} from './billing-config.ts';
import type {CivilDate} from './billing-calendar.ts';
type Row=Record<string,any>;
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
function fail():never{throw new Error('traffic_authority_unavailable');}

/** Read within the caller's repeatable snapshot; missing journal or process evidence never proves zero use. */
export async function readTrafficDays(client:PoolClient,scope:BillingScope,venueId:string,from:CivilDate,until:CivilDate):Promise<TrafficDays>{
 billingDate(from);billingDate(until);if(from>=until)throw new BillingError('invalid_billing_input');
 const lower=Date.parse(from+'T00:00:00.000Z'),upper=Date.parse(until+'T00:00:00.000Z');
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
}
