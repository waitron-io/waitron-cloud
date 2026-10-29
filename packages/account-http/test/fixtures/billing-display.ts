import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import type {TestContext} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {BillingStore,createLeaseIssuer,encodeMachine,type BillingCommand} from '@waitron-cloud/registration';
import type {MachineClaims,LeaseInput} from '../../../registration/src/installation-proof.ts';
import {createAccountApp} from '../../src/app.ts';
import {database} from '../fixtures.ts';

export const origin='https://cloud.example.test',path='/api/installations/billing-display';
export const settings={countryCode:'ES',calendarTimeZone:'Europe/Madrid'} as const;
export const now=Date.parse('2026-11-02T11:00:00.000Z');
export const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
export type AppOptions=Parameters<typeof createAccountApp>[0]&{billingDisplay?:{countryCode:'ES';calendarTimeZone:string}};
export async function fixture(t:TestContext,freezeClock=true){
 const db=await database();t.after(()=>db.close());
 if(freezeClock)t.mock.timers.enable({apis:['Date'],now});
 const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const organisationId=randomUUID(),legalBusinessId=randomUUID(),venueId=randomUUID(),installationId=randomUUID();
 await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
 await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[legalBusinessId,organisationId]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venueId,organisationId,legalBusinessId]);
 await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,venueId,publicKey]);
 await db.pool.query("INSERT INTO installation_services(installation_id,service) SELECT $1,unnest(ARRAY['remote_access','continuous_backup','retained_snapshots','content_translation'])",[installationId]);
 const options:AppOptions={pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:issuer,billingDisplay:settings};
 const app=createAccountApp(options),scope={organisationId,legalBusinessId},store=new BillingStore(db.pool);
 function lease(changes:Partial<LeaseInput>={}){return issuer.issue({origin,leaseId:randomUUID(),installationId,venueId,environment:'test',publicKey,issuedAt:Date.now(),expiresAt:Date.now()+3600000,...changes});}
 function proof(changes:Partial<MachineClaims>={}){
  const bytes=encodeMachine({origin,action:'billing-display',installationId,operationId:randomUUID(),issuedAt:Date.now(),lease:JSON.stringify(lease()),body:'{"version":1}',...changes});
  return {payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')};
 }
 function send(body:unknown=proof(),extra:{target?:typeof app;url?:string;method?:string;headers?:Record<string,string>;ip?:string}={}){
  return (extra.target??app).request(extra.url??origin+path,{method:extra.method??'POST',headers:{'content-type':'application/json',...extra.headers},body:extra.method==='GET'?undefined:typeof body==='string'?body:JSON.stringify(body)},
   {incoming:{socket:{remoteAddress:extra.ip??'192.0.2.1'}}} as HttpBindings);
 }
 async function command(command:BillingCommand){return (await store.execute(scope,{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},command)).value;}
 async function level(value:Partial<{level:'registered'|'connected'|'hosted';connectedFrom:string|null;lapsedOn:string|null}>={}){
  await command({type:'ensure_business'});
  const old=await store.venue(scope,venueId);
  await command({type:'set_venue',venueId,expectedRevision:old.revision,value:{level:'connected',connectedFrom:'2026-10-01',lapsedOn:null,scheduledLevel:null,scheduledOn:null,...value}});
 }
 return {...db,app,options,scope,venueId,installationId,key,publicKey,lease,proof,send,command,level};
}
export async function fault(response:Response,status:number,code:string){
 assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('etag'),null);
 assert.deepEqual(await response.json(),{error:code});
}
