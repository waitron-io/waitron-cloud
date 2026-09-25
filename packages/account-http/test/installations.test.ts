import {venueOverview} from '../src/venue-overview.ts';
import {BackupCatalogue} from '../../backups/src/catalogue.ts';
import {BackupKeyVault} from '../../backups/src/keys.ts';
import {receipt} from '../../backups/src/storage.ts';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {SignupStore,RegistrationStore,createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {database} from './fixtures.ts';
const origin='https://cloud.example.test',password='A sufficiently long test password';
const key=generateKeyPairSync('ed25519'),issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,id:string,cookie:string,csrf:string;
const config=()=>({portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]});
function request(path:string,body?:unknown,headers:Record<string,string>={}){return app.request(origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings);}
function proof(action:MachineAction,lease?:SignedEnvelope){const bytes=encodeMachine({origin,action,installationId:id,operationId:randomUUID(),issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:'{}'});return {payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')};}
const browser=(action:string,body?:unknown,headers:Record<string,string>={})=>request('/api/account/installations'+action,body,{origin,cookie,'x-csrf-token':csrf,...headers});
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await db.pool.query('TRUNCATE account_rate_limits,signup_requests,email_outbox,organisations,cloud_accounts CASCADE');
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:issuer});
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());id=(await r.complete(binding)).installationId;
 const login=await request('/api/account/login',{email:'owner@example.test',password},{origin});assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
});
test('machine authority, browser sessions and configured issuer remain separate',async()=>{
 assert.equal((await request('/api/installations/renew',proof('renew'),{origin})).status,403);
 assert.equal((await request('/api/installations/renew',{})).status,400);
 assert.equal((await request('/api/installations/renew',proof('configuration'))).status,401);
 assert.equal((await request('/api/installations/renew')).status,405);
 assert.equal((await request('/api/installations/unknown',{})).status,404);
 assert.equal((await request('/api/installations/renew',{...proof('renew'),extra:'x'})).status,400);
 assert.equal((await request('/api/installations/renew',{payload:'x'.repeat(17000),signature:'x'})).status,413);
 const renewed=await request('/api/installations/renew',proof('renew'));assert.equal(renewed.status,200);const result=await renewed.json() as {lease:SignedEnvelope};
 assert.equal((await request('/api/installations/configuration',proof('configuration',result.lease))).status,200);
 assert.equal((await browser('')).status,200);assert.equal((await browser('',undefined,{cookie:''})).status,401);
 for(const headers of [{origin:'https://wrong.test'},{'x-csrf-token':'wrong'},{cookie:''}] as Record<string,string>[])assert.ok([401,403].includes((await browser('/revoke',{installationId:id},headers)).status));
 assert.equal((await browser('/revoke',{installationId:id})).status,200);
 assert.equal((await request('/api/installations/renew',proof('renew'))).status,403);
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config()});assert.equal((await request('/api/installations/renew',proof('renew'))).status,503);
});
test('machine limits persist across app workers',async()=>{
 for(let n=0;n<30;n++){assert.equal((await request('/api/installations/renew',proof('renew'))).status,200);app=createAccountApp({pool:db.secondPool,outbox:db.outbox,config:config(),leaseIssuer:issuer});}
 const limited=await request('/api/installations/renew',proof('renew'));assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});
test('real socket renewal survives server restart and revocation rejects subsequent access',async()=>{
 const start=()=>startAccountServer({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:issuer,port:0});let running=await start();
 const send=(action:MachineAction,body:unknown)=>new Promise<Response>((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:(running.server.address() as {port:number}).port,path:'/api/installations/'+action,method:'POST',headers:{host:'cloud.example.test','content-type':'application/json'}},res=>{let text='';res.on('data',c=>{text+=c;});res.on('end',()=>resolve(new Response(text,{status:res.statusCode!})));res.on('error',reject);});req.on('error',reject);req.end(JSON.stringify(body));
 });
 try{const renewal=proof('renew'),first=await send('renew',renewal);assert.equal(first.status,200);const result=await first.json();await running.close();running=await start();assert.deepEqual(await (await send('renew',renewal)).json(),result);assert.equal((await send('revoke',proof('revoke'))).status,200);assert.equal((await send('renew',proof('renew'))).status,403);}finally{await running.close();}
});

