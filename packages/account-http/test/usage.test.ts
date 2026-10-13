import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {recordUsageEvent,transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';

let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>;
const origin='https://cloud.example.test';
let owner:string,member:string,organisation:string,foreignOrganisation:string,venue:string;
let session:{token:string;csrfToken:string},memberSession:{token:string;csrfToken:string};
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 await db.pool.query('UPDATE usage_reconciliation_sources SET last_attempted_at=NULL,caught_up_at=NULL');
 owner=randomUUID();member=randomUUID();organisation=randomUUID();foreignOrganisation=randomUUID();venue=randomUUID();
 const business=randomUUID(),foreignBusiness=randomUUID(),foreignVenue=randomUUID();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[owner,member]);
 await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Owner Org'),($2,'Foreign Org')",[organisation,foreignOrganisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Owner SL','ES'),($3,$4,'Foreign SL','ES')",[business,organisation,foreignBusiness,foreignOrganisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test'),($5,$6,$7,$8,'test')",[venue,organisation,business,randomUUID(),foreignVenue,foreignOrganisation,foreignBusiness,randomUUID()]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true),($3,$2,true,false)',[owner,organisation,member]);
 session=await transaction(db.pool,client=>createSession(client,owner));
 memberSession=await transaction(db.pool,client=>createSession(client,member));
 await transaction(db.pool,client=>recordUsageEvent(client,{organisationId:organisation,venueId:venue,type:'backup.storage_added_bytes',quantity:41n,sourceKind:'backup_point',sourceReference:randomUUID(),occurredAt:'2026-09-26T12:00:00.000Z'}));
 await transaction(db.pool,client=>recordUsageEvent(client,{organisationId:foreignOrganisation,venueId:foreignVenue,type:'backup.storage_added_bytes',quantity:999n,sourceKind:'backup_point',sourceReference:randomUUID(),occurredAt:'2026-09-26T12:00:01.000Z'}));
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
});
function call(body:unknown,credentials=session,headers:Record<string,string>={},method='POST'){
 return app.request(origin+'/api/account/usage/read',{method,headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+credentials.token,'x-csrf-token':credentials.csrfToken,...headers},body:method==='POST'?JSON.stringify(body):undefined},{incoming:{socket:{remoteAddress:'192.0.2.45'}}} as HttpBindings);
}

test('owner receives passive tenant totals without source identities or secrets',async()=>{
 const response=await call({organisationId:organisation});assert.equal(response.status,200,await response.clone().text());
 const summary=await response.json() as {version:number;organisationId:string;storage:{currentBytes:string};measuredThrough:string|null};
 assert.equal(summary.version,1);assert.equal(summary.organisationId,organisation);assert.equal(summary.storage.currentBytes,'41');assert.equal(summary.measuredThrough,null);
 const encoded=JSON.stringify(summary);
 for(const value of [session.token,session.csrfToken,foreignOrganisation,'999'])assert.equal(encoded.includes(value),false);
 const row=(await db.pool.query('SELECT created_at,last_seen_at FROM cloud_sessions WHERE account_id=$1',[owner])).rows[0];
 assert.equal(row.last_seen_at.getTime(),row.created_at.getTime());
});

test('usage route requires its exact boundary, current ownership and account allowance',async()=>{
 assert.equal((await call({organisationId:organisation},session,{},'GET')).status,405);
 assert.equal((await call({organisationId:organisation},session,{origin:'https://wrong.example'})).status,403);
 assert.equal((await call({organisationId:organisation},session,{'x-csrf-token':'wrong'})).status,403);
 assert.equal((await call({organisationId:organisation},{token:'missing',csrfToken:session.csrfToken})).status,401);
 for(const body of [{organisationId:'bad'},{organisationId:organisation,extra:true},{}])assert.equal((await call(body)).status,400);
 assert.equal((await call({organisationId:foreignOrganisation})).status,403);
 assert.equal((await call({organisationId:organisation},memberSession)).status,403);
 await db.pool.query('DELETE FROM account_rate_limits');
 for(let attempt=0;attempt<30;attempt++)assert.equal((await call({organisationId:organisation})).status,200);
 const limited=await call({organisationId:organisation});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>=1);
 await db.pool.query('DELETE FROM account_rate_limits');
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[owner]);
 assert.equal((await call({organisationId:organisation})).status,403);
});
