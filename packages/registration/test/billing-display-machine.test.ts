import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {test,type TestContext} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import * as api from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {createLeaseIssuer,encodeMachine} from '../src/installation-proof.ts';
import type {BillingEvent,BillingCommand,BillingPriceVersion} from '../src/billing-types.ts';

const origin='https://billing.example.test',now=Date.parse('2026-11-02T11:00:00.000Z');
const settings={countryCode:'ES',calendarTimeZone:'Europe/Madrid'} as const;
const issuerKey=generateKeyPairSync('ed25519');
const issuer=createLeaseIssuer(issuerKey.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const price:BillingPriceVersion={revision:1,effectiveFrom:'2026-09-01',currency:'EUR',prices:{connectedMonthlyCents:1000,hostedMonthlyCents:3000},vatRateBasisPoints:2100};
const event=():BillingEvent=>({key:randomUUID(),occurredAt:'2026-11-02T11:00:00.000Z',source:{kind:'internal'}});
function frozenClock(t:TestContext){t.mock.timers.enable({apis:['Date'],now});}
async function fixture(){
 const schema='billing_display_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const config={connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,application_name:schema,max:4};
 const pool=new Pool(config),second=new Pool(config);
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const scopes=[{organisationId:randomUUID(),legalBusinessId:randomUUID()}];
  scopes.push({organisationId:scopes[0]!.organisationId,legalBusinessId:randomUUID()},{organisationId:randomUUID(),legalBusinessId:randomUUID()});
  await pool.query('INSERT INTO organisations(id) VALUES($1),($2)',[scopes[0]!.organisationId,scopes[2]!.organisationId]);
  const targets=[];
  for(const scope of scopes){
   await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[scope.legalBusinessId,scope.organisationId]);
   for(let i=0;i<(scope===scopes[0]?2:1);i++){
    const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
    const venueId=randomUUID(),installationId=randomUUID();
    await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venueId,scope.organisationId,scope.legalBusinessId]);
    await pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,venueId,publicKey]);
    targets.push({scope,venueId,installationId,key,publicKey});
   }
  }
  return {schema,admin,pool,second,scopes,targets,store:new api.BillingStore(pool),prices:new api.BillingPriceStore(pool),
   async close(){await Promise.all([pool.end(),second.end()]);await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }catch(error){await Promise.all([pool.end(),second.end()]);await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
type Target=Fixture['targets'][number];
function machine(f:Fixture,options:Record<string,unknown>=settings,destination=origin,pool=f.pool){
 const module=api as Record<string,any>;
 assert.equal(typeof module.BillingDisplayMachine,'function','authenticated billing display reader must exist');
 return new module.BillingDisplayMachine(pool,issuer,destination,options);
}
function request(target:Target,changes:Record<string,unknown>={},leaseChanges:Record<string,unknown>={}){
 const lease=issuer.issue({origin,leaseId:randomUUID(),installationId:target.installationId,venueId:target.venueId,environment:'test',publicKey:target.publicKey,issuedAt:Date.now(),expiresAt:Date.now()+3600000,...leaseChanges});
 const claims={origin,action:'billing-display',installationId:target.installationId,operationId:randomUUID(),issuedAt:Date.now(),lease:JSON.stringify(lease),body:'{"version":1}',...changes};
 const bytes=encodeMachine(claims as any);
 return {payload:bytes.toString('base64url'),signature:sign(null,bytes,target.key.privateKey).toString('base64url')};
}
async function command(f:Fixture,target:Target,c:BillingCommand){return (await f.store.execute(target.scope,event(),c)).value;}
async function level(f:Fixture,target:Target,value:Record<string,unknown>={}){
 const old=await f.store.venue(target.scope,target.venueId);
 await command(f,target,{type:'set_venue',venueId:target.venueId,expectedRevision:old.revision,value:{level:'connected',connectedFrom:'2026-10-01',lapsedOn:null,scheduledLevel:null,scheduledOn:null,...value}} as BillingCommand);
}
async function freeze(f:Fixture,target:Target,changes:Record<string,unknown>={}){
 const id=randomUUID();await command(f,target,{type:'freeze_charge',chargeId:id,kind:'renewal',renewalDate:'2026-11-01',connectedUntil:'2026-12-01',window:{from:'2026-10-01',through:'2026-10-31'},priceRevision:1,...changes} as BillingCommand);return id;
}
async function attempt(f:Fixture,target:Target,chargeId:string){
 const method={id:randomUUID(),kind:'card',provider:'sumup',providerAccountId:'test-account',customerId:'synthetic-customer',methodId:randomUUID(),mandateId:null} as const;
 await command(f,target,{type:'set_method',method});
 const attemptId=randomUUID();await command(f,target,{type:'begin_attempt',chargeId,attemptId,methodId:method.id,requestKey:randomUUID()});
 return {attemptId,paymentId:randomUUID()};
}
async function observe(f:Fixture,target:Target,a:Awaited<ReturnType<typeof attempt>>,state:'succeeded'|'failed'|'refunded',expectedRevision:number|null){
 await command(f,target,{type:'observe_payment',attemptId:a.attemptId,providerPaymentId:a.paymentId,state,expectedRevision});
}
async function snapshot(f:Fixture){
 const rows:Record<string,unknown>={};
 for(const {tablename} of (await f.pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',[f.schema])).rows)
  rows[tablename]=(await f.pool.query(`SELECT to_jsonb(t) FROM ${tablename} t ORDER BY to_jsonb(t)::text`)).rows;
 return rows;
}
async function waiting(f:Fixture,blocker:PoolClient){
 const {rows:[{pid}]}=await blocker.query('SELECT pg_backend_pid() AS pid');
 const deadline=performance.now()+5000;
 while(performance.now()<deadline){
  const result=await f.second.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type='Lock' AND $2::integer=ANY(pg_blocking_pids(pid))",[f.schema,pid]);
  if(result.rowCount)return;
  await setImmediate();
 }
 assert.fail('billing read must observably wait on the held parent lock');
}
async function blockedRead(f:Fixture,target:Target,change:(blocker:PoolClient)=>Promise<void>,check:(pending:Promise<any>)=>Promise<void>){
 const blocker=await f.second.connect();await blocker.query('BEGIN');
 await blocker.query('SELECT id FROM legal_businesses WHERE id=$1 FOR NO KEY UPDATE',[target.scope.legalBusinessId]);
 const pending=machine(f).read(request(target));pending.catch(()=>{});
 try{await waiting(f,blocker);await change(blocker);await blocker.query('COMMIT');await check(pending);}
 finally{await blocker.query('ROLLBACK');blocker.release();await pending.catch(()=>{});}
}
// Refuse defaults for missing authority; no read may create billing or installation facts.
test('owned unstored billing read is registered active and writes no rows',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!,before=await snapshot(f),reader=machine(f);
  const proof=request(target);assert.equal((await reader.authenticate(proof)).installationId,target.installationId);
  assert.deepEqual(await reader.read(proof),{version:1,installationId:target.installationId,venueId:target.venueId,countryCode:'ES',calendarTimeZone:'Europe/Madrid',asOf:'2026-11-02T11:00:00.000Z',billing:{status:'ready',level:'registered',state:'active',period:null},prices:{status:'unavailable',reason:'not_published'},accountUrl:origin+'/account'});
  assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});
test('billing display derives venue business scope',async t=>{
 const f=await fixture();try{frozenClock(t);await f.prices.publish(price);
  for(const target of f.targets){await level(f,target);}
  for(const target of [f.targets[0]!,f.targets[2]!,f.targets[3]!]){const id=await freeze(f,target);const a=await attempt(f,target,id);await observe(f,target,a,'succeeded',0);}
  const reader=machine(f);
  for(const target of f.targets){const result=await reader.read(request(target));assert.equal(result.venueId,target.venueId);assert.deepEqual(result.billing,{status:'ready',level:'connected',state:'active',period:{kind:'paid',level:'connected',from:'2026-11-01',until:'2026-12-01',coversAsOf:true}});}
  const first=f.targets[0]!,other=f.targets[1]!;
  await level(f,first,{level:'registered',connectedFrom:null});
  const before=await snapshot(f);
  for(const selector of [{venueId:other.venueId},{legalBusinessId:f.targets[2]!.scope.legalBusinessId},{organisationId:f.targets[3]!.scope.organisationId},{countryCode:'ES'}])
   await assert.rejects(reader.read(request(first,{body:JSON.stringify({version:1,...selector})})),{code:'invalid_request'});
  assert.deepEqual((await reader.read(request(first))).billing,{status:'ready',level:'registered',state:'active',period:null});
  assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});
test('a different country schema cannot read an installation',async t=>{
 const f=await fixture(),foreign=await fixture();try{frozenClock(t);
  await assert.rejects(machine(f,settings,origin,foreign.pool).read(request(f.targets[0]!)),{code:'invalid_proof'});
 }finally{await f.close();await foreign.close();}
});
test('billing display authenticates the stored key and rechecks every lease binding',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!,reader=machine(f),other=f.targets[1]!;
  for(const changes of [{origin:'https://other.example.test'},{installationId:other.installationId},{installationId:randomUUID()},{action:'configuration'},{issuedAt:now-60001},{issuedAt:now+60001}])
   await assert.rejects(reader.read(request(target,changes)),{code:'invalid_proof'});
  for(const changes of [{installationId:other.installationId},{venueId:other.venueId},{environment:'production'},{publicKey:other.publicKey},{origin:'https://other.example.test'},{issuedAt:now-3600001,expiresAt:now-1}])
   await assert.rejects(reader.read(request(target,{},changes)),{code:'invalid_proof'});
  await assert.rejects(reader.read(request(target,{lease:''})),{code:'invalid_proof'});
  const proof=request(target);await f.pool.query('UPDATE installations SET public_key=$2 WHERE id=$1',[target.installationId,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
  await assert.rejects(reader.authenticate(proof),{code:'invalid_proof'});await assert.rejects(reader.read(proof),{code:'invalid_proof'});
 }finally{await f.close();}
});
for(const body of ['{}','{"version":1,"venueId":"x"}','{"version":1.0}','{ "version":1}','{"version":"1"}','{"version":1,"version":1}','[]','null','broken']){
 test(`billing display refuses invalid signed body ${body}`,async t=>{const f=await fixture();try{frozenClock(t);await assert.rejects(machine(f).read(request(f.targets[0]!,{body})),{code:'invalid_request'});}finally{await f.close();}});
}
test('billing display distinguishes unsupported canonical versions',async t=>{const f=await fixture();try{frozenClock(t);for(const version of [0,2,99])await assert.rejects(machine(f).read(request(f.targets[0]!,{body:JSON.stringify({version})})),{code:'unsupported_billing_version'});}finally{await f.close();}});
for(const superseded of [false,true]){
 test(`billing display refuses ${superseded?'superseded':'revoked'} installation`,async t=>{
  const f=await fixture();try{frozenClock(t);const target=f.targets[0]!;
   await f.pool.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$2 WHERE id=$1',[target.installationId,superseded?f.targets[1]!.installationId:null]);
   await assert.rejects(machine(f).read(request(target)),{code:'revoked'});
  }finally{await f.close();}
 });
}
test('billing display rechecks revocation after waiting',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!;
  await blockedRead(f,target,async blocker=>{await blocker.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[target.installationId]);},async pending=>{await assert.rejects(pending,{code:'revoked'});});
 }finally{await f.close();}
});
test('billing display rechecks key and venue scope after waiting',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!;
  await blockedRead(f,target,async blocker=>{await blocker.query('UPDATE venues SET legal_business_id=$2 WHERE id=$1',[target.venueId,f.scopes[1]!.legalBusinessId]);},async pending=>{await assert.rejects(pending,{code:'invalid_proof'});});
 }finally{await f.close();}
});
test('billing display rejects a proof that expires while queued',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!;
  await blockedRead(f,target,async()=>{t.mock.timers.setTime(now+60001);},async pending=>{await assert.rejects(pending,{code:'invalid_proof'});});
 }finally{await f.close();}
});
test('billing display reads one complete post-wait billing state',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!;
  await blockedRead(f,target,async blocker=>{
   await blocker.query('INSERT INTO billing_businesses(organisation_id,legal_business_id) VALUES($1,$2)',[target.scope.organisationId,target.scope.legalBusinessId]);
   await blocker.query("INSERT INTO billing_venues(organisation_id,legal_business_id,venue_id,level,lapsed_on) VALUES($1,$2,$3,'connected','2026-11-02')",[target.scope.organisationId,target.scope.legalBusinessId,target.venueId]);
  },async pending=>{assert.deepEqual((await pending).billing,{status:'ready',level:'connected',state:'lapsed',period:null});});
 }finally{await f.close();}
});
test('billing display prices are effective publications independent of frozen charges',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!,reader=machine(f),proof=request(target);
  await f.prices.publish({...price,effectiveFrom:'2026-11-03'});assert.deepEqual((await reader.read(proof)).prices,{status:'unavailable',reason:'not_published'});
  t.mock.timers.setTime(Date.parse('2026-11-03T11:00:00Z'));await level(f,target);
  const charge=await freeze(f,target,{renewalDate:'2026-11-03',connectedUntil:'2026-12-03'}),frozen=await f.store.charge(target.scope,charge);
  await f.prices.publish({...price,revision:2,effectiveFrom:'2026-11-04',prices:{connectedMonthlyCents:1200,hostedMonthlyCents:3600},vatRateBasisPoints:1000});
  let result=await reader.read(request(target));assert.equal(result.prices.revision,1);
  t.mock.timers.setTime(Date.parse('2026-11-04T11:00:00Z'));result=await reader.read(request(target));
  assert.deepEqual(result.prices,{status:'published',revision:2,effectiveFrom:'2026-11-04',currency:'EUR',taxExclusive:true,vatRateBasisPoints:1000,registeredMonthlyCents:0,connectedMonthlyCents:1200,hostedMonthlyCents:3600,hostedDayDivisor:30});
  assert.deepEqual(await f.store.charge(target.scope,charge),frozen);
 }finally{await f.close();}
});
test('billing display retains exact sparse days and omitted zero-cent allocations',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!,payer=f.targets[1]!;
  await f.prices.publish({...price,prices:{connectedMonthlyCents:1000,hostedMonthlyCents:0}});await level(f,payer);await level(f,target,{level:'hosted',connectedFrom:null});
  for(const on of ['2026-10-01','2026-10-03'])await command(f,target,{type:'hosted_day',venueId:target.venueId,on,coveredByChargeId:null});
  const charge=await freeze(f,payer),saved=await f.store.charge(payer.scope,charge);assert.equal(saved.lines.some(l=>l.venueId===target.venueId),false);
  const a=await attempt(f,payer,charge);await observe(f,payer,a,'succeeded',0);
  const reader=machine(f);let result=await reader.read(request(target));
  assert.deepEqual(result.billing,{status:'ready',level:'hosted',state:'active',period:{kind:'paid',level:'hosted',from:'2026-10-03',until:'2026-10-04',coversAsOf:false}});
  t.mock.timers.setTime(Date.parse('2026-10-02T11:00:00Z'));result=await reader.read(request(target));
  assert.deepEqual(result.billing.period,{kind:'paid',level:'hosted',from:'2026-10-01',until:'2026-10-02',coversAsOf:false});
 }finally{await f.close();}
});
test('billing display requires remaining accepted success through stored payment retries',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!;await f.prices.publish(price);await level(f,target);
  const id=await freeze(f,target),first=await attempt(f,target,id);await observe(f,target,first,'succeeded',0);await observe(f,target,first,'refunded',1);
  const reader=machine(f),proof=request(target);assert.deepEqual((await reader.read(proof)).billing,{status:'ready',level:'connected',state:'payment_failing',period:null});
  const second=await attempt(f,target,id);assert.equal((await reader.read(proof)).billing.state,'payment_failing');await observe(f,target,second,'succeeded',0);
  const expected={status:'ready',level:'connected',state:'active',period:{kind:'paid',level:'connected',from:'2026-11-01',until:'2026-12-01',coversAsOf:true}};
  assert.deepEqual((await reader.read(proof)).billing,expected);
  await observe(f,target,second,'failed',null);await observe(f,target,second,'refunded',null);
  assert.deepEqual((await reader.read(proof)).billing,expected);
  assert.equal((await f.store.history(target.scope,target.venueId)).paid.length,1);
 }finally{await f.close();}
});
test('billing display preserves stored trial extension and effective lapse',async t=>{
 const f=await fixture();try{frozenClock(t);const target=f.targets[0]!;await level(f,target);
  await command(f,target,{type:'start_trial',venueId:target.venueId,level:'connected',on:'2026-10-02'});
  await command(f,target,{type:'extend_trial',venueId:target.venueId,level:'connected',expectedEnd:'2026-11-01'});
  const reader=machine(f);assert.deepEqual((await reader.read(request(target))).billing,{status:'ready',level:'connected',state:'trial',period:{kind:'trial',level:'connected',from:'2026-10-02',until:'2026-12-01',coversAsOf:true}});
  t.mock.timers.setTime(Date.parse('2026-12-01T11:00:00Z'));assert.deepEqual((await reader.read(request(target))).billing,{status:'unavailable',reason:'state_not_ready'});
  await level(f,target,{level:'registered',connectedFrom:null,lapsedOn:'2026-12-01'});assert.equal((await reader.read(request(target))).billing.state,'lapsed');
 }finally{await f.close();}
});
test('billing display refuses unsafe account origins',async()=>{
 const f=await fixture();try{for(const unsafe of ['http://billing.example.test','https://u:p@billing.example.test','https://billing.example.test/other','https://billing.example.test?x=1','https://billing.example.test#x','javascript:alert(1)','https://billing.example.test/'])assert.throws(()=>machine(f,settings,unsafe),{code:'temporarily_unavailable'});
  for(const destination of [origin,'http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000'])assert.ok(machine(f,settings,destination));
  for(const invalid of [{countryCode:'FR',calendarTimeZone:'Europe/Madrid'},{countryCode:'ES',calendarTimeZone:'Invalid/Zone'},{countryCode:'ES'},{calendarTimeZone:'Europe/Madrid'}])assert.throws(()=>machine(f,invalid),{code:'temporarily_unavailable'});
 }finally{await f.close();}
});
test('missing country schema refuses instead of returning registered defaults',async t=>{
 const f=await fixture();const empty='billing_missing_'+randomUUID().replaceAll('-','');
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${empty}`});
 try{frozenClock(t);await f.admin.query(`CREATE SCHEMA ${empty}`);await assert.rejects(machine(f,settings,origin,pool).read(request(f.targets[0]!)),{code:'temporarily_unavailable'});}
 finally{await pool.end();await f.admin.query(`DROP SCHEMA IF EXISTS ${empty} CASCADE`);await f.close();}
});
