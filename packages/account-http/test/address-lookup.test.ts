import assert from 'node:assert/strict';
import {createHmac,generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {Pool} from 'pg';
import type {HttpBindings} from '@hono/node-server';
import {AllowanceConfigStore,BillingStore,createLeaseIssuer,reserveAllowance,transaction} from '@waitron-cloud/registration';
import {AccountRateLimiter} from '../src/rate-limit.ts';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {request as httpRequest} from 'node:http';
import {createGoogleAddressClient} from '../src/address-lookup-google.ts';

const origin='https://cloud.example.test';
async function fixture(configured=true){
 const db=await database();
 try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const v=await connectedVenue(db,issuer,origin);
  await new BillingStore(db.pool).execute({organisationId:v.organisationId,legalBusinessId:v.legalBusinessId},
   {key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'ensure_business'});
  const limit={transactional_email:'0',address_lookup:'100',sms:'0',content_translation:'0',rota_solver:'0'};
  if(configured)await new AllowanceConfigStore(db.pool).publish({revision:1,effectiveFrom:'2020-01-01',limits:{registered:limit,connected:limit,hosted:limit},unpaidTrial:{content_translation:'0',rota_solver:'0'}});
  const calls:{kind:string;token:string}[]=[];
  let failed=false;
  const provider=createGoogleAddressClient({apiKey:'synthetic-key',fetcher:async(url,options)=>{
   const body=JSON.parse(String(options!.body)),kind=String(url).includes('autocomplete')?'suggest':'validate';
   calls.push({kind,token:body.sessionToken});if(failed)return new Response('PRIVATE-REPLY',{status:503});
   return Response.json(kind==='suggest'?{suggestions:[{placePrediction:{text:{text:'Calle de Prueba 12, Madrid'}}}]}:
    {result:{address:{postalAddress:{regionCode:'ES',postalCode:'28013',locality:'Madrid'},addressComponents:[
     {componentType:'route',componentName:{text:'Calle de Prueba'}},{componentType:'street_number',componentName:{text:'12'}},
     {componentType:'administrative_area_level_2',componentName:{text:'Madrid'}},{componentType:'country',componentName:{text:'España'}},
    ]}}});
  }});
  const options={pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},
   addressLookup:{accountId:v.accountId,venueId:v.venueId,installationId:v.installationId,provider}};
  const app=createAccountApp(options);
  const request=async(envelope:unknown,target=app,headers:Record<string,string>={})=>target.request(origin+'/api/installations/address-lookup',{
   method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(envelope),
  },{incoming:{socket:{remoteAddress:'203.0.113.1'}}} as HttpBindings);
  const post=(body:unknown,operationId=randomUUID())=>request(v.proof('address-lookup',body,operationId,v.lease));
  return {db,v,issuer,calls,provider,app,options,post,request,setFailure:()=>{failed=true;}};
 }catch(error){await db.close();throw error;}
}
test('the signed trial reuses one counted hold and token, validates once and stores no address content',async()=>{
 const f=await fixture();try{
  const operations=(await f.db.pool.query('SELECT * FROM installation_operations WHERE installation_id=$1',[f.v.installationId])).rows;
  const workflowId=randomUUID(),body={version:1,kind:'suggest',workflowId,query:'PRIVATE-QUERY',language:'es'};
  const first=await f.post(body);assert.equal(first.status,200,await first.clone().text());
  const probe=await f.db.secondPool.connect();let acquired=false;
  try{
   acquired=(await probe.query("SELECT pg_try_advisory_lock(hashtext(current_schema()),hashtext('address-lookup:google')) AS locked")).rows[0].locked;
   assert.equal(acquired,true);
  }finally{if(acquired)await probe.query("SELECT pg_advisory_unlock(hashtext(current_schema()),hashtext('address-lookup:google'))");probe.release();}
  const reply=await first.json();assert.equal(first.headers.get('cache-control'),'no-store');
  assert.deepEqual(reply,{workflowId,expiresAt:reply.expiresAt,provider:'google',candidates:[{text:'Calle de Prueba 12, Madrid'}]});
  assert.ok(Date.parse(reply.expiresAt)>Date.now());assert.ok(Date.parse(reply.expiresAt)<=Date.now()+900000);
  assert.equal((await f.post({...body,query:'PRIVATE-QUERY next'})).status,200);
  const done=await f.post({version:1,kind:'validate',workflowId,selectedText:'PRIVATE-QUERY selected'});assert.equal(done.status,200,await done.clone().text());
  assert.equal((await done.json()).fields.addressLine1,'Calle de Prueba 12');
  assert.equal((await f.post(body)).status,409);
  const rows=(await f.db.pool.query("SELECT * FROM billing_allowance_reservations WHERE service='address_lookup'")).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].units,'1');assert.equal(rows[0].state,'spent');assert.equal(rows[0].operation_id,workflowId);
  assert.deepEqual(f.calls.map(c=>c.kind),['suggest','suggest','validate']);assert.deepEqual(f.calls.map(c=>c.token),[rows[0].id,rows[0].id,rows[0].id]);
  assert.equal(JSON.stringify(rows).includes('PRIVATE-QUERY'),false);
  assert.deepEqual((await f.db.pool.query('SELECT * FROM installation_operations WHERE installation_id=$1',[f.v.installationId])).rows,operations);
 }finally{await f.db.close();}
});

