import assert from 'node:assert/strict';
import {createHmac,generateKeyPairSync,randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {Pool,PoolClient} from 'pg';
import type {HttpBindings} from '@hono/node-server';
import {BillingStore,createLeaseIssuer,transaction,type SignedEnvelope} from '@waitron-cloud/registration';
import {createSession} from '@waitron-cloud/identity';
import {openProofWindow} from '../../registration/test/fixtures/action-proof.ts';
import {AccountRateLimiter} from '../src/rate-limit.ts';
import {AddressLookupMachine} from '../src/address-lookup.ts';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {createGoogleAddressClient} from '../src/address-lookup-google.ts';

const origin='https://cloud.example.test',ip='203.0.113.1';
const policy={suggestionMicros:10,validationMicros:20,
 paidVenueMonth:{suggestions:500,validations:100},freeAccountMonth:{suggestions:100,validations:20},
 cloudDay:{freeSuggestions:5000,freeValidations:500,limitMicros:100},
 cloudMonth:{freeSuggestions:50000,freeValidations:5000,limitMicros:1000},
 freeDay:{freeSuggestions:1500,freeValidations:150,limitMicros:30},
 freeMonth:{freeSuggestions:15000,freeValidations:1500,limitMicros:300}};
const suggest=(workflowId=randomUUID())=>({version:1,kind:'suggest',workflowId,query:'PRIVATE-QUERY',language:'es'});
const validate=(workflowId:string)=>({version:1,kind:'validate',workflowId,selectedText:'PRIVATE-QUERY selected'});
const available={version:1,kind:'available'};
const calls=(pool:Pool)=>pool.query('SELECT * FROM address_lookup_calls ORDER BY admitted_at').then(result=>result.rows);
function rateKey(secret:string,scope:string,subject:string){
 return createHmac('sha256',Buffer.from(secret,'hex')).update(JSON.stringify([scope,subject])).digest('hex');
}
async function fixture(){
 const db=await database();
 try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const v=await connectedVenue(db,issuer,origin),sent:string[]=[];
  let failed=false;
  const provider=createGoogleAddressClient({apiKey:'synthetic-key',fetcher:async url=>{
   const kind=String(url).includes('autocomplete')?'suggest':'validate';
   sent.push(kind);if(failed)return new Response('PRIVATE-REPLY',{status:503});
   return Response.json(kind==='suggest'?{suggestions:[{placePrediction:{text:{text:'Calle de Prueba 12, Madrid'}}}]}:
    {result:{address:{postalAddress:{regionCode:'ES',postalCode:'28013',locality:'Madrid'},addressComponents:[
     {componentType:'route',componentName:{text:'Calle de Prueba'}},{componentType:'street_number',componentName:{text:'12'}},
     {componentType:'administrative_area_level_2',componentName:{text:'Madrid'}},{componentType:'country',componentName:{text:'España'}},
    ]}}});
  }});
  const options={pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},
   addressLookup:{provider,policy}};
  const app=createAccountApp(options);
  const request=async(envelope:SignedEnvelope,target=app,headers:Record<string,string>={})=>target.request(origin+'/api/installations/address-lookup',{
   method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(envelope),
  },{incoming:{socket:{remoteAddress:ip}}} as HttpBindings);
  const post=(body:unknown,operationId=randomUUID())=>request(v.proof('address-lookup',body,operationId,v.lease));
  return {db,v,issuer,sent,provider,app,options,post,request,setFailure:()=>{failed=true;}};
 }catch(error){await db.close();throw error;}
}

