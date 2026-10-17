import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';
const origin='https://cloud.example.test',bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
const original=['continuous_backup','remote_access','retained_snapshots'];
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,installation:string,session:{token:string;csrfToken:string};
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 const owner=randomUUID(),organisation=randomUUID(),business=randomUUID(),venue=randomUUID();installation=randomUUID();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[owner]);
 await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Sol')",[organisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Sol SL','ES')",[business,organisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'readers-key')",[installation,venue]);
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'continuous_backup','unconfigured'),($1,'remote_access','unconfigured'),
  ($1,'retained_snapshots','unconfigured'),($1,'content_translation','ready')`,[installation]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true)',[owner,organisation]);
 session=await transaction(db.pool,c=>createSession(c,owner));
 // Account installation reads require an issuer even when no lease is issued.
 const leaseIssuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 app=createAccountApp({pool:db.pool,outbox:db.outbox,leaseIssuer,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
});
const headers=()=>({origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken});
test('diagnostics list the three original services and report monitoring off when only translation is ready',async()=>{
 const response=await app.request(origin+'/api/account/diagnostics/read',{method:'POST',headers:headers(),body:JSON.stringify({installationId:installation})},bindings);
 assert.equal(response.status,200,await response.clone().text());
 const body=(await response.json()) as {installation:{services:{service:string}[];monitoring:{enabled:boolean}}};
 assert.deepEqual(body.installation.services.map(s=>s.service),original);assert.equal(body.installation.monitoring.enabled,false);
});
test('the installation overview lists the three original services and reports monitoring off',async()=>{
 const response=await app.request(origin+'/api/account/installations',{headers:headers()},bindings);
 assert.equal(response.status,200,await response.clone().text());
 const body=(await response.json()) as {installations:{services:{service:string}[];monitoring:{enabled:boolean}}[]};
 assert.deepEqual(body.installations[0]!.services.map(s=>s.service),original);assert.equal(body.installations[0]!.monitoring.enabled,false);
});
test('diagnostic monitoring stays off when only translation is ready',async()=>{
 const response=await app.request(origin+'/api/account/diagnostics/read',{method:'POST',headers:headers(),body:JSON.stringify({installationId:installation})},bindings);
 assert.equal(response.status,200,await response.clone().text());
 const body=await response.json() as {installation:{monitoring:{enabled:boolean}}};
 assert.equal(body.installation.monitoring.enabled,false);
});
test('overview monitoring stays off and hides disconnected incidents when only translation is ready',async()=>{
 await db.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision,opened_at,changed_at) SELECT venue_id,'disconnected','open',1,clock_timestamp(),clock_timestamp() FROM installations WHERE id=$1",[installation]);
 const response=await app.request(origin+'/api/account/installations',{headers:headers()},bindings);
 assert.equal(response.status,200,await response.clone().text());
 const body=await response.json() as {installations:{monitoring:{enabled:boolean;incidents:unknown[]}}[]};
 assert.equal(body.installations[0]!.monitoring.enabled,false);
 assert.deepEqual(body.installations[0]!.monitoring.incidents,[]);
});
test('overview hides old disconnected incidents when only translation is ready',async()=>{
 await db.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision,opened_at,changed_at) SELECT venue_id,'disconnected','open',1,clock_timestamp(),clock_timestamp() FROM installations WHERE id=$1",[installation]);
 const response=await app.request(origin+'/api/account/installations',{headers:headers()},bindings);
 assert.equal(response.status,200,await response.clone().text());
 const body=await response.json() as {installations:{monitoring:{incidents:unknown[]}}[]};
 assert.deepEqual(body.installations[0]!.monitoring.incidents,[]);
});
