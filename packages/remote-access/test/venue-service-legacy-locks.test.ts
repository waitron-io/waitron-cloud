import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {BillingStore,transaction} from '@waitron-cloud/registration';
import {event,venueServiceFixture} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {eligibleRemoteInstallations} from '../src/plan-permissions.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {ForwardObservationStore,registerForwardReporter} from '../src/forward-observations.ts';
import {routeBinding,signForwardReport,type ForwardReport} from '../src/forward-report.ts';

const peer=()=>randomBytes(32).toString('base64');
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const ordinary=new RemoteAccessStore(f.pool),legacy=new RemoteAccessStore(f.pool,'test-free-paid'),source=randomUUID(),otherCell=randomUUID();
  for(const [id,subnet] of [[source,85],[otherCell,86]] as const)await ordinary.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`enrol-${id}.example.test`,subnet,publicKey:peer(),endpoint:'gateway.example.test:51820'});
  const ids:string[]=[];
  for(const venue of f.venues){const id=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[venue])).rows[0].id;ids.push(id);await ordinary.provision(id,source,peer());}
  const otherId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.otherVenue])).rows[0].id;await ordinary.provision(otherId,otherCell,peer());
  await f.pool.query("UPDATE organisations SET service_plan='paid' WHERE id=$1",[f.scope.organisationId]);
  const key=generateKeyPairSync('ed25519'),gatewayId=randomUUID();await transaction(f.pool,c=>registerForwardReporter(c,{cellId:source,gatewayId,generation:1,publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString()}));
  const manifest=await ordinary.reportingManifest(source),route=manifest.routes.find(r=>r.installationId===ids[0])!,now=Date.now();
  const report:ForwardReport={version:1,audience:'waitron-cloud-public-forward-report',cellId:source,gatewayId,generation:1,sequence:1,issuedAt:now,observations:[{cellId:source,gatewayId,generation:1,installationId:ids[0]!,venueId:f.venues[0]!,revision:Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[ids[0]])).rows[0].configuration_revision),routeId:'public_availability',routeBinding:routeBinding(route),manifestSequence:manifest.sequence,manifestExpiresAt:manifest.expiresAt,observationSequence:1,category:'upstream_transport',observedAt:now,expiresAt:Math.min(now+300000,manifest.expiresAt)}]};
  const mapping={country:'ES' as const,environment:'test' as const,cellId:source,file:'/country/forward/report.json',writerUid:0,readerGid:1000};
  const observations=new ForwardObservationStore(f.pool,'test-free-paid');assert.equal(await observations.record(mapping,signForwardReport(report,key.privateKey)),'accepted');
  assert.equal((await transaction(f.pool,c=>observations.readCurrent(c,ids[0]!)))!.category,'upstream_transport');
  await f.pool.query("UPDATE remote_forward_reporters SET next_accept_at='-infinity' WHERE cell_id=$1",[source]);report.sequence++;report.observations[0]!.observationSequence++;
  return {...f,ordinary,legacy,source,otherCell,otherId,ids,observations,mapping,envelope:signForwardReport(report,key.privateKey)};
 }catch(error){await f.close();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;

// Pause only after the real parent lock, before authority creation or installation locks.
async function firstEnrolment(f:Fixture){
 let release!:()=>void,reached!:(pid:number)=>void;
 const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<number>(r=>{reached=r;});
 const wrapped=new Proxy(f.pool,{get(target,name){
  if(name==='connect')return async()=>{
   const client=await target.connect();return new Proxy(client,{get(connection,key){
    if(key==='query')return async(...args:any[])=>{
     const value=await (connection.query as any)(...args);
     if(typeof args[0]==='string'&&args[0].startsWith('SELECT environment FROM venues ')){
      reached((await connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);await gate;
     }
     return value;
    };
    const value=Reflect.get(connection,key);return typeof value==='function'?value.bind(connection):value;
   }});
  };
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 }}) as Pool;
 const pending=new BillingStore(wrapped).transition(f.scope,event(),{type:'set_venue',venueId:f.venues[0]!,expectedRevision:0,value:{level:'registered',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
 void pending.catch(()=>{});return {pending,ready,release};
}
async function blocked(f:Fixture,pid:number,settled:()=>boolean){
 for(let n=0;n<300&&!settled();n++){
  if((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,pid])).rowCount)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('legacy remote batch must wait for first enrolment before installation or cell locks');
}

// A missing authority row still needs its existing venue parent to exclude first enrolment.
for(const operation of ['eligibility','manifest','reporting manifest','scheduler','reporting scheduler','observation write','observation read'] as const)test(`legacy remote ${operation} waits for first enrolment`,async()=>{
 const f=await fixture(),enrol=await firstEnrolment(f),observer=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  const pid=await enrol.ready,beforeObservation=(await f.pool.query('SELECT to_jsonb(o) AS value FROM remote_forward_observations o WHERE installation_id=$1',[f.ids[0]])).rows;let settled=false;
  const run=async()=>{
   if(operation==='eligibility')return transaction(f.pool,c=>eligibleRemoteInstallations(c,'test-free-paid',f.source));
   if(operation==='manifest')return f.legacy.manifest(f.source);
   if(operation==='reporting manifest')return f.legacy.reportingManifest(f.source);
   if(operation==='observation write')return f.observations.record(f.mapping,f.envelope);
   if(operation==='observation read')return transaction(f.pool,c=>f.observations.readCurrent(c,f.ids[0]!));
   return new RemoteConfigurationReconciler(f.pool,{planMode:'test-free-paid',forwardReports:operation==='reporting scheduler'}).schedule();
  };
  pending=run().finally(()=>{settled=true;});void pending.catch(()=>{});await blocked(f,pid,()=>settled);
  await observer.query('BEGIN');await assert.doesNotReject(observer.query('SELECT id FROM installations WHERE venue_id=ANY($1::uuid[]) FOR UPDATE NOWAIT',[f.venues]),'legacy batch must take all venue locks before any installation lock');await observer.query('ROLLBACK');
  // An unrelated cell in this same organisation must still export while the venue waits.
  assert.deepEqual((await f.legacy.manifest(f.otherCell)).routes.map(r=>r.installationId),[f.otherId]);
  enrol.release();await enrol.pending;const result=await pending;
  if(operation==='eligibility')assert.ok(!(result as string[]).includes(f.ids[0]!));
  else if(operation==='manifest'||operation==='reporting manifest')assert.deepEqual((result as {routes:{installationId:string}[]}).routes.map(r=>r.installationId),[f.ids[1]]);
  else if(operation==='observation read')assert.equal(result,null);
  else if(operation==='observation write'){assert.equal(result,'accepted');assert.deepEqual((await f.pool.query('SELECT to_jsonb(o) AS value FROM remote_forward_observations o WHERE installation_id=$1',[f.ids[0]])).rows,beforeObservation);assert.equal(await transaction(f.pool,c=>f.observations.readCurrent(c,f.ids[0]!)),null);}
  else assert.equal((await f.pool.query("SELECT count(*) AS n FROM remote_configuration_jobs WHERE target_id=$1 AND kind<>'route' AND enabled",[f.ids[0]])).rows[0].n,'0');
 }finally{enrol.release();await enrol.pending.catch(()=>{});await observer.query('ROLLBACK');await pending?.catch(()=>{});observer.release();await f.close();}
});