const suggestion=(workflowId=randomUUID())=>({version:1,kind:'suggest',workflowId,query:'PRIVATE-QUERY',language:'es'});
test('trial absence, unpublished allowance and invalid authority never reach Google',async()=>{
 const f=await fixture(false);try{
  const body=suggestion(),signed=f.v.proof('address-lookup',body,randomUUID(),f.v.lease);
  const options={...f.options,addressLookup:undefined};
  assert.equal((await f.request(signed,createAccountApp(options))).status,503);
  assert.equal((await f.post(body)).status,503);
  assert.equal((await f.request(signed,f.app,{origin})).status,403);
  assert.equal((await f.request({...signed,signature:'a'.repeat(86)})).status,401);
  assert.equal((await f.request(f.v.proof('configuration',body,randomUUID(),f.v.lease))).status,401);
  assert.equal((await f.request(f.v.proof('address-lookup',body))).status,401);
  assert.equal(f.calls.length,0);assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM billing_allowance_reservations')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('unknown validation and malformed input cannot open a hold',async()=>{
 const f=await fixture();try{
  assert.equal((await f.post({version:1,kind:'validate',workflowId:randomUUID(),selectedText:'PRIVATE-QUERY'})).status,409);
  for(const body of [{...suggestion(),query:'x'.repeat(513)},{...suggestion(),language:'fr'},{...suggestion(),accountId:f.v.accountId},
   {version:1,kind:'suggest',workflowId:'not-an-id',query:'x',language:'es'},{version:1,kind:'validate',workflowId:randomUUID(),selectedText:'x'.repeat(279)}]){
   assert.equal((await f.post(body)).status,400);
  }
  assert.equal(f.calls.length,0);assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM billing_allowance_reservations')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('a second test box, production and revocation cannot borrow this trial',async()=>{
 const f=await fixture();try{
  const body=suggestion(),other=await connectedVenue(f.db,f.issuer,origin);
  assert.equal((await f.request(other.proof('address-lookup',body,randomUUID(),other.lease))).status,403);
  await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.v.venueId]);
  const now=Date.now(),lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'production',publicKey:f.v.installationKey,issuedAt:now,expiresAt:now+3600000});
  assert.equal((await f.request(f.v.proof('address-lookup',body,randomUUID(),lease))).status,403);
  await f.db.pool.query("UPDATE venues SET environment='test' WHERE id=$1",[f.v.venueId]);
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.v.installationId]);
  assert.equal((await f.post(body)).status,403);assert.equal(f.calls.length,0);
 }finally{await f.db.close();}
});
test('busy and replay refusals spend no extra hold or provider attempt',async()=>{
 const f=await fixture(),client=await f.db.pool.connect();try{
  await client.query("SELECT pg_advisory_lock(hashtext(current_schema()),hashtext('address-lookup:google'))");
  const body=suggestion();assert.equal((await f.post(body)).status,409);
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM billing_allowance_reservations')).rows[0].n,0);
  await client.query("SELECT pg_advisory_unlock(hashtext(current_schema()),hashtext('address-lookup:google'))");
  const id=randomUUID();assert.equal((await f.post(body,id)).status,200);assert.equal((await f.post(body,id)).status,409);
  assert.equal((await f.post(body)).status,200);assert.equal(f.calls.length,2);
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM billing_allowance_reservations')).rows[0].n,1);
 }finally{client.release();await f.db.close();}
});
test('eight suggestions close the workflow suggestion budget and uncertain validation remains spent',async()=>{
 const f=await fixture();try{
  const body=suggestion();for(let i=0;i<8;i++)assert.equal((await f.post(body)).status,200);
  const row=(await f.db.pool.query('SELECT id FROM billing_allowance_reservations')).rows[0];
  const key=createHmac('sha256',Buffer.from(f.db.rateKey,'hex')).update(JSON.stringify(['address-lookup-workflow',row.id])).digest('hex');
  await f.db.pool.query("UPDATE account_rate_limits SET expires_at=clock_timestamp()+interval '120 seconds' WHERE key=$1",[key]);
  assert.equal((await f.post(body)).status,429);assert.equal(f.calls.length,8);
  f.setFailure();const validate={version:1,kind:'validate',workflowId:body.workflowId,selectedText:'PRIVATE-QUERY'};
  const failure=await f.post(validate);assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{error:'unavailable',dispatched:true});
  assert.equal((await f.post(validate)).status,409);assert.equal(f.calls.length,9);
  assert.equal((await f.db.pool.query('SELECT state FROM billing_allowance_reservations')).rows[0].state,'spent');
 }finally{await f.db.close();}
});
test('twenty suggestions per UTC date refuse the next request without consuming another workflow',async()=>{
 const f=await fixture();try{
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  for(let i=0;i<20;i++)assert.equal((await f.post(suggestion(ids[Math.floor(i/8)]!))).status,200);
  const denied=await f.post(suggestion());assert.equal(denied.status,429);assert.ok(Number(denied.headers.get('retry-after'))>0);
  assert.equal(f.calls.length,20);assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM billing_allowance_reservations')).rows[0].n,3);
 }finally{await f.db.close();}
});
test('ten counted workflows cap the account even when the published tier permits a hundred',async()=>{
 const f=await fixture();try{
  for(let i=0;i<9;i++)assert.equal((await f.post(suggestion())).status,200);
  const pair=await Promise.all([f.post(suggestion()),f.post(suggestion())]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.post(suggestion())).status,429);assert.equal(f.calls.length,10);
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM billing_allowance_reservations')).rows[0].n,10);
 }finally{await f.db.close();}
});
async function blocked(pool:Pool,schema:string){
 const end=Date.now()+10000;
 while(Date.now()<end){
  if((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[schema])).rows[0].n>0)return;
  await delay(10);
 }
 assert.fail('the trial never reached its controlled database lock');
}
test('losing verified-account authority during a lock wait rolls back the new hold',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<Response>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 FOR UPDATE',[f.v.accountId]);
  pending=f.post(suggestion());await blocked(f.db.pool,f.db.schema);
  await holder.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.v.accountId]);await holder.query('COMMIT');
  assert.equal((await pending).status,403);assert.equal(f.calls.length,0);
  assert.equal((await f.db.pool.query('SELECT count(*)::int AS n FROM billing_allowance_reservations')).rows[0].n,0);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});
