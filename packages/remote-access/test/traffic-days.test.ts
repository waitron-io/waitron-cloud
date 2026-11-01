import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {transaction,recordUsageEvent} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {registerForwardReporter} from '../src/forward-observations.ts';
import {routeBinding} from '../src/forward-report.ts';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';
import {signTrafficLifecycle,type TrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {TrafficStore} from '../src/traffic-store.ts';

const instant=(day:string)=>day+'T00:00:00.000Z';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const at=(n:number)=>new Date(n).toISOString();
const begin=instant('2026-11-01'),finish=instant('2026-11-04');
type ProcessOptions={end?:string;reportedUntil?:string;predecessor?:string;hole?:string;missingChannel?:'public';incomplete?:string;finalExtra?:number;bytes?:Record<string,string>;gap?:boolean;sequenceOffset?:number;emptyFrom?:string};

// These signed historical snapshots isolate the reader from wall-clock publication freshness.
// Omitting a journal interval, process tail, channel or receipt must prevent a complete result.
async function fixture(){
 assert.equal(typeof TrafficStore.prototype.days,'function','traffic days require durable interval evidence');
 const f=await venueServiceFixture();
 try{
  await set(f,'connected');const cellId=randomUUID(),gatewayId=randomUUID(),keys=generateKeyPairSync('ed25519');
  const remote=new RemoteAccessStore(f.pool,'test-venue-levels');
  await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'days.example.test',subnet:24,
   publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[0]])).rows[0].id;
  await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  const manifest=await remote.reportingManifest(cellId);assert(manifest.version===2);
  const route=manifest.routes[0]!,binding=routeBinding(route);
  const traffic=new TrafficStore(f.pool),venueId=f.venues[0]!;
  async function authority(from=begin,until=finish,options:{empty?:boolean;missingChannel?:'public'}={}){
   const rows=[];
   for(let n=Date.parse(from);n<Date.parse(until);n+=600000)for(const channel of options.empty?[null]:options.missingChannel?['staff']:['staff','public'])
    rows.push({digest:digest(at(n)),from:at(n),until:at(Math.min(n+600000,Date.parse(until))),channel});
   await f.pool.query(`INSERT INTO remote_traffic_coverage(cell_id,gateway_id,generation,manifest_digest,manifest_sequence,issued_at,expires_at,kind,
    organisation_id,legal_business_id,venue_id,installation_id,configuration_revision,route_binding,channel)
    SELECT $1,$2,1,r.digest,1,r.from::timestamptz,r.until::timestamptz,CASE WHEN r.channel IS NULL THEN 'empty' ELSE 'route' END,
     CASE WHEN r.channel IS NOT NULL THEN $3::uuid END,CASE WHEN r.channel IS NOT NULL THEN $4::uuid END,
     CASE WHEN r.channel IS NOT NULL THEN $5::uuid END,CASE WHEN r.channel IS NOT NULL THEN $6::uuid END,
     CASE WHEN r.channel IS NOT NULL THEN $7::numeric END,CASE WHEN r.channel IS NOT NULL THEN $8 END,r.channel
    FROM jsonb_to_recordset($9::jsonb) AS r(digest text,"from" text,until text,channel text)`,
    [cellId,gatewayId,f.scope.organisationId,f.scope.legalBusinessId,venueId,installationId,route.revision,binding,JSON.stringify(rows)]);
  }
  async function process(from=begin,until=finish,options:ProcessOptions={}){
   const processId=randomUUID(),stop=options.reportedUntil??until;
   const start:TrafficLifecycle={version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId,gatewayId,generation:1,
    processId,manifestDigest:digest(from),startedAt:from,predecessorId:options.predecessor??null,endedAt:null,finalSequence:null};
   const reports=[],samples=[],events=[];let sequence=options.sequenceOffset??0;
   for(let n=Date.parse(from);n<Date.parse(stop);n+=600000){
    const to=at(Math.min(n+600000,Date.parse(stop))),reportFrom=options.hole===at(n)?at(n+1000):at(n);
    const bytes=options.bytes?.[to]??'0';
    const entries=(options.emptyFrom&&at(n)>=options.emptyFrom?[]:options.missingChannel?['staff']:['staff','public']).map(channel=>({installationId,venueId,revision:route.revision,
     routeBinding:binding,channel:channel as 'staff'|'public',ingress:channel==='staff'?bytes:'0',egress:'0'}));
    const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId,gatewayId,generation:1,processId,
     sequence:++sequence,from:reportFrom,until:to,complete:options.incomplete!==at(n),entries};
    const envelope=signTrafficReport(report,keys.privateKey),hash=digest(Buffer.from(envelope.payload,'base64url').toString());
    reports.push({sequence,from:report.from,until:to,complete:report.complete,digest:hash,...envelope});
    for(const entry of entries)samples.push({sequence,from:report.from,until:to,complete:report.complete,...entry,digest:hash,...envelope});
    if(bytes!=='0')events.push({to,bytes,source:processId+':'+sequence+':'+installationId+':staff'});
   }
   const first=signTrafficLifecycle(start,keys.privateKey),end=options.end?signTrafficLifecycle({...start,kind:'end',endedAt:options.end,finalSequence:sequence+(options.finalExtra??0)},keys.privateKey):null;
   await f.pool.query(`INSERT INTO remote_traffic_processes(cell_id,gateway_id,generation,process_id,reporter_public_key,start_manifest_digest,
    started_at,start_payload,start_signature,predecessor_id,ended_at,final_sequence,end_payload,end_signature,last_sequence,last_until,has_gap)
    VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [cellId,gatewayId,processId,keys.publicKey.export({type:'spki',format:'pem'}).toString(),start.manifestDigest,from,first.payload,first.signature,
     start.predecessorId,options.end??null,end?sequence+(options.finalExtra??0):null,end?.payload??null,end?.signature??null,sequence,stop,options.gap??false]);
   await f.pool.query(`INSERT INTO remote_traffic_reports(process_id,sequence,from_at,until_at,complete,report_digest,report_payload,report_signature)
    SELECT $1,r.sequence,r.from::timestamptz,r.until::timestamptz,r.complete,r.digest,r.payload,r.signature
    FROM jsonb_to_recordset($2::jsonb) AS r(sequence numeric,"from" text,until text,complete boolean,digest text,payload text,signature text)`,[processId,JSON.stringify(reports)]);
   await f.pool.query(`INSERT INTO remote_traffic_samples(cell_id,gateway_id,generation,process_id,sequence,organisation_id,legal_business_id,venue_id,
    installation_id,configuration_revision,route_binding,channel,from_at,until_at,complete,ingress,egress,report_digest,report_payload,report_signature)
    SELECT $1,$2,1,$3,r.sequence,$4,$5,$6,$7,$8,$9,r.channel,r.from::timestamptz,r.until::timestamptz,r.complete,r.ingress::numeric,0,r.digest,r.payload,r.signature
    FROM jsonb_to_recordset($10::jsonb) AS r(sequence numeric,channel text,"from" text,until text,complete boolean,ingress text,digest text,payload text,signature text)`,
    [cellId,gatewayId,processId,f.scope.organisationId,f.scope.legalBusinessId,venueId,installationId,route.revision,binding,JSON.stringify(samples)]);
   for(const event of events)await transaction(f.pool,c=>recordUsageEvent(c,{organisationId:f.scope.organisationId,venueId,type:'remote_access.traffic_bytes',
    quantity:BigInt(event.bytes),sourceKind:'remote_traffic_sample',sourceReference:event.source,occurredAt:event.to}));
   return processId;
  }
  return {...f,cellId,gatewayId,installationId,traffic,authority,process,days:(from='2026-11-01',until='2026-11-04')=>traffic.days(f.scope,venueId,from,until)};
 }catch(error){await f.close();throw error;}
}

test('only accepted positive ledger bytes make exact UTC traffic days',async()=>{
 const f=await fixture();try{
  await f.authority(instant('2026-10-31'),instant('2026-11-05'));
  await f.process(instant('2026-10-31'),instant('2026-11-05'),{end:instant('2026-11-05'),bytes:{
   [instant('2026-11-01')]:'9007199254740993','2026-11-01T00:10:00.000Z':'24',
   [instant('2026-11-02')]:'7',[instant('2026-11-03')]:'1',[instant('2026-11-04')]:'99'}});
  await transaction(f.pool,c=>recordUsageEvent(c,{organisationId:f.scope.organisationId,venueId:f.venues[1]!,type:'remote_access.traffic_bytes',
   quantity:100n,sourceKind:'remote_traffic_sample',sourceReference:randomUUID(),occurredAt:'2026-11-01T12:00:00.000Z'}));
  assert.deepEqual(await f.days(),{complete:true,days:[{on:'2026-11-01',bytes:'9007199254741017'},{on:'2026-11-02',bytes:'7'},{on:'2026-11-03',bytes:'1'}]});
  assert.deepEqual(await f.days('2026-11-02','2026-11-03'),{complete:true,days:[{on:'2026-11-02',bytes:'7'}]});
 }finally{await f.close();}
});

test('complete zero intervals prove zero days while unrelated operational events do not create use',async()=>{
 const f=await fixture();try{
  await f.authority();await f.process(begin,finish,{end:finish});
  await transaction(f.pool,c=>recordUsageEvent(c,{organisationId:f.scope.organisationId,venueId:f.venues[0]!,type:'operation.monitoring_probe',
   quantity:1n,sourceKind:'monitoring_probe',sourceReference:randomUUID(),occurredAt:'2026-11-02T12:00:00.000Z'}));
  assert.deepEqual(await f.days(),{complete:true,days:[]});
 }finally{await f.close();}
});

test('traffic days refuse foreign business organisation and venue scopes',async()=>{
 const f=await fixture();try{
  for(const [scope,venue] of [[f.other,f.venues[0]],[f.foreign,f.venues[0]],
   [{...f.scope,organisationId:f.foreign.organisationId},f.venues[0]],
   [f.scope,f.otherVenue],[f.scope,f.foreignVenue],[f.scope,randomUUID()]] as const)
   await assert.rejects(f.traffic.days(scope,venue!,'2026-11-01','2026-11-04'),/billing_scope_not_found/);
 }finally{await f.close();}
});

test('traffic day bounds reject invalid dates reversed intervals and production venues',async()=>{
 const f=await fixture();try{
  for(const [from,until] of [['2026-02-30','2026-11-04'],['2026-11-04','2026-11-01'],['2026-11-01','2026-11-01'],['2026-11-01T00:00:00Z','2026-11-04']])
   await assert.rejects(f.days(from,until),/invalid_billing_input/);
  await assert.rejects(f.traffic.days(f.scope,f.production,'2026-11-01','2026-11-04'),/traffic_authority_unavailable/);
 }finally{await f.close();}
});

for(const [name,setup] of [
 ['silence',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();}],
 ['missing journal',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.process(begin,finish,{end:finish});}],
 ['exporter death with no arriving gap marker',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{reportedUntil:instant('2026-11-02')});}],
 ['contiguous sequences with a time hole',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{end:finish,hole:'2026-11-02T12:00:00.000Z'});}],
 ['an empty-report time hole after route expiry',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority(begin,instant('2026-11-02'));await f.authority(instant('2026-11-02'),finish,{empty:true});await f.process(begin,finish,{end:finish,emptyFrom:instant('2026-11-02'),hole:'2026-11-02T12:00:00.000Z'});}],
 ['missing initial receipt',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{end:finish,sequenceOffset:1});}],
 ['missing public samples',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{end:finish,missingChannel:'public'});}],
 ['missing country public authority',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority(begin,finish,{missingChannel:'public'});await f.process(begin,finish,{end:finish});}],
 ['late instrumentation',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority('2026-11-01T00:10:00.000Z');await f.process('2026-11-01T00:10:00.000Z',finish,{end:finish});}],
 ['journal ending before trial boundary',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority(begin,instant('2026-11-03'));await f.process(begin,finish,{end:finish});}],
 ['incomplete received report',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{end:finish,incomplete:'2026-11-02T12:00:00.000Z'});}],
 ['an incomplete empty report after route expiry',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority(begin,instant('2026-11-02'));await f.authority(instant('2026-11-02'),finish,{empty:true});await f.process(begin,finish,{end:finish,emptyFrom:instant('2026-11-02'),incomplete:'2026-11-02T12:00:00.000Z'});}],
 ['unacknowledged final interval',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{end:finish,finalExtra:1});}],
 ['durable earlier gap',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{end:finish,gap:true});}],
 ['unclosed predecessor despite clean successor',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();const previous=await f.process(begin,finish,{reportedUntil:instant('2026-11-02')});await f.process(instant('2026-11-02'),finish,{end:finish,predecessor:previous});}],
 ['unclosed predecessor even with samples through the boundary',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();const previous=await f.process();await f.process(instant('2026-11-02'),finish,{end:finish,predecessor:previous});}],
 ['reload tail despite another fully sampled process',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority();await f.process(begin,finish,{end:finish});await f.process(instant('2026-11-02'),finish,{reportedUntil:instant('2026-11-03')});}],
 ['reload tail after empty publication beside a closed sibling',async(f:Awaited<ReturnType<typeof fixture>>)=>{await f.authority(begin,instant('2026-11-02'));await f.authority(instant('2026-11-02'),finish,{empty:true});await f.process(begin,instant('2026-11-02'),{end:instant('2026-11-02')});await f.process('2026-11-01T23:50:00.000Z',finish,{reportedUntil:instant('2026-11-02')});}],
] as const)test('traffic coverage stays incomplete for '+name,async()=>{
 const f=await fixture();try{await setup(f);assert.deepEqual(await f.days(),{complete:false,days:[]});}finally{await f.close();}
});

test('closed predecessor and fully sampled concurrent reload processes remain complete',async()=>{
 const f=await fixture();try{
  await f.authority();const prior=await f.process(begin,instant('2026-11-02'),{end:instant('2026-11-02')});
  await f.process(instant('2026-11-02'),finish,{end:finish,predecessor:prior});
  await f.process('2026-11-01T23:50:00.000Z','2026-11-02T00:10:00.000Z',{end:'2026-11-02T00:10:00.000Z'});
  assert.deepEqual(await f.days(),{complete:true,days:[]});
 }finally{await f.close();}
});

test('explicit empty authority only proves no route after prior serving lifetimes end',async()=>{
 for(const closed of [true,false]){
  const f=await fixture();try{
   await f.authority(begin,instant('2026-11-02'));await f.authority(instant('2026-11-02'),finish,{empty:true});
   await f.process(begin,instant('2026-11-02'),{end:closed?instant('2026-11-02'):undefined});
   assert.deepEqual(await f.days(),{complete:closed,days:[]});
  }finally{await f.close();}
 }
});
