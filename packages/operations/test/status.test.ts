import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {operationsStatus} from '../src/status.ts';

let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});
after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 await db.pool.query('UPDATE usage_reconciliation_sources SET last_attempted_at=clock_timestamp(),caught_up_at=clock_timestamp()');
});

async function healthServer(handler:(request:import('node:http').IncomingMessage,response:import('node:http').ServerResponse)=>void){
 const server=createServer(handler);await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 return {url:`http://127.0.0.1:${address.port}`,closeConnections:()=>server.closeAllConnections(),close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
const healthy=()=>healthServer((request,response)=>{
 response.setHeader('content-type','application/json');
 if(request.url==='/api/health/live')response.end('{"status":"live"}');
 else if(request.url==='/api/health/ready')response.end('{"status":"ready"}');
 else{response.statusCode=404;response.end();}
});

test('empty configured system is ready and reports each evidence class without tenant labels',async()=>{
 const server=await healthy();try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:server.url});
  assert.equal(snapshot.version,1);assert.equal(snapshot.state,'ready');assert.equal(snapshot.ready,true);
  assert.deepEqual(Object.fromEntries(Object.entries(snapshot.components).map(([name,value])=>[name,[value.state,value.code]])),{
   controlApi:['ready','ready'],monitoring:['ready','no_targets'],email:['ready','empty'],backups:['ready','no_jobs'],
   remoteConfiguration:['ready','no_targets'],gateways:['ready','no_targets'],storage:['ready','no_targets'],usage:['ready','current'],
  });
  assert.equal(JSON.stringify(snapshot).includes('DATABASE_URL'),false);
 }finally{await server.close();}
});

test('configured venues without a scheduled monitor are unknown instead of absent',async()=>{
 await configuredVenue();
 const server=await healthy();try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:server.url});
  assert.equal(snapshot.components.monitoring.venues,1);
  assert.equal(snapshot.components.monitoring.unknown,1);
  assert.equal(snapshot.components.monitoring.state,'degraded');
  assert.equal(snapshot.components.monitoring.code,'evidence_stale');
 }finally{await server.close();}
});

test('historical terminal email failures remain counted without degrading current delivery',async()=>{
 await db.pool.query(`INSERT INTO email_outbox(id,kind,status,expires_at,attempts,failures,last_error,finished_at)
  VALUES($1,'password_changed','failed',clock_timestamp()+interval '1 hour',8,8,'attempts_exhausted',clock_timestamp())`,[randomUUID()]);
 const server=await healthy();try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:server.url});
  assert.equal(snapshot.components.email.counts.failed,1);
  assert.equal(snapshot.components.email.backlogged,0);
  assert.equal(snapshot.components.email.state,'ready');
  assert.equal(snapshot.components.email.code,'current');
 }finally{await server.close();}
});

test('open incidents remain degraded when their configured targets disappear',async()=>{
 const target=await configuredVenue();
 await db.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision) VALUES($1,'disconnected','open',1)",[target.venue]);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[target.installation]);
 const server=await healthy();try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:server.url});
  assert.equal(snapshot.components.monitoring.venues,0);
  assert.equal(snapshot.components.monitoring.incidents,1);
  assert.equal(snapshot.components.monitoring.state,'degraded');
  assert.equal(snapshot.components.monitoring.code,'incidents_open');
 }finally{await server.close();}
});

async function configuredVenue(){
 const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),cell=randomUUID();
 await db.pool.query('INSERT INTO organisations(id,name) VALUES($1,$2)',[organisation,'Private operator fixture']);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Private business','ES')",[business,organisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'private-installation-key')",[installation,venue]);
 await db.pool.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'remote_access','ready'),($1,'continuous_backup','ready'),($1,'retained_snapshots','ready')",[installation]);
 await db.pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','private.example.test',81,'private-cell-key','private.gateway.test:51820')",[cell]);
 await db.pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,'10.60.81.2','private-peer-key',51820)",[venue,installation,cell]);
 await db.pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES('private-staff.example.test',$1,'staff'),('private-public.example.test',$1,'public')",[venue]);
 await db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://private-storage.test','private-bucket','local')",[venue,installation]);
 return {organisation,business,venue,installation,cell};
}