test('venue overview includes public business context and verified snapshot time without credentials',async()=>{
 const objects=new Map<string,Buffer>(),vault=new BackupKeyVault(randomBytes(32));
 const backups=new BackupCatalogue(db.pool,vault,()=>({async read(k){return objects.get(k)!;},async put(k,b){objects.set(k,Buffer.from(b));return receipt(b);},async remove(k){objects.delete(k);}}));
 await backups.provision(id,{endpoint:'https://storage.test',bucket:'venue-snapshots',region:'local'});
 const dates=[4,3,2,1].map(days=>new Date(Date.now()-days*86400000).toISOString());let secret='';
 for(let n=0;n<4;n++){
  const capture=await backups.reserveCapture(id,randomUUID()),bytes=Buffer.from('archive '+n);secret=capture.keys.recoveryKey;objects.set(capture.incomingKey,bytes);
  const point=await backups.publish(id,capture.id,{...receipt(bytes),capturedAt:dates[n]!,retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});
  if(n===0)await backups.verify(point.id,'test-worker',async()=>{});
  if(n===1)await assert.rejects(backups.verify(point.id,'test-worker',async()=>{throw Error('bad archive');}));
  if(n===2)await db.pool.query('UPDATE backup_points SET deleting=true WHERE id=$1',[point.id]);
  if(n===3)await db.pool.query('UPDATE backup_points SET deleted_at=clock_timestamp() WHERE id=$1',[point.id]);
 }
 const response=await browser('');assert.equal(response.status,200);const json=await response.json();
 assert.deepEqual(json.installations[0].overview,{organisationName:'Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:dates[1],verifiedSnapshotAt:dates[0]});
 assert(!JSON.stringify(json).includes(secret));assert(!JSON.stringify(json).includes('snapshots/'));
 await db.pool.query('DELETE FROM organisation_memberships');assert.deepEqual(await venueOverview(db.pool,/__Host-cloud_session=([^;]+)/.exec(cookie)![1]!,json.installations),[]);assert.deepEqual(await (await browser('')).json(),{installations:[]});
});

test('overview normalises legacy names and falls back to identifiers for unnamed businesses',async()=>{
 await db.pool.query('UPDATE organisations SET name=$1',[' '+ 'x'.repeat(200)+' ']);
 await db.pool.query('UPDATE legal_businesses SET name=$1',[' Sol SL ']);
 let response=await browser('');assert.equal(response.status,200);let item=(await response.json()).installations[0];
 assert.equal(item.overview.organisationName,'x'.repeat(200));assert.equal(item.overview.businessName,'Sol SL');
 await db.pool.query('UPDATE organisations SET name=NULL');await db.pool.query('UPDATE legal_businesses SET name=NULL');
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false');
 response=await browser('');assert.equal(response.status,200);item=(await response.json()).installations[0];
 assert.equal(item.overview.organisationName,item.organisationId);assert.equal(item.overview.businessName,item.legalBusinessId);assert.equal(item.canRevoke,false);
 assert.equal((await browser('/revoke',{installationId:id})).status,403);
});
test('overview exposes current monitoring evidence only to current organisation members',async()=>{
 const venueId=(await db.pool.query('SELECT venue_id FROM installations WHERE id=$1',[id])).rows[0].venue_id;
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[id]);
 await db.pool.query('INSERT INTO venue_monitors(venue_id,checked_at) VALUES($1,clock_timestamp())',[venueId]);
 await db.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision) VALUES($1,'disconnected','open',1)",[venueId]);
 let item=(await(await browser('')).json()).installations[0];assert.equal(item.monitoring.enabled,true);assert.equal(item.monitoring.fresh,true);assert.deepEqual(item.monitoring.incidents.map((v:{kind:string})=>v.kind),['disconnected']);
 assert.deepEqual(Object.keys(item.monitoring.incidents[0]).sort(),['changedAt','kind','openedAt']);
 const cell=randomUUID(),checked='2026-09-25T12:00:00.000Z',expires='2026-10-01T12:00:00.000Z';
 await db.pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','cell.example.test',7,'fixture-key','gateway.example.test:51820')",[cell]);
 await db.pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,'10.77.7.2','fixture-peer',443)",[venueId,id,cell]);
 await db.pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES('public.cell.example.test',$1,'public'),('staff.cell.example.test',$1,'staff')",[venueId]);
 await db.pool.query(`INSERT INTO remote_probe_observations
  (installation_id,venue_id,service,configuration_revision,hostname,status,checked_at,elapsed_ms,failure,certificate_not_before,certificate_not_after,certificate_fingerprint256,last_success_at,last_failure_at,last_failure)
  VALUES($1,$2,'public',0,'public.cell.example.test','failed',$3,12,'timeout',$3,$4,'AA:BB',$3,$3,'timeout'),
   ($1,$2,'staff',0,'staff.cell.example.test','healthy',$3,8,NULL,$3,$4,'CC:DD',$3,NULL,NULL)`,[id,venueId,checked,expires]);
 await db.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision) VALUES($1,'public_route_failed','open',1),($1,'staff_probe_stale','open',1),($1,'public_certificate_expiring','open',1)",[venueId]);
 item=(await(await browser('')).json()).installations[0];
 assert.deepEqual(item.monitoring.incidents.map((v:{kind:string})=>v.kind),['disconnected','public_certificate_expiring','public_route_failed','staff_probe_stale']);
 assert.deepEqual(item.monitoring.remoteChecks,{public:{status:'failed',checkedAt:checked,certificateNotAfter:expires},staff:{status:'healthy',checkedAt:checked,certificateNotAfter:expires}});
 assert.deepEqual(Object.keys(item.monitoring.remoteChecks.public).sort(),['certificateNotAfter','checkedAt','status']);
 for(const secret of ['public.cell.example.test','staff.cell.example.test','AA:BB','CC:DD','timeout','10.77.7.2'])assert(!JSON.stringify(item.monitoring).includes(secret));
 await db.pool.query("DELETE FROM remote_hostnames WHERE venue_id=$1 AND kind='staff'",[venueId]);item=(await(await browser('')).json()).installations[0];
 assert.deepEqual(item.monitoring.incidents.map((v:{kind:string})=>v.kind),['disconnected','public_certificate_expiring','public_route_failed']);assert.equal(item.monitoring.remoteChecks.staff,null);
 await db.pool.query("UPDATE venue_monitors SET checked_at=clock_timestamp()-interval '5 minutes 1 second'");item=(await(await browser('')).json()).installations[0];assert.equal(item.monitoring.fresh,false);assert.equal(item.monitoring.incidents.length,3);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');item=(await(await browser('')).json()).installations[0];assert.equal(item.monitoring.enabled,false);assert.deepEqual(item.monitoring.incidents,[]);assert.equal(item.monitoring.remoteChecks,null);
 await db.pool.query('DELETE FROM organisation_memberships');assert.deepEqual((await(await browser('')).json()).installations,[]);
});
