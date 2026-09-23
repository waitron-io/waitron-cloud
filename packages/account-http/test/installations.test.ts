import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
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