test('the signed route counts abandoned searches and stores no address content',async()=>{
 const f=await fixture();try{
  const operations=(await f.db.pool.query('SELECT * FROM installation_operations WHERE installation_id=$1',[f.v.installationId])).rows;
  const body=suggest(),first=await f.post(body);
  assert.equal(first.status,200,await first.clone().text());
  const reply=await first.json();assert.equal(first.headers.get('cache-control'),'no-store');
  assert.deepEqual(reply,{workflowId:body.workflowId,expiresAt:reply.expiresAt,provider:'google',candidates:[{text:'Calle de Prueba 12, Madrid'}]});
  assert.ok(Date.parse(reply.expiresAt)>Date.now());assert.ok(Date.parse(reply.expiresAt)<=Date.now()+900000);
  const second=await f.post(suggest());assert.equal(second.status,200);
  const done=await f.post(validate(body.workflowId));assert.equal(done.status,200,await done.clone().text());
  assert.equal((await done.json()).fields.addressLine1,'Calle de Prueba 12');
  assert.equal((await f.post(body)).status,409);
  const saved=await calls(f.db.pool);
  assert.deepEqual(saved.map(row=>[row.kind,row.class,row.workflow_id]),[
   ['suggest','free',body.workflowId],['suggest','free',(await second.json()).workflowId],['validate','free',body.workflowId],
  ]);
  assert.deepEqual(f.sent,['suggest','suggest','validate']);
  assert.equal(JSON.stringify(saved).includes('PRIVATE-QUERY'),false);
  assert.deepEqual((await f.db.pool.query('SELECT * FROM installation_operations WHERE installation_id=$1',[f.v.installationId])).rows,operations);
 }finally{await f.db.close();}
});

test('signed availability returns a JSON object without a provider call or address debit',async()=>{
 const f=await fixture();try{
  const response=await f.post(available);
  assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(await response.json(),{available:true});
  await f.db.pool.query('INSERT INTO address_lookup_stopped_venues(venue_id) VALUES($1)',[f.v.venueId]);
  assert.equal((await f.post(available)).status,403);
  assert.equal((await f.post(suggest())).status,403);
  assert.deepEqual(f.sent,[]);
  assert.deepEqual(await calls(f.db.pool),[]);
 }finally{await f.db.close();}
});

test('lookups spend their own minute counters and availability uses ordinary installation limits',async()=>{
 const f=await fixture();try{
  const limiter=new AccountRateLimiter(f.db.pool,f.db.rateKey),installation=f.v.installationId;
  await limiter.consume([{scope:'installation-key',subject:installation,limit:30,windowSeconds:60}]);
  await f.db.pool.query('UPDATE account_rate_limits SET attempts=30 WHERE key=$1',[rateKey(f.db.rateKey,'installation-key',installation)]);
  const call=await f.post(suggest());assert.equal(call.status,200,await call.clone().text());
  assert.equal((await f.post(available)).status,429);
  const lookupKey=rateKey(f.db.rateKey,'address-lookup-box',installation);
  assert.equal((await f.db.pool.query('SELECT attempts FROM account_rate_limits WHERE key=$1',[lookupKey])).rows[0].attempts,1);
  const ownerKey=rateKey(f.db.rateKey,'address-lookup-owner',f.v.accountId);
  await f.db.pool.query('UPDATE account_rate_limits SET attempts=60 WHERE key=$1',[ownerKey]);
  assert.equal((await f.post(suggest())).status,429);
  await f.db.pool.query('UPDATE account_rate_limits SET attempts=1 WHERE key=$1',[ownerKey]);
  await f.db.pool.query('UPDATE account_rate_limits SET attempts=30 WHERE key=$1',[lookupKey]);
  assert.equal((await f.post(suggest())).status,429);
  assert.equal((await calls(f.db.pool)).length,1);assert.deepEqual(f.sent,['suggest']);
 }finally{await f.db.close();}
});

test('refused signed lookups still use the minute limits',async()=>{
 const f=await fixture();try{
  for(let i=0;i<15;i++){
   assert.equal((await f.post(validate(randomUUID()))).status,409);
   assert.equal((await f.post({...suggest(),language:'fr'})).status,400);
  }
  assert.equal((await f.post(validate(randomUUID()))).status,429);
  const owner=rateKey(f.db.rateKey,'address-lookup-owner',f.v.accountId);
  assert.equal((await f.db.pool.query('SELECT attempts FROM account_rate_limits WHERE key=$1',[owner])).rows[0].attempts,30);
  const network=rateKey(f.db.rateKey,'address-lookup-network',ip);
  await f.db.pool.query('UPDATE account_rate_limits SET attempts=60 WHERE key=$1',[network]);
  const signed=f.v.proof('address-lookup',suggest(),randomUUID(),f.v.lease);
  assert.equal((await f.request({...signed,signature:'a'.repeat(86)})).status,429);
  assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),[]);
 }finally{await f.db.close();}
});