test('due work, parked jobs, stale gateway/storage evidence and stale reconciliation are actionable',async()=>{
 const target=await configuredVenue(),monitor=randomUUID(),email=randomUUID();
 await db.pool.query("INSERT INTO venue_monitors(venue_id,next_check_at,checked_at) VALUES($1,clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes')",[target.venue]);
 await db.pool.query("INSERT INTO venue_incidents(id,venue_id,kind,status,revision) VALUES($1,$2,'disconnected','open',1)",[monitor,target.venue]);
 await db.pool.query("INSERT INTO email_outbox(id,kind,key_id,payload,created_at,expires_at,available_at) VALUES($1,'password_changed','test',$2,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '10 minutes')",[email,Buffer.from('private-email-payload')]);
 await db.pool.query("INSERT INTO backup_jobs(kind,venue_id,target_id,status,attempts,last_error) VALUES('retention',$1,$1,'failed',8,'attempts_exhausted')",[target.venue]);
 await db.pool.query("INSERT INTO remote_configuration_jobs(kind,target_id,desired_digest,status,attempts,last_error) VALUES('route',$1,$2,'failed',8,'private-internal-error')",[target.cell,'0'.repeat(64)]);
 await db.pool.query("UPDATE usage_reconciliation_sources SET caught_up_at=clock_timestamp()-interval '10 minutes'");
 const server=await healthy();try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:server.url});
  assert.equal(snapshot.state,'unready');assert.equal(snapshot.ready,false);
  assert.deepEqual([snapshot.components.monitoring.state,snapshot.components.email.state,snapshot.components.backups.state,
   snapshot.components.remoteConfiguration.state,snapshot.components.gateways.state,snapshot.components.storage.state,snapshot.components.usage.state],
  ['degraded','degraded','unready','unready','degraded','degraded','degraded']);
  assert.equal(snapshot.components.gateways.missing,2);assert.equal(snapshot.components.storage.missing,1);
  const encoded=JSON.stringify(snapshot);
  for(const secret of ['Private operator fixture','Private business','private-installation-key','private.example.test','private-cell-key','private.gateway.test','private-peer-key','private-staff.example.test','private-public.example.test','private-storage.test','private-bucket','private-email-payload','private-internal-error'])assert.equal(encoded.includes(secret),false,secret);
 }finally{await server.close();}
});

test('control API redirects, oversized replies and timeouts fail closed with stable diagnostics',async()=>{
 const cases:Array<{handler:Parameters<typeof healthServer>[0];timeout?:number}>=[
  {handler:(_request,response)=>{response.statusCode=302;response.setHeader('location','https://private.example/redirect');response.end();}},
  {handler:(_request,response)=>{response.end('x'.repeat(1025));}},
  {handler:()=>{},timeout:25},
 ];
 for(const fixture of cases){const server=await healthServer(fixture.handler);try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:server.url,probeTimeoutMs:fixture.timeout??200});
  assert.equal(snapshot.components.controlApi.state,'unready');assert.equal(snapshot.components.controlApi.code,'unavailable');
  assert.equal(snapshot.ready,false);assert.equal(JSON.stringify(snapshot).includes('private.example'),false);
 }finally{await server.close();}}
});

test('rejected health responses close unfinished response streams',async()=>{
 for(const fixture of [{status:503},{status:200,length:'1025'}]){
  let closed!:()=>void;
  const responseClosed=new Promise<void>(resolve=>{closed=resolve;});
  const server=await healthServer((_request,response)=>{
   response.on('close',closed);response.statusCode=fixture.status;
   response.setHeader('content-type','application/json');
   if(fixture.length)response.setHeader('content-length',fixture.length);
   response.write('{');
  });
  try{
   const snapshot=await operationsStatus(db.pool,{controlApiUrl:server.url,probeTimeoutMs:20});
   assert.equal(snapshot.components.controlApi.state,'unready');
   await Promise.race([responseClosed,new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(new Error('rejected response stream remained open')),100))]);
  }finally{server.closeConnections();await server.close();}
 }
});
