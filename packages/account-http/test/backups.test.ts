import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import {Pool} from 'pg';
import {BackupCatalogue} from '../../backups/src/catalogue.ts';
import {BackupKeyVault} from '../../backups/src/keys.ts';
import type {HttpBindings} from '@hono/node-server';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {SignupStore,RegistrationStore} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';
const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
const origin='https://cloud.example.test',password='A sufficiently long test password';
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,cookie:string,csrf:string;
let venues:{venueId:string;installationId:string}[];
function request(body:unknown,headers:Record<string,string>={},path='/api/account/backups/list',method='POST'){
 return app.request(origin+path,{method,headers:{'content-type':'application/json',origin,cookie,'x-csrf-token':csrf,...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})},bindings);
}
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),registration=new RegistrationStore(db.pool);venues=[];
 for(let i=0;i<2;i++){
  const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());const v=await registration.complete(binding);venues.push(v);
  await db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://secret-store.test',$3,'local')",[v.venueId,v.installationId,'private-'+i]);
  await db.pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'private-sealed-key')",[v.venueId]);
 }
 const login=await app.request(origin+'/api/account/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test',password})},bindings);assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
});
async function point(venue=venues[0]!,capturedAt='2026-01-31T12:00:00.000Z',verification='pending',retention='daily'){
 const id=randomUUID();await db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[id,venue.venueId,venue.installationId]);
 await db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification) VALUES($1,$2,$3,1,'snapshot',$4,$5,100,$6,$7,$8,'{}',$9)",[id,venue.venueId,venue.installationId,'snapshots/'+id,'a'.repeat(64),capturedAt,retention,randomUUID(),verification]);return id;
}
test('catalogue uses live owner authority and exact browser proof without renewing the session',async()=>{
 const body={venueId:venues[0]!.venueId};
 for(const headers of [{cookie:''},{origin:'https://wrong.test'},{'x-csrf-token':'wrong'}] as Record<string,string>[])assert.ok([401,403].includes((await request(body,headers)).status));
 assert.equal((await request(body,{},undefined,'GET')).status,405);
 assert.equal((await request({...body,extra:'x'})).status,400);assert.equal((await request({venueId:'bad'})).status,400);
 assert.equal((await request({venueId:randomUUID()})).status,403);
 const before=(await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows;
 const response=await request(body);assert.equal(response.status,200);assert.deepEqual((await response.json()).points,[]);
 assert.deepEqual((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows,before);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false');assert.equal((await request(body)).status,403);
 await db.pool.query('DELETE FROM organisation_memberships');assert.equal((await request(body)).status,403);
});
test('bounded cursor pages preserve equal timestamp ordering and never return another venue',async()=>{
 const ids=[];for(let n=0;n<52;n++)ids.push(await point());const foreign=await point(venues[1]!);
 const response=await request({venueId:venues[0]!.venueId});assert.equal(response.status,200);const page=await response.json();assert.equal(page.points.length,50);assert.ok(page.nextCursor);
 await db.pool.query('UPDATE backup_points SET deleting=true,deleted_at=clock_timestamp() WHERE id=$1',[page.points.at(-1).id]);
 const second=await (await request({venueId:venues[0]!.venueId,cursor:page.nextCursor})).json();assert.equal(second.points.length,2);assert.equal(second.nextCursor,null);
 assert.deepEqual([...page.points,...second.points].map(p=>p.id),ids.sort().reverse());assert(!JSON.stringify(page).includes(foreign));
 const forged=Buffer.from(JSON.stringify([venues[0]!.venueId,foreign])).toString('base64url');assert.equal((await request({venueId:venues[0]!.venueId,cursor:forged})).status,400);
 assert.equal((await request({venueId:venues[1]!.venueId,cursor:page.nextCursor})).status,400);
 assert.equal((await request({venueId:venues[0]!.venueId,cursor:'broken'})).status,400);
 assert.deepEqual(Object.keys(page.points[0]).sort(),['id','capturedAt','verification','retention','expiresAt','protection'].sort());
 assert(!JSON.stringify(page).includes('snapshots/'));assert(!JSON.stringify(page).includes('private-'));
});
test('retention protection is distinct from current verification and active recovery',async()=>{
 const old=await point(undefined,'2025-01-01T12:00:00.000Z','failed'),latest=await point(undefined,'2026-01-31T12:00:00.000Z','verified','monthly'),recovering=await point(undefined,'2026-01-01T12:00:00.000Z');
 await db.pool.query("INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,'fixture','verified')",[randomUUID(),old,'a'.repeat(64)]);
 const account=(await db.pool.query('SELECT id FROM cloud_accounts')).rows[0].id;
 await db.pool.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode) VALUES($1,$2,$3,$4,'fixture-key','failure')",[randomUUID(),venues[0]!.venueId,recovering,account]);
 for(const state of ['deleting','deleted_at']){const id=await point();await db.pool.query(`UPDATE backup_points SET ${state}=${state==='deleting'?'true':'clock_timestamp()'} WHERE id=$1`,[id]);}
 const continuous=await point();await db.pool.query("UPDATE backup_points SET kind='continuous' WHERE id=$1",[continuous]);
 const r=await request({venueId:venues[0]!.venueId});assert.equal(r.status,200);const page=await r.json();assert.equal(page.points.length,3);assert.equal(page.defaultPointId,latest);assert.equal(page.continuousRecovery,null);
 assert.equal(page.points.find((p:{id:string})=>p.id===old).protection,'fallback');assert.equal(page.points.find((p:{id:string})=>p.id===old).verification,'failed');assert.equal(page.points.find((p:{id:string})=>p.id===recovering).protection,'recovery');assert.equal(page.points.find((p:{id:string})=>p.id===latest).expiresAt,'2027-01-31T12:00:00.000Z');
 await db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second'");
 assert.equal((await (await request({venueId:venues[0]!.venueId})).json()).points.find((p:{id:string})=>p.id===recovering).protection,null);
});

test('another organisation is refused even with a valid session and a known venue identifier',async()=>{
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('other@example.test');const row=(await db.pool.query("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1")).rows[0],mail=db.outbox.open(row);assert('token' in mail);
 const other=await signup.complete(mail.token,{password,organisationName:'Luna',legalBusinessName:'Luna SL',countryCode:'ES'});
 const r=new RegistrationStore(db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:other.organisationId,legalBusinessId:other.legalBusinessId};await r.start(b);await r.approveCloud(b,other.accountId);await r.approveLocal(b,randomUUID());const foreign=await r.complete(b);
 assert.equal((await request({venueId:foreign.venueId})).status,403);
});
test('catalogue limits persist across API processes',async()=>{
 for(let n=0;n<30;n++){
  assert.equal((await request({venueId:venues[0]!.venueId})).status,200);
  app=createAccountApp({pool:db.secondPool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 }
 const limited=await request({venueId:venues[0]!.venueId});assert.equal(limited.status,429);assert(Number(limited.headers.get('retry-after'))>0);
});

test('published retention dates match cleanup across database time zones and daylight-saving changes',async()=>{
 const anchor=await point(undefined,'2020-01-01T12:00:00.000Z','verified');
 await db.pool.query("INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,'fixture','verified')",[randomUUID(),anchor,'a'.repeat(64)]);
 const madrid=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${db.schema} -c timezone=Europe/Madrid`});
 const cleanup=new BackupCatalogue(madrid,new BackupKeyVault(Buffer.alloc(32)),()=>({async read(){throw Error('not used');},async put(){throw Error('not used');},async remove(){}}));
 try{
  for(const [retention,date] of [['daily','2026-03-01T12:00:00.000Z'],['monthly','2026-03-29T00:30:00.000Z']]){
   const id=await point(undefined,date,'pending',retention),response=await request({venueId:venues[0]!.venueId});assert.equal(response.status,200);
   const shown=(await response.json()).points.find((p:{id:string})=>p.id===id).expiresAt;
   assert.equal(await cleanup.cleanupOne(venues[0]!.venueId,new Date(Date.parse(shown)-1)),null,retention+' must not delete before the displayed expiry');
   assert.equal(await cleanup.cleanupOne(venues[0]!.venueId,new Date(shown)),id);
  }
 }finally{await madrid.end();}
});