test('a lease expiring during counter contention cannot authorize a provider call',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<Response>|undefined;
 try{
  const body=suggestion();assert.equal((await f.post(body)).status,200);
  const saved=(await f.db.pool.query('SELECT id FROM billing_allowance_reservations')).rows[0];
  const key=createHmac('sha256',Buffer.from(f.db.rateKey,'hex')).update(JSON.stringify(['address-lookup-workflow',saved.id])).digest('hex');
  await holder.query('BEGIN');await holder.query('SELECT key FROM account_rate_limits WHERE key=$1 FOR UPDATE',[key]);
  const now=Date.now(),expiresAt=now+5000;
  const lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'test',publicKey:f.v.installationKey,issuedAt:now,expiresAt});
  pending=f.request(f.v.proof('address-lookup',body,randomUUID(),lease));await blocked(f.db.pool,f.db.schema);
  await delay(Math.max(0,expiresAt-Date.now()+20));await holder.query('COMMIT');
  assert.equal((await pending).status,401);assert.equal(f.calls.length,1);
  assert.equal((await f.db.pool.query('SELECT attempts FROM account_rate_limits WHERE key=$1',[key])).rows[0].attempts,1);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});
test('expired workflow bindings stay counted and cannot reopen after counter pruning',async()=>{
 const f=await fixture();try{
  const now=(await f.db.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime(),workflowId=randomUUID();
  await transaction(f.db.pool,client=>reserveAllowance(client,{accountId:f.v.accountId,venueId:f.v.venueId,installationId:f.v.installationId,
   service:'address_lookup',operationId:workflowId,units:1n,binding:JSON.stringify({version:1,createdAt:new Date(now-800000).toISOString(),expiresAt:new Date(now-1).toISOString()})}));
  const limiter=new AccountRateLimiter(f.db.pool,f.db.rateKey);await limiter.consume([{scope:'address-lookup-call',subject:'expired-proof',limit:1,windowSeconds:1}]);
  await f.db.pool.query("UPDATE account_rate_limits SET expires_at=clock_timestamp()-interval '1 second'");assert.ok(await limiter.prune()>0);
  assert.equal((await f.post(suggestion(workflowId))).status,410);assert.equal(f.calls.length,0);
  const rows=(await f.db.pool.query('SELECT state,units FROM billing_allowance_reservations')).rows;assert.deepEqual(rows,[{state:'held',units:'1'}]);
 }finally{await f.db.close();}
});
test('the real account listener receives the injected trial through its existing signed connection',async()=>{
 const f=await fixture();let running:Awaited<ReturnType<typeof startAccountServer>>|undefined;
 try{
  running=await startAccountServer({...f.options,host:'127.0.0.1',port:0});const bound=running.server.address();assert.ok(bound&&typeof bound!=='string');
  const proof=f.v.proof('address-lookup',suggestion(),randomUUID(),f.v.lease);
  const response=await new Promise<{status:number;body:string}>((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port:bound.port,path:'/api/installations/address-lookup',method:'POST',timeout:5000,
    headers:{host:'cloud.example.test','content-type':'application/json'}},res=>{
    let body='';res.on('data',part=>{body+=part;});res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode!,body}));
   });req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('trial listener timeout')));req.end(JSON.stringify(proof));
  });
  assert.equal(response.status,200,response.body);assert.deepEqual(JSON.parse(response.body).candidates,[{text:'Calle de Prueba 12, Madrid'}]);assert.equal(f.calls.length,1);
 }finally{await running?.close();await f.db.close();}
});
