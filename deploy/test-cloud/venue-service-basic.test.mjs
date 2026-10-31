import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {test} from 'node:test';
import {database} from '../../packages/account-http/test/fixtures.ts';
import {BillingStore,EmailWorker,SignupStore,PasswordRecoveryStore,parsePlanMode} from '../../packages/registration/src/index.ts';
import {startAccountServer} from '../../packages/account-http/src/server.ts';
import {bootstrap} from '../local-stack/bootstrap.mjs';
import {createTestCaptureMailer} from './capture-mailer.mjs';
import {testRuntimeEnvironment} from './runtime.mjs';

async function billingVenue(db,owner){
 const venueId=randomUUID(),scope={organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId},store=new BillingStore(db.pool);
 const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}});
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venueId,scope.organisationId,scope.legalBusinessId]);
 await store.execute(scope,event(),{type:'ensure_business'});
 return async level=>{
  const old=await store.venue(scope,venueId);
  await store.transition(scope,event(),{type:'set_venue',venueId,expectedRevision:old.revision,value:{level,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
 };
}

for(const level of ['registered','connected','hosted'])test(`venue basic ${level} keeps signup and password reset independent across transitions`,async()=>{
 const db=await database();
 try{
  assert.ok(process.env.MAILPIT_TEST_URL&&process.env.MAILPIT_TEST_SMTP_PORT,'Use scripts/test-postgres.mjs');
  const signup=new SignupStore(db.pool,db.outbox),recovery=new PasswordRecoveryStore(db.pool,db.outbox);
  const worker=new EmailWorker(db.pool,db.outbox,createTestCaptureMailer({origin:'https://waitron.local:3000',port:Number(process.env.MAILPIT_TEST_SMTP_PORT)}));
  const ownerEmail=`venue-owner-${randomUUID()}@example.test`,newEmail=`venue-signup-${randomUUID()}@example.test`;
  assert.deepEqual(await signup.request(ownerEmail),{status:'accepted'});
  const verification=(await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' AND status='pending'")).rows[0];
  assert.ok(verification,'signup must enqueue verification independently of venue billing');
  const {token}=db.outbox.open(verification);assert.equal(await worker.runOnce(),true);
  const owner=await signup.complete(token,{password:'A long enough test password',organisationName:'Cafe',legalBusinessName:'Cafe SL',countryCode:'ES'});
  const set=await billingVenue(db,owner);await set(level);
  assert.deepEqual(await recovery.request(ownerEmail,'es'),{status:'accepted'});
  assert.deepEqual(await signup.request(newEmail,'en'),{status:'accepted'});
  const pending=(await db.pool.query("SELECT id,kind FROM email_outbox WHERE status='pending' ORDER BY kind")).rows;
  assert.deepEqual(pending.map(row=>row.kind),['password_reset','verification'],'both account mails must be admitted at every level');
  const grants=(await db.pool.query('SELECT * FROM relay_grants ORDER BY id')).rows;
  for(const transition of ['registered','hosted','connected',level])await set(transition);
  assert.deepEqual((await db.pool.query("SELECT id,kind FROM email_outbox WHERE status='pending' ORDER BY kind")).rows,pending,'transitions must preserve queued account mail');
  assert.deepEqual((await db.pool.query('SELECT * FROM relay_grants ORDER BY id')).rows,grants);assert.equal(grants.length,0);
  assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE status<>'sent'")).rows[0].n,0);
  const inbox=await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`,{signal:AbortSignal.timeout(5000)});assert.equal(inbox.status,200);
  const messages=(await inbox.json()).messages.filter(message=>message.To.some(to=>[ownerEmail,newEmail].includes(to.Address)));
  assert.equal(messages.length,3);const texts=[];
  for(const message of messages){const response=await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/message/${message.ID}`,{signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);texts.push({to:message.To.map(to=>to.Address),text:(await response.json()).Text});}
  assert.equal(texts.filter(m=>m.to.includes(ownerEmail)&&m.text.includes('https://waitron.local:3000/reset-password#token=')).length,1);
  for(const email of [ownerEmail,newEmail])assert.equal(texts.filter(m=>m.to.includes(email)&&m.text.includes('https://waitron.local:3000/signup#token=')).length,1);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_reservations')).rows[0].n,0);
 }finally{await db.close();}
});

for(const level of ['registered','connected','hosted'])test(`venue basic ${level} leaves address routes and deployed translation unavailable`,async()=>{
 const db=await database(),directory=await mkdtemp(join(tmpdir(),'venue-address-'));let running;
 try{
  const owner={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[owner.organisationId]);
  await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[owner.legalBusinessId,owner.organisationId]);
  await (await billingVenue(db,owner))(level);
  const environment=testRuntimeEnvironment('account',await bootstrap(directory),{CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TRANSLATION:'1',CLOUD_ADDRESS_LOOKUP:'1',GOOGLE_MAPS_API_KEY:'fake-only',GEOAPIFY_API_KEY:'fake-only'});
  assert.equal(environment.CLOUD_TRANSLATION,'0');
  for(const key of ['CLOUD_ADDRESS_LOOKUP','GOOGLE_MAPS_API_KEY','GEOAPIFY_API_KEY'])assert.equal(environment[key],undefined);
  running=await startAccountServer({pool:db.pool,outbox:db.outbox,port:0,planMode:parsePlanMode(environment.CLOUD_TEST_SERVICE_PLANS,environment.CLOUD_VENUE_SERVICE_LEVELS),translation:environment.CLOUD_TRANSLATION==='1',config:{portalOrigin:'http://localhost',production:false,rateKey:db.rateKey,trustedProxyIps:[]}});
  const port=running.server.address().port;
  const post=(path,browser=true)=>new Promise((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port,path,method:'POST',timeout:5000,signal:AbortSignal.timeout(5000),headers:{host:'localhost',...(browser?{origin:'http://localhost'}:{}),'content-type':'application/json'}},response=>{
    let body='';response.on('data',chunk=>body+=chunk);response.once('error',reject);
    response.once('end',()=>resolve(new Response(body,{status:response.statusCode})));
   });
   req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('fixture request timeout')));req.end('{}');
  });
  for(const action of ['request','start','status','autocomplete','validate','confirm','cancel']){
   const response=await post(`/v1/address-lookup/${action}`);assert.equal(response.status,404);await response.text();
  }
  for(const action of ['submit','status','collect','release']){
   const response=await post(`/api/installations/translation-${action}`,false);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'temporarily_unavailable'});
  }
 }finally{await running?.close();await rm(directory,{recursive:true,force:true});await db.close();}
});