test('a second box cannot validate another box’s workflow',async()=>{
 const f=await fixture();try{
  const other=await connectedVenue(f.db,f.issuer,origin);
  const post=(body:unknown)=>f.request(other.proof('address-lookup',body,randomUUID(),other.lease));
  const body=suggest();assert.equal((await f.post(body)).status,200);
  assert.equal((await post(validate(body.workflowId))).status,409);
  assert.equal((await post(body)).status,200);
  const saved=await calls(f.db.pool);
  assert.deepEqual(saved.map(row=>[row.installation_id,row.account_id,row.workflow_id]),[
   [f.v.installationId,f.v.accountId,body.workflowId],[other.installationId,other.accountId,body.workflowId],
  ]);
 }finally{await f.db.close();}
});

test('the current owner controls access after a transfer and pairing history cleanup',async()=>{
 const f=await fixture();try{
  const other=await connectedVenue(f.db,f.issuer,origin);
  await f.db.pool.query('DELETE FROM connection_requests WHERE installation_key=$1',[f.v.installationKey]);
  const previous=suggest();assert.equal((await f.post(previous)).status,200);
  await f.db.pool.query('UPDATE organisation_memberships SET account_id=$1 WHERE account_id=$2 AND organisation_id=$3',
   [other.accountId,f.v.accountId,f.v.organisationId]);
  assert.equal((await f.post(previous)).status,409);
  const current=suggest();assert.equal((await f.post(current)).status,200);
  assert.deepEqual((await calls(f.db.pool)).map(row=>[row.workflow_id,row.account_id]),[
   [previous.workflowId,f.v.accountId],[current.workflowId,other.accountId],
  ]);
  assert.equal(f.sent.length,2);
 }finally{await f.db.close();}
});

test('disabled lookup, browser origin and invalid installation proofs send nothing',async()=>{
 const f=await fixture();try{
  assert.throws(()=>createAccountApp({...f.options,addressLookup:{provider:f.provider,policy:{...policy,validationMicros:0}}}),
   /invalid_address_lookup_configuration/);
  const body=suggest(),signed=f.v.proof('address-lookup',body,randomUUID(),f.v.lease);
  assert.equal((await f.request(signed,createAccountApp({...f.options,addressLookup:undefined}))).status,503);
  assert.equal((await f.request(signed,f.app,{origin})).status,403);
  assert.equal((await f.request({...signed,signature:'a'.repeat(86)})).status,401);
  assert.equal((await f.request(f.v.proof('configuration',body,randomUUID(),f.v.lease))).status,401);
  assert.equal((await f.request(f.v.proof('address-lookup',body))).status,401);
  assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),[]);
 }finally{await f.db.close();}
});

test('unknown workflows and malformed input cannot debit usage',async()=>{
 const f=await fixture();try{
  assert.equal((await f.post(validate(randomUUID()))).status,409);
  for(const body of [{...suggest(),query:'x'.repeat(513)},{...suggest(),language:'fr'},{...suggest(),language:['es']},{...suggest(),language:['en']},
   {...suggest(),accountId:f.v.accountId},{...suggest(),workflowId:'not-an-id'},
   {...validate(randomUUID()),selectedText:'x'.repeat(279)},{...available,workflowId:randomUUID()}])assert.equal((await f.post(body)).status,400);
  assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),[]);
 }finally{await f.db.close();}
});

test('production and revoked installations cannot use the test service',async()=>{
 const f=await fixture();try{
  await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.v.venueId]);
  const now=Date.now(),lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'production',publicKey:f.v.installationKey,issuedAt:now,expiresAt:now+3600000});
  assert.equal((await f.request(f.v.proof('address-lookup',suggest(),randomUUID(),lease))).status,403);
  await f.db.pool.query("UPDATE venues SET environment='test' WHERE id=$1",[f.v.venueId]);
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.v.installationId]);
  assert.equal((await f.post(suggest())).status,403);assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),[]);
 }finally{await f.db.close();}
});

