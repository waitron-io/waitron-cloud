import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession,hashSecret} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database,emailLoginPolicy} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
const origin='https://cloud.example.test';
test('the proof routes bind the cookie and CSRF, return no sign-in cookies, and unlock security controls',async()=>{
  const id=randomUUID();await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
  await db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[id,'proof-owner@example.test',await hashSecret('Synthetic proof password')]);
  const actor=await transaction(db.pool,c=>createSession(c,id));
  const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[],requireEnrollment:true},factor:{keys:null,policy:emailLoginPolicy}});
  const request=(path:string,body?:unknown,csrf=actor.csrfToken)=>app.request(origin+'/api/account'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:`__Host-cloud_session=${actor.token}`,'x-csrf-token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})},{incoming:{socket:{remoteAddress:'192.0.2.4'}}} as HttpBindings);
  const status=await request('/action-proof');assert.equal(status.status,200);
  assert.deepEqual(await status.json(),{methods:['email'],freshUntil:null});
  assert.equal((await request('/action-proof/email',{},'A'.repeat(43))).status,403);
  const challenge=await request('/action-proof/email',{});assert.equal(challenge.status,200);assert.equal(challenge.headers.getSetCookie().length,0);
  const body=await challenge.json() as {challengeToken:string};
  const message=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='sign_in_check' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('code' in message);
  const completion=await request('/action-proof/email/verify',{challengeToken:body.challengeToken,code:message.code});assert.equal(completion.status,204);assert.equal(completion.headers.getSetCookie().length,0);
  const ready=await (await request('/action-proof')).json() as {freshUntil:string};assert.ok(Date.parse(ready.freshUntil)>Date.now());
  assert.equal((await request('/passkeys/registration/options',{})).status,200,'restricted enrollment can use the fresh window without repeating a password');
  assert.equal((await request('/action-proof/email/verify',{challengeToken:body.challengeToken,code:message.code})).status,403);
});

test('choosing another account passkey refuses proof without creating a window or a session',async()=>{
 const owner=randomUUID(),other=randomUUID();
 for(const id of [owner,other]){
  await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
  await db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[id,`proof-${id}@example.test`,await hashSecret('Synthetic passkey proof password')]);
  await db.pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[id,Buffer.alloc(32,id===owner?1:2)]);
  await db.pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up) VALUES($1,$2,$3,$4,0,'multiDevice',true)`,[randomUUID(),id,id===owner?'b3duZXI':'b3RoZXI',Buffer.from([1,2,3])]);
 }
 const actor=await transaction(db.pool,c=>createSession(c,owner)),app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},factor:{keys:null,policy:emailLoginPolicy}});
 const request=(path:string,body:unknown)=>app.request(origin+'/api/account'+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:`__Host-cloud_session=${actor.token}`,'x-csrf-token':actor.csrfToken},body:JSON.stringify(body)},{incoming:{socket:{remoteAddress:'192.0.2.5'}}} as HttpBindings);
 const options=await(await request('/action-proof/passkey/options',{})).json();
 const response=await request('/action-proof/passkey/verify',{ceremonyId:options.ceremonyId,response:{id:'b3RoZXI',rawId:'b3RoZXI',type:'public-key',clientExtensionResults:{},response:{clientDataJSON:'YQ',authenticatorData:'YQ',signature:'YQ',userHandle:Buffer.alloc(32,2).toString('base64url')}}});
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'proof_required'});assert.equal(response.headers.getSetCookie().length,0);
 assert.equal((await db.pool.query('SELECT action_proved_at FROM cloud_sessions WHERE account_id=$1',[owner])).rows[0].action_proved_at,null);
});
