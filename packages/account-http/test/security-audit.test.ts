import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {recordSecurityAuditEvent,transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';

let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>;
const origin='https://cloud.example.test';
let owner:string,member:string,organisation:string,foreignOrganisation:string,venue:string,auditEventId:string,session:{token:string;csrfToken:string},memberSession:{token:string;csrfToken:string};
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await db.pool.query('TRUNCATE account_rate_limits,organisations,cloud_accounts CASCADE');
 owner=randomUUID();member=randomUUID();organisation=randomUUID();foreignOrganisation=randomUUID();venue=randomUUID();
 const business=randomUUID(),foreignBusiness=randomUUID(),foreignVenue=randomUUID();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[owner,member]);
 await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Owner Org'),($2,'Foreign Org')",[organisation,foreignOrganisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Owner SL','ES'),($3,$4,'Foreign SL','ES')",[business,organisation,foreignBusiness,foreignOrganisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test'),($5,$6,$7,$8,'test')",[venue,organisation,business,randomUUID(),foreignVenue,foreignOrganisation,foreignBusiness,randomUUID()]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true),($3,$2,true,false)',[owner,organisation,member]);
 session=await transaction(db.pool,client=>createSession(client,owner));memberSession=await transaction(db.pool,client=>createSession(client,member));
 auditEventId=(await transaction(db.pool,client=>recordSecurityAuditEvent(client,{organisationId:organisation,venueId:venue,type:'installation.revoked',actorKind:'account',actorId:owner,subjectKind:'installation',subjectId:randomUUID(),sourceId:randomUUID()}))).id;
 await transaction(db.pool,client=>recordSecurityAuditEvent(client,{organisationId:foreignOrganisation,venueId:foreignVenue,type:'installation.credentials_renewed',actorKind:'installation',actorId:randomUUID(),subjectKind:'installation',subjectId:randomUUID(),sourceId:randomUUID()}));
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
});
function call(body:unknown,credentials=session,headers:Record<string,string>={},method='POST'){
 return app.request(origin+'/api/account/security-audit/read',{method,headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+credentials.token,'x-csrf-token':credentials.csrfToken,...headers},body:method==='POST'?JSON.stringify(body):undefined},{incoming:{socket:{remoteAddress:'192.0.2.44'}}} as HttpBindings);
}
test('owner receives a passive tenant-scoped page with no request secrets',async()=>{
 const second=(await transaction(db.pool,client=>recordSecurityAuditEvent(client,{organisationId:organisation,venueId:venue,type:'installation.credentials_renewed',actorKind:'installation',actorId:randomUUID(),subjectKind:'installation',subjectId:randomUUID(),sourceId:randomUUID()}))).id;
 const firstResponse=await call({organisationId:organisation,limit:1});assert.equal(firstResponse.status,200,await firstResponse.clone().text());
 const first=await firstResponse.json() as {version:number;events:{id:string;organisationId:string}[];nextCursor:string|null};
 assert.equal(first.version,1);assert.equal(first.events.length,1);assert.ok(first.nextCursor);assert.equal(first.events[0]?.organisationId,organisation);
 const secondResponse=await call({organisationId:organisation,limit:1,cursor:first.nextCursor});assert.equal(secondResponse.status,200,await secondResponse.clone().text());
 const last=await secondResponse.json() as typeof first;assert.equal(last.events.length,1);assert.equal(last.nextCursor,null);assert.equal(last.events[0]?.organisationId,organisation);
 assert.deepEqual(new Set([...first.events,...last.events].map(event=>event.id)),new Set([auditEventId,second]));
 const encoded=JSON.stringify([first,last]);for(const value of [session.token,session.csrfToken,foreignOrganisation])assert.equal(encoded.includes(value),false);
 assert.equal((await db.pool.query('SELECT last_seen_at FROM cloud_sessions WHERE account_id=$1',[owner])).rows[0].last_seen_at.getTime(),(await db.pool.query('SELECT created_at FROM cloud_sessions WHERE account_id=$1',[owner])).rows[0].created_at.getTime());
});
test('route requires exact method, origin, session, CSRF, input and current ownership',async()=>{
 assert.equal((await call({organisationId:organisation},session,{},'GET')).status,405);
 assert.equal((await call({organisationId:organisation},session,{origin:'https://wrong.example'})).status,403);
 assert.equal((await call({organisationId:organisation},session,{'x-csrf-token':'wrong'})).status,403);
 assert.equal((await call({organisationId:organisation},{token:'missing',csrfToken:session.csrfToken})).status,401);
 for(const body of [{organisationId:'bad'},{organisationId:organisation,limit:0},{organisationId:organisation,limit:101},{organisationId:organisation,cursor:'bad'},{organisationId:organisation,extra:true}])assert.equal((await call(body)).status,400);
 assert.equal((await call({organisationId:foreignOrganisation})).status,403);
 assert.equal((await call({organisationId:organisation},memberSession)).status,403);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[owner]);
 assert.equal((await call({organisationId:organisation})).status,403);
});