test('replayed operation IDs and uncertain validation cannot cause another provider call',async()=>{
 const f=await fixture();try{
  const body=suggest(),id=randomUUID();
  assert.equal((await f.post(body,id)).status,200);
  assert.equal((await f.post(suggest(),id)).status,409);
  assert.equal((await f.post(body)).status,200);
  f.setFailure();
  const rejected=await f.post(validate(body.workflowId));
  assert.equal(rejected.status,503);assert.deepEqual(await rejected.json(),{error:'unavailable',dispatched:true});
  assert.equal((await f.post(validate(body.workflowId))).status,409);
  assert.deepEqual(f.sent,['suggest','suggest','validate']);assert.equal((await calls(f.db.pool)).length,3);
 }finally{await f.db.close();}
});

async function blocked(pool:Pool,schema:string){
 const end=Date.now()+10000;
 while(Date.now()<end){
  if((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[schema])).rows[0].n>0)return;
  await delay(10);
 }
 assert.fail('the lookup never reached its controlled database lock');
}

test('waiting for one owner does not hold up another owner’s search',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();
 let waiting:Promise<Response>|undefined,unrelated:Promise<Response>|undefined;
 try{
  const other=await connectedVenue(f.db,f.issuer,origin);
  await holder.query('BEGIN');
  await holder.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[f.v.accountId]);
  waiting=f.post(suggest());await blocked(f.db.pool,f.db.schema);
  unrelated=f.request(other.proof('address-lookup',suggest(),randomUUID(),other.lease));
  const result=await Promise.race([unrelated,delay(1500)]);
  assert.equal(result?.status,200,'the unrelated owner must finish while the first owner is locked');
 }finally{
  await holder.query('ROLLBACK');holder.release();await Promise.allSettled([waiting,unrelated]);await f.db.close();
 }
});

test('losing verified-account authority during a lock wait rolls back the debit',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<Response>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 FOR UPDATE',[f.v.accountId]);
  pending=f.post(suggest());await blocked(f.db.pool,f.db.schema);
  await holder.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.v.accountId]);await holder.query('COMMIT');
  assert.equal((await pending).status,403);assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),[]);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});

test('a lease expiring during the owner lock wait cannot authorize a provider call',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<Response>|undefined;
 try{
  const body=suggest();assert.equal((await f.post(body)).status,200);
  const key=rateKey(f.db.rateKey,'address-lookup-box',f.v.installationId);
  await holder.query('BEGIN');await holder.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[f.v.accountId]);
  const now=Date.now(),expiresAt=now+3000;
  const lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'test',publicKey:f.v.installationKey,issuedAt:now,expiresAt});
  pending=f.request(f.v.proof('address-lookup',body,randomUUID(),lease));await blocked(f.db.pool,f.db.schema);
  await delay(Math.max(0,expiresAt-Date.now()+20));await holder.query('COMMIT');
  assert.equal((await pending).status,401);assert.equal(f.sent.length,1);
  assert.equal((await f.db.pool.query('SELECT attempts FROM account_rate_limits WHERE key=$1',[key])).rows[0].attempts,2);
  assert.equal((await calls(f.db.pool)).length,1);
 }finally{await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await f.db.close();}
});

async function seedSearch(pool:Pool,box:{installationId:string;venueId:string;accountId:string},workflowId:string,at:Date){
 await pool.query(`INSERT INTO address_lookup_calls(installation_id,operation_id,workflow_id,venue_id,account_id,class,kind,admitted_at)
  VALUES($1,$2,$3,$4,$5,'free','suggest',$6)`,[box.installationId,randomUUID(),workflowId,box.venueId,box.accountId,at]);
}

test('expired workflows stay counted and cannot reopen after counter pruning',async()=>{
 const f=await fixture();try{
  const workflowId=randomUUID();await seedSearch(f.db.pool,f.v,workflowId,new Date(Date.now()-901000));
  const limiter=new AccountRateLimiter(f.db.pool,f.db.rateKey);await limiter.consume([{scope:'address-lookup-box',subject:f.v.installationId,limit:30,windowSeconds:60}]);
  await f.db.pool.query("UPDATE account_rate_limits SET expires_at=clock_timestamp()-interval '1 second'");assert.ok(await limiter.prune()>0);
  assert.equal((await f.post(suggest(workflowId))).status,410);assert.deepEqual(f.sent,[]);
  assert.equal((await calls(f.db.pool)).length,1);
 }finally{await f.db.close();}
});

