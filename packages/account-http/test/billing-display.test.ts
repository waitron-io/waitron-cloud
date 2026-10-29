import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {BillingPriceStore} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {AccountRateLimiter} from '../src/rate-limit.ts';
import {fixture,fault,origin,path,now} from './fixtures/billing-display.ts';

// Removing the route, proof/budget gate or wire binding must break these actual HTTP reads.
test('billing HTTP returns the exact registered binding without writing business or installation state',async t=>{
 const f=await fixture(t);
 const snapshot=async()=>{
  const result:Record<string,unknown>={};
  for(const {tablename} of (await f.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'account_rate_limits' ORDER BY tablename",[f.schema])).rows)
   result[tablename]=(await f.pool.query(`SELECT to_jsonb(t) FROM ${tablename} t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
 };
 const before=await snapshot(),response=await f.send();assert.equal(response.status,200);
 const text=await response.text();assert.ok(Buffer.byteLength(text,'utf8')<=16384);
 assert.deepEqual(JSON.parse(text),{version:1,installationId:f.installationId,venueId:f.venueId,countryCode:'ES',calendarTimeZone:'Europe/Madrid',asOf:'2026-11-02T11:00:00.000Z',
  billing:{status:'ready',level:'registered',state:'active',period:null},prices:{status:'unavailable',reason:'not_published'},accountUrl:origin+'/account'});
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('etag'),null);
 assert.deepEqual(await snapshot(),before);
});
test('billing HTTP keeps published prices when stored billing state is not ready',async t=>{
 const f=await fixture(t);await f.level();
 await f.command({type:'start_trial',venueId:f.venueId,level:'connected',on:'2026-10-01'});
 await new BillingPriceStore(f.pool).publish({revision:1,effectiveFrom:'2026-10-01',currency:'EUR',prices:{connectedMonthlyCents:3000,hostedMonthlyCents:9000},vatRateBasisPoints:2100});
 const response=await f.send();assert.equal(response.status,200);const body=await response.json();
 assert.deepEqual(body.billing,{status:'unavailable',reason:'state_not_ready'});
 assert.deepEqual(body.prices,{status:'published',revision:1,effectiveFrom:'2026-10-01',currency:'EUR',taxExclusive:true,vatRateBasisPoints:2100,registeredMonthlyCents:0,connectedMonthlyCents:3000,hostedMonthlyCents:9000,hostedDayDivisor:30});
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('billing HTTP remains readable for lapsed venues with unconfigured services and the free test plan',async t=>{
 const f=await fixture(t);await f.level({level:'registered',connectedFrom:null,lapsedOn:'2026-11-01'});
 const target=createAccountApp({...f.options,planMode:'test-free-paid'});
 await f.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1",[f.installationId]);
 const response=await f.send(undefined,{target});assert.equal(response.status,200);
 assert.deepEqual((await response.json()).billing,{status:'ready',level:'registered',state:'lapsed',period:null});
});
for(const entry of [
 {name:'GET',method:'GET',status:405,code:'method_not_allowed'},
 {name:'browser origin',headers:{origin},status:403,code:'forbidden'},
 {name:'empty browser origin',headers:{origin:''},status:403,code:'forbidden'},
 {name:'wrong host header',headers:{host:'elsewhere.example.test'},status:403,code:'forbidden'},
 {name:'query selector',url:origin+path+'?venueId='+randomUUID(),status:400,code:'invalid_input'},
 {name:'wrong URL host',url:'https://elsewhere.example.test'+path,status:403,code:'forbidden'},
 {name:'wrong media',headers:{'content-type':'text/plain'},status:415,code:'invalid_input'},
 {name:'compressed request',headers:{'content-encoding':'gzip'},status:415,code:'invalid_input'},
 {name:'declared oversized request',headers:{'content-length':'16385'},status:413,code:'invalid_input'},
] as const)test('billing HTTP refuses '+entry.name,async t=>{
 const f=await fixture(t);await fault(await f.send(undefined,{...entry,headers:entry.headers as Record<string,string>|undefined}),entry.status,entry.code);
});
for(const [name,body,status] of [
 ['malformed JSON','{',400],['outer extra selector',JSON.stringify({payload:'x',signature:'y',venueId:randomUUID()}),400],
 ['non-string envelope',JSON.stringify({payload:1,signature:'y'}),400],['outer array','[]',400],
 ['actual streamed byte overflow',' '.repeat(16385),413],
] as const)test('billing HTTP rejects '+name,async t=>{const f=await fixture(t);await fault(await f.send(body),status,'invalid_input');});
for(const [body,code] of [
 ['{"version":2}','unsupported_billing_version'],['{"version":0}','unsupported_billing_version'],
 ['{"version": 1}','invalid_request'],['{"version":1,"venueId":"forged"}','invalid_request'],['{}','invalid_request'],['{"version":"1"}','invalid_request'],
] as const)test('billing HTTP distinguishes signed body '+body,async t=>{const f=await fixture(t);await fault(await f.send(f.proof({body})),400,code);});
for(const [name,claims] of [
 ['unknown installation',()=>({installationId:randomUUID()})],['wrong action',()=>({action:'configuration' as const})],
 ['wrong signed origin',()=>({origin:'https://elsewhere.example.test'})],['stale proof',()=>({issuedAt:now-60001})],
 ['future proof',()=>({issuedAt:now+60001})],['missing lease',()=>({lease:''})],
] as const)test('billing HTTP rejects '+name,async t=>{const f=await fixture(t);await fault(await f.send(f.proof(claims())),401,'invalid_proof');});
test('billing HTTP rejects a forged key, crossed lease and expired lease without spending an unverified installation budget',async t=>{
 const f=await fixture(t),other=await fixture(t,false);
 await fault(await f.send({...f.proof(),signature:other.proof().signature}),401,'invalid_proof');
 const limiter=new AccountRateLimiter(f.pool,f.rateKey);
 for(let n=0;n<30;n++)assert.equal((await limiter.consume([{scope:'installation-key',subject:f.installationId,limit:30,windowSeconds:60}])).allowed,true);
 await fault(await f.send(f.proof({lease:JSON.stringify(other.lease())}),{ip:'192.0.2.2'}),429,'rate_limited');
 const target=createAccountApp({...f.options,config:{...f.options.config,rateKey:'a'.repeat(64)}});
 await fault(await f.send(f.proof({lease:JSON.stringify(other.lease())}),{target}),401,'invalid_proof');
 await fault(await f.send(f.proof({lease:JSON.stringify(f.lease({issuedAt:now-3600000,expiresAt:now-1}))}),{target}),401,'invalid_proof');
});
for(const state of ['revoked','superseded'] as const)test('billing HTTP refuses '+state+' installations',async t=>{
 const f=await fixture(t);
 if(state==='revoked')await f.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installationId]);
 else{
  const next=randomUUID(),key=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),client=await f.pool.connect();
  try{await client.query('BEGIN');await client.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$2 WHERE id=$1',[f.installationId,next]);await client.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[next,f.venueId,key]);await client.query('COMMIT');}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 await fault(await f.send(),403,'revoked');
});
for(const [name,changes] of [
 ['missing display options',{billingDisplay:undefined}],['missing issuer',{leaseIssuer:undefined}],
 ['missing calendar',{billingDisplay:{countryCode:'ES',calendarTimeZone:''}}],
 ['wrong country',{billingDisplay:{countryCode:'FR',calendarTimeZone:'Europe/Madrid'}}],
] as const)test('billing HTTP returns unavailable for '+name,async t=>{
 const f=await fixture(t),target=createAccountApp({...f.options,...changes} as Parameters<typeof createAccountApp>[0]);await fault(await f.send(undefined,{target}),503,'temporarily_unavailable');
});
test('billing HTTP maps a missing billing schema and an unreachable database to unavailable without registered defaults',async t=>{
 const f=await fixture(t);await f.pool.query('ALTER TABLE billing_venues RENAME TO billing_venues_missing');
 await fault(await f.send(),503,'temporarily_unavailable');
 const closed=new Pool({connectionString:process.env.TEST_DATABASE_URL});await closed.end();
 const target=createAccountApp({...f.options,pool:closed});await fault(await f.send(undefined,{target}),503,'temporarily_unavailable');
});
test('billing HTTP installation budget is shared across workers and the existing machine routes',async t=>{
 const f=await fixture(t),worker=createAccountApp({...f.options,pool:f.secondPool});
 for(let n=0;n<30;n++)assert.equal((await f.send(undefined,{target:n%2?worker:f.app,ip:`192.0.2.${n+1}`})).status,200);
 const denied=await f.send(undefined,{target:worker,ip:'192.0.2.99'});await fault(denied,429,'rate_limited');assert.ok(Number(denied.headers.get('retry-after'))>=1);
 await fault(await f.send(f.proof({action:'configuration',body:'{}'}),{url:origin+'/api/installations/configuration',ip:'192.0.2.100'}),429,'rate_limited');
});
test('billing HTTP machine IP budget is shared across workers before authentication',async t=>{
 const f=await fixture(t),worker=createAccountApp({...f.options,pool:f.secondPool});
 for(let n=0;n<60;n++)await fault(await f.send({payload:'invalid',signature:'invalid'},{target:n%2?worker:f.app}),401,'invalid_proof');
 const denied=await f.send(undefined,{target:worker});await fault(denied,429,'rate_limited');assert.ok(Number(denied.headers.get('retry-after'))>=1);
});
test('billing HTTP retains the general IP budget across workers',async t=>{
 const f=await fixture(t),limiter=new AccountRateLimiter(f.secondPool,f.rateKey);
 for(let n=0;n<120;n++)assert.equal((await limiter.consume([{scope:'all-ip',subject:'192.0.2.1',limit:120,windowSeconds:60}])).allowed,true);
 const response=await f.send();await fault(response,429,'rate_limited');assert.ok(Number(response.headers.get('retry-after'))>=1);
});
test('billing HTTP original and version-2 configuration remain equal with the adapter in either plan mode',async t=>{
 const f=await fixture(t);
 for(const planMode of [undefined,'test-free-paid'] as const){
  const without={...f.options,billingDisplay:undefined,planMode};
  const disabled=createAccountApp(without),enabled=createAccountApp({...f.options,planMode});
  for(const body of ['{}','{"servicesVersion":2}']){
   const envelope=f.proof({action:'configuration',body});
   const before=await f.send(envelope,{target:disabled,url:origin+'/api/installations/configuration'});assert.equal(before.status,200);
   const {lastContactAt:beforeContact,...expected}=await before.json();assert.ok(Number.isFinite(Date.parse(beforeContact)));
   const display=await f.send(undefined,{target:enabled});assert.equal(display.status,200);
   const after=await f.send(f.proof({action:'configuration',body}),{target:enabled,url:origin+'/api/installations/configuration'});assert.equal(after.status,200);
   const {lastContactAt:afterContact,...actual}=await after.json();assert.ok(Number.isFinite(Date.parse(afterContact)));assert.deepEqual(actual,expected);
   assert.equal(expected.services.length,body==='{}'?3:4);assert.equal(Object.hasOwn(expected,'billing'),false);
  }
 }
});
