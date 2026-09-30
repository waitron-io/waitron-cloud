import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {createSession} from '@waitron-cloud/identity';
import {createLeaseIssuer,encodeMachine,transaction,type MachineAction} from '@waitron-cloud/registration';
import {RelayGrantStore,type RelayConfig} from '../../../registration/src/relay-grants.ts';
import {database} from '../fixtures.ts';
import {startAccountServer} from '../../src/server.ts';
export async function relayFixture(){
 const db=await database(),origin='http://localhost';
 const issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),issuer=createLeaseIssuer(issuerKey);
 const grants:RelayConfig={mode:'local-proof',consentVersion:'local-v1',policy:{version:'local-v1',units:100,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'},verifyOrigin:async r=>({...r,domainControl:true,httpsEndpoint:true,expiresAt:new Date(Date.now()+7200000).toISOString()})};
 const relay={mode:'local-proof',grants,payloadKeys:{activeKeyId:'p1',keys:{p1:randomBytes(32).toString('hex')}},replayKeys:{activeKeyId:'r1',keys:{r1:randomBytes(32).toString('hex')}}};
 let running:Awaited<ReturnType<typeof startAccountServer>>;
 async function start(config:unknown=relay){
  running=await startAccountServer({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:false,rateKey:db.rateKey,trustedProxyIps:[]},port:0,leaseIssuer:issuer,...(config?{relay:config}: {})} as Parameters<typeof startAccountServer>[0]);
 }
 await start();
 async function venue(owner?:{accountId:string;organisationId:string}){
  const accountId=owner?.accountId??randomUUID(),organisationId=owner?.organisationId??randomUUID(),venueId=randomUUID(),installationId=randomUUID(),business=randomUUID();
  if(!owner){await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);await db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[accountId,`${accountId}@example.test`]);await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[accountId,organisationId]);}
  await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisationId]);
  await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venueId,organisationId,business,randomUUID()]);
  const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  await db.pool.query("INSERT INTO installations(id,venue_id,public_key,lease_expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[installationId,venueId,publicKey]);
  const session=await transaction(db.pool,c=>createSession(c,accountId));
  const approval={installationId,expectedRevision:0,consent:true as const,consentVersion:'local-v1',managementOrigin:'https://manage.example.test',expiresAt:new Date(Date.now()+3600000).toISOString()};
  const grant=await new RelayGrantStore(db.pool,grants).approve(session.token,session.csrfToken,approval);
  const leaseTime=Date.now();
  const leaseInput={origin,leaseId:randomUUID(),installationId,venueId,environment:'test' as const,publicKey,issuedAt:leaseTime,expiresAt:leaseTime+3600000},lease=issuer.issue(leaseInput);
  const body={version:1,messageId:randomUUID(),grantId:grant.id,grantRevision:grant.revision,class:'password_reset',recipient:'ana@example.test',displayName:'Ana',locale:'es-ES',timeZone:'Europe/Madrid',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')};
  function proof(action:string,b:unknown=body,overrides:Record<string,unknown>={}){
   const payload=encodeMachine({origin,action:action as MachineAction,installationId,operationId:action==='email-submit'?(b as typeof body).messageId:randomUUID(),issuedAt:Date.now(),lease:JSON.stringify(lease),body:JSON.stringify(b),...overrides});
   return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
  }
  return {accountId,organisationId,installationId,venueId,publicKey,session,approval,grant,body,proof,lease,leaseInput};
 }
 async function discardReply(envelope:unknown){
  const address=running.server.address();assert.ok(address&&typeof address!=='string');
  await new Promise<void>((resolve,reject)=>{
   const req=httpRequest({host:'127.0.0.1',port:address.port,path:'/v1/installations/email/submit',method:'POST',headers:{host:'localhost','content-type':'application/json'}},res=>{
    res.destroy();req.destroy();resolve();
   });req.once('error',reject);req.end(JSON.stringify(envelope));
  });
 }
 async function request(action:string,envelope:unknown,headers:Record<string,string>={}){
  const address=running.server.address();assert.ok(address&&typeof address!=='string');
  return new Promise<{status:number;body:any;text:string;headers:Record<string,unknown>}>((resolve,reject)=>{
   const req=httpRequest({host:'127.0.0.1',port:address.port,path:'/v1/installations/email/'+action,method:'POST',headers:{host:'localhost','content-type':'application/json',...headers}},res=>{
    let text='';res.on('data',b=>{text+=b;});res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode!,body:JSON.parse(text),text,headers:res.headers}));
   });req.once('error',reject);req.end(JSON.stringify(envelope));
  });
 }
 return {db,origin,issuer,issuerKey,relay,grants,venue,request,discardReply,async restart(config:unknown=relay){await running.close();await start(config);},async close(){await running.close();await db.close();}};
}