function postToListener(port:number,proof:SignedEnvelope){
 return new Promise<{status:number;body:string}>((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port,path:'/api/installations/address-lookup',method:'POST',timeout:8000,
   headers:{host:'cloud.example.test','content-type':'application/json'}},res=>{
   let body='';res.on('data',part=>{body+=part;});res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode!,body}));
  });req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('address lookup listener timed out')));req.end(JSON.stringify(proof));
 });
}

test('two boxes including two tills on one box reach the provider before any lookup finishes',async()=>{
 const f=await fixture();
 let release!:()=>void,allArrived!:()=>void;
 const finished=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{allArrived=resolve;});
 const responses:ReturnType<typeof postToListener>[]=[];
 let running:Awaited<ReturnType<typeof startAccountServer>>|undefined;
 try{
  const other=await connectedVenue(f.db,f.issuer,origin);let arrived=0;
  const provider={...f.provider,async suggest(...args:Parameters<typeof f.provider.suggest>){
   if(++arrived===3)allArrived();
   await finished;
   return f.provider.suggest(...args);
  }};
  running=await startAccountServer({...f.options,addressLookup:{provider,policy},host:'127.0.0.1',port:0});
  const bound=running.server.address();assert.ok(bound&&typeof bound!=='string');
  for(const box of [f.v,f.v,other])responses.push(postToListener(bound.port,box.proof('address-lookup',suggest(),randomUUID(),box.lease)));
  assert.equal(await Promise.race([entered.then(()=> 'all reached provider'),...responses]),'all reached provider');
  release();
  for(const response of await Promise.all(responses)){
   assert.equal(response.status,200,response.body);
   assert.deepEqual(JSON.parse(response.body).candidates,[{text:'Calle de Prueba 12, Madrid'}]);
  }
 }finally{release();await Promise.allSettled(responses);await running?.close();await f.db.close();}
});

