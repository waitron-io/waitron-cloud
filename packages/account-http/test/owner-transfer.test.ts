import {setRecoveryScope} from '../../registration/test/fixtures/recovery-scope.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,beforeEach,after,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {login} from '@waitron-cloud/identity';
import {SignupStore,transaction} from '@waitron-cloud/registration';
import {prepareConnectionProof} from '../../registration/test/fixtures/action-proof.ts';
import {database,emailLoginPolicy,signupVerification} from './fixtures.ts';
import {createAccountApp} from '../src/app.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',password='A long enough transfer password';
before(async()=>{db=await database();});beforeEach(async()=>{await db.pool.query('DELETE FROM account_rate_limits');});after(async()=>db?.close());
async function account(){
 const email=randomUUID()+'@example.test',signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=await signupVerification(db,email);
 const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),session=await transaction(db.pool,c=>login(c,{email,password}));
 await prepareConnectionProof(db.pool,owner.accountId,session.token);return {...owner,...session,email};
}
function app(){return createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},factor:{keys:null,policy:emailLoginPolicy}});}
function request(target:ReturnType<typeof app>,who:Awaited<ReturnType<typeof account>>,path:string,body?:unknown,extra:Record<string,string>={}){
 return target.request(origin+'/api/account/owner-transfers'+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:`__Host-cloud_session=${who.token}`,'x-csrf-token':who.csrfToken,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})},{incoming:{socket:{remoteAddress:'192.0.2.10'}}} as HttpBindings);
}
test('HTTP create, list and acceptance complete the exact business handover',async()=>{
 const sender=await account(),recipient=await account(),target=app();
 const initial=await request(target,sender,'');assert.equal(initial.status,200);assert.ok((await initial.json() as {organisations:{id:string}[]}).organisations.some(o=>o.id===sender.organisationId));
 assert.equal((await request(target,sender,'/create',{organisationId:sender.organisationId,email:recipient.email,locale:'es'})).status,202);
 const incoming=await request(target,recipient,'');assert.equal(incoming.status,200);const list=await incoming.json() as {offers:{id:string;organisationId:string;incoming:boolean}[]};assert.equal(list.offers.length,1);assert.equal(list.offers[0]!.organisationId,sender.organisationId);assert.equal(list.offers[0]!.incoming,true);
 assert.equal((await request(target,recipient,'/accept',{id:list.offers[0]!.id})).status,200);
 assert.equal((await request(target,sender,'/create',{organisationId:sender.organisationId,email:recipient.email})).status,404);
});
test('HTTP mutations refuse foreign origins, missing CSRF, extra fields and other tenants',async()=>{
 const sender=await account(),stranger=await account(),target=app(),body={organisationId:sender.organisationId,email:stranger.email};
 assert.equal((await request(target,sender,'/create',body,{origin:'https://foreign.test'})).status,403);
 assert.equal((await request(target,sender,'/create',body,{'x-csrf-token':''})).status,403);
 assert.equal((await request(target,sender,'/create',{...body,recipientAccountId:stranger.accountId})).status,400);
 assert.equal((await request(target,stranger,'/create',body)).status,404);
 assert.equal((await request(target,stranger,'/accept',{id:randomUUID()})).status,404);
 assert.equal((await request(target,stranger,'/cancel',{id:randomUUID()})).status,404);
});
test('HTTP creation gives the same response for unknown, unverified and disabled addresses and enforces its request limit',async()=>{
 const sender=await account(),recipient=await account(),target=app(),bodies=[];
 for(const mode of ['unknown','unverified','disabled']){
  await db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[recipient.accountId]);
  if(mode==='disabled')await db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[recipient.accountId]);
  const response=await request(target,sender,'/create',{organisationId:sender.organisationId,email:mode==='unknown'?randomUUID()+'@example.test':recipient.email});assert.equal(response.status,202);bodies.push(await response.json());
  const offer=(await db.pool.query("SELECT id FROM owner_transfers WHERE organisation_id=$1 AND state='pending'",[sender.organisationId])).rows[0];
  assert.equal((await request(target,sender,'/cancel',{id:offer.id})).status,200);
 }
 assert.deepEqual(bodies,[{status:'accepted'},{status:'accepted'},{status:'accepted'}]);
 let limited:Response|undefined;for(let n=0;n<15;n++){limited=await request(target,sender,'/cancel',{id:randomUUID()});if(limited.status===429)break;}
 assert.equal(limited?.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});

function signupRequest(target:ReturnType<typeof app>,path:string,body:unknown,requestOrigin=origin){
 return target.request(origin+'/api/account'+path,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify(body)},{incoming:{socket:{remoteAddress:'192.0.2.10'}}} as HttpBindings);
}
test('account-only completion is public, strict and creates no session cookies',async()=>{
 const sender=await account(),email=`new-${randomUUID()}@example.test`,target=app();
 await request(target,sender,'/create',{organisationId:sender.organisationId,email});
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const body={token:mail.token,password,rememberBrowser:'true'},path='/signup/transfer/complete';
 assert.equal((await signupRequest(target,path,body,'https://foreign.test')).status,403);
 assert.equal((await signupRequest(target,path,{...body,organisationName:'Injected business'})).status,400);
 const response=await signupRequest(target,path,body);assert.equal(response.status,201);
 const value=await response.json() as {accountId:string};assert.deepEqual(Object.keys(value),['accountId']);assert.ok(value.accountId);
 assert.match(response.headers.get('set-cookie')??'',/__Host-cloud_browser=/);assert.doesNotMatch(response.headers.get('set-cookie')??'',/cloud_session|cloud_csrf/);
});
test('account-only completion reports unavailable handover and shares the ordinary signup completion budget',async()=>{
 const email=`new-${randomUUID()}@example.test`,signup=new SignupStore(db.pool,db.outbox),target=app();await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const body={token:mail.token,password};
 const response=await signupRequest(target,'/signup/transfer/complete',body);assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'handover_unavailable'});
 for(let n=0;n<9;n++)assert.equal((await signupRequest(target,'/signup/complete',{...body,organisationName:'Business',legalBusinessName:'Business SL',countryCode:'ES',password:'short'})).status,400);
 const limited=await signupRequest(target,'/signup/transfer/complete',body);assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});

test('recovered scope: handover chooser omits other retained memberships',async()=>{
 const a=await account(),target=app();await setRecoveryScope(db.pool,a.accountId);
 assert.deepEqual((await (await request(target,a,'')).json()).organisations,[]);
 await setRecoveryScope(db.pool,a.accountId,a.organisationId);assert.deepEqual((await (await request(target,a,'')).json()).organisations.map((o:{id:string})=>o.id),[a.organisationId]);
});