test('at the illustrative test prices, one paid venue stops at 500 searches and all free owners share 440',async()=>{
 const f=await fixture();let running:Awaited<ReturnType<typeof startAccountServer>>|undefined;
 try{
  const paid=await connectedVenue(f.db,f.issuer,origin),billing=new BillingStore(f.db.pool);
  const identity={organisationId:paid.organisationId,legalBusinessId:paid.legalBusinessId};
  const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
  await billing.execute(identity,event(),{type:'ensure_business'});
  await billing.execute(identity,event(),{type:'set_venue',venueId:paid.venueId,expectedRevision:0,
   value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
  async function populate(box:typeof paid,tier:'free'|'paid',count:number){
   await f.db.pool.query(`INSERT INTO address_lookup_calls(installation_id,operation_id,workflow_id,venue_id,account_id,class,kind,admitted_at)
    SELECT $1,gen_random_uuid(),gen_random_uuid(),$2,$3,$4,'suggest',clock_timestamp() FROM generate_series(1,$5)`,
    [box.installationId,box.venueId,box.accountId,tier,count]);
  }
  await populate(paid,'paid',499);
  await populate(f.v,'free',39);
  for(let i=0;i<4;i++)await populate(await connectedVenue(f.db,f.issuer,origin),'free',100);
  const priced={...policy,suggestionMicros:3113,validationMicros:18700,
   cloudDay:{freeSuggestions:1000,freeValidations:500,limitMicros:1000000},
   cloudMonth:{freeSuggestions:10000,freeValidations:5000,limitMicros:10000000},
   freeDay:{freeSuggestions:333,freeValidations:166,limitMicros:333333},
   freeMonth:{freeSuggestions:3333,freeValidations:1666,limitMicros:3333333}};
  running=await startAccountServer({...f.options,addressLookup:{provider:f.provider,policy:priced},host:'127.0.0.1',port:0});
  const bound=running.server.address();assert.ok(bound&&typeof bound!=='string');
  const post=(box:typeof paid,body:unknown)=>postToListener(bound.port,box.proof('address-lookup',body,randomUUID(),box.lease));
  assert.equal((await post(f.v,suggest())).status,200);
  assert.equal((await post(f.v,suggest())).status,429);
  assert.equal((await post(f.v,available)).status,429);
  const lastPaid=suggest();
  assert.equal((await post(paid,lastPaid)).status,200);
  assert.equal((await post(paid,suggest())).status,429);
  assert.equal((await post(paid,validate(lastPaid.workflowId))).status,200);
  assert.deepEqual(f.sent,['suggest','suggest','validate']);
  const counts=await f.db.pool.query("SELECT class,count(*)::int AS searches FROM address_lookup_calls WHERE kind='suggest' GROUP BY class ORDER BY class");
  assert.deepEqual(counts.rows,[{class:'free',searches:440},{class:'paid',searches:500}]);
 }finally{await running?.close();await f.db.close();}
});

function admissionMachine(f:Awaited<ReturnType<typeof fixture>>,control:(sql:string,client?:PoolClient)=>Date|{now:Date;day:string}|void){
 function query(target:Pool|PoolClient,client?:PoolClient){
  return (sql:string,...args:unknown[])=>{
   const clock=control(sql,client);if(clock)return Promise.resolve({rows:[clock instanceof Date?{now:clock}:clock]});
   return Reflect.apply(target.query,target,[sql,...args]);
  };
 }
 const pool={query:query(f.db.pool),connect:async()=>{
  const client=await f.db.pool.connect();
  return new Proxy(client,{get(target,key){
   if(key==='query')return query(target,client);
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
 }} as Pool;
 return new AddressLookupMachine(pool,f.issuer,origin,f.db.rateKey,f.options.addressLookup);
}

async function assertLookupThrottles(f:Awaited<ReturnType<typeof fixture>>,attempts:number){
 const keys=[rateKey(f.db.rateKey,'address-lookup-box',f.v.installationId),rateKey(f.db.rateKey,'address-lookup-owner',f.v.accountId)];
 const {rows}=await f.db.pool.query('SELECT key,attempts FROM account_rate_limits ORDER BY key');
 assert.deepEqual(rows,keys.sort().map(key=>({key,attempts})));
}

test('workflow expiry during admission rolls back suggestions and validations',async()=>{
 const f=await fixture();try{
  for(const [index,kind] of (['suggest','validate'] as const).entries()){
   const workflowId=randomUUID(),now=Date.now();await seedSearch(f.db.pool,f.v,workflowId,new Date(now-895000));
   const saved=await calls(f.db.pool);let reads=0;
   const machine=admissionMachine(f,sql=>{if(sql==='SELECT clock_timestamp() AS now'&&++reads===2)return new Date(now+10000);});
   const body=kind==='suggest'?suggest(workflowId):validate(workflowId);
   await assert.rejects(()=>machine.execute(f.v.proof('address-lookup',body,randomUUID(),f.v.lease)),{status:410});
   assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),saved);
   await assertLookupThrottles(f,index+1);
  }
 }finally{await f.db.close();}
});

test('crossing a Pacific date before dispatch rolls back the earlier date’s debit',async()=>{
 const f=await fixture();try{
  const now=new Date('2026-01-02T07:59:59.900Z'),after=new Date('2026-01-02T08:00:00.100Z');
  let reads=0;
  const machine=admissionMachine(f,sql=>{
   if(sql==='SELECT clock_timestamp() AS now')return ++reads===1?now:after;
   if(sql.startsWith('SELECT now,(now AT TIME ZONE'))return {now,day:'2026-01-01'};
  });
  const lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'test',publicKey:f.v.installationKey,issuedAt:+now,expiresAt:+now+3600000});
  await assert.rejects(()=>machine.execute(f.v.proof('address-lookup',suggest(),randomUUID(),lease,undefined,+now)),{status:503});
  assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),[]);await assertLookupThrottles(f,1);
 }finally{await f.db.close();}
});

test('connection loss during admission commits no address usage and sends nothing',async()=>{
 const f=await fixture();try{
  let reads=0;
  const machine=admissionMachine(f,(sql,client)=>{if(sql==='SELECT clock_timestamp() AS now'&&++reads===2)client?.emit('error',new Error('controlled connection loss'));});
  await assert.rejects(()=>machine.execute(f.v.proof('address-lookup',suggest(),randomUUID(),f.v.lease)),{code:'unavailable',dispatched:false});
  assert.deepEqual(f.sent,[]);assert.deepEqual(await calls(f.db.pool),[]);await assertLookupThrottles(f,1);
 }finally{await f.db.close();}
});

test('the operator can stop one venue and resume it with its address usage intact',async()=>{
 const f=await fixture();try{
  const other=await connectedVenue(f.db,f.issuer,origin);
  const operator=await transaction(f.db.pool,client=>createSession(client,other.accountId));
  await openProofWindow(f.db.pool,operator.token);
  const app=createAccountApp({...f.options,operatorAccountId:other.accountId});
  const save=(stopped:boolean)=>app.request(origin+'/api/account/operator/actions/address-lookup',{method:'POST',
   headers:{cookie:`__Host-cloud_session=${operator.token}`,origin,'content-type':'application/json','x-csrf-token':operator.csrfToken},
   body:JSON.stringify({venueId:f.v.venueId,stopped})},{incoming:{socket:{remoteAddress:ip}}} as HttpBindings);
  const first=suggest();assert.equal((await f.post(first)).status,200);
  assert.equal((await save(true)).status,200);
  assert.equal((await f.post(available)).status,403);
  assert.equal((await f.post(suggest())).status,403);
  assert.equal((await f.request(other.proof('address-lookup',suggest(),randomUUID(),other.lease))).status,200);
  assert.deepEqual(f.sent,['suggest','suggest']);
  assert.equal((await save(false)).status,200);
  assert.equal((await f.post(validate(first.workflowId))).status,200);
  assert.deepEqual((await calls(f.db.pool)).map(row=>[row.venue_id,row.kind]),[
   [f.v.venueId,'suggest'],[other.venueId,'suggest'],[f.v.venueId,'validate'],
  ]);
 }finally{await f.db.close();}
});

test('a failed cap warning retries and concurrent refusals queue only one warning without spending a lookup',async()=>{
 const f=await fixture();try{
  const operator=await connectedVenue(f.db,f.issuer,origin);
  const app=createAccountApp({...f.options,operatorAccountId:operator.accountId,addressLookup:{provider:f.provider,
   policy:{...policy,freeAccountMonth:{suggestions:1,validations:1}}}});
  const request=(body:unknown)=>f.request(f.v.proof('address-lookup',body,randomUUID(),f.v.lease),app);
  const queued=()=>f.db.pool.query("SELECT * FROM email_outbox WHERE kind='operator_notice'").then(result=>result.rows);
  assert.equal((await request(suggest())).status,200);
  assert.deepEqual(await queued(),[]);
  await f.db.pool.query(`ALTER TABLE email_outbox ADD CONSTRAINT test_refuse_operator_notice CHECK (kind<>'operator_notice')`);
  assert.equal((await request(available)).status,429);
  assert.deepEqual(await queued(),[]);
  await f.db.pool.query('ALTER TABLE email_outbox DROP CONSTRAINT test_refuse_operator_notice');
  const replies=await Promise.all([request(suggest()),request(available),request(suggest())]);
  assert.deepEqual(replies.map(reply=>reply.status),[429,429,429]);
  assert.deepEqual(replies.map(reply=>reply.headers.get('retry-after')),['60','60','60']);
  const notices=await queued();assert.equal(notices.length,1);
  const message=f.db.outbox.open(notices[0]);
  const email=(await f.db.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[operator.accountId])).rows[0].email;
  assert.deepEqual(message,{email,locale:'en',event:'address_cap',accountId:operator.accountId,
   bucket:'free_account_month',period:(await f.db.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Los_Angeles','YYYY-MM') AS month")).rows[0].month,venueId:f.v.venueId});
  assert.equal((await calls(f.db.pool)).length,1);
  assert.deepEqual(f.sent,['suggest']);
 }finally{await f.db.close();}
});
