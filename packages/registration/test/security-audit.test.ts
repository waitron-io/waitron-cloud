import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {Pool} from 'pg';
import {createSession} from '@waitron-cloud/identity';
import {migrate} from '../src/migrate.ts';
import {recordSecurityAuditEvent, SecurityAuditStore} from '../src/security-audit.ts';
import {transaction} from '../src/transaction.ts';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`audit_${randomUUID().replaceAll('-','')}`;
const options=`-c search_path=${schema} -c statement_timeout=10000`;
const admin=new Pool({connectionString:url});
const pool=new Pool({connectionString:url,options,application_name:schema});
const store=new SecurityAuditStore(pool);
let owner:string,other:string,organisation:string,foreignOrganisation:string,venue:string,token:string;

before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await pool.query('TRUNCATE organisations,cloud_accounts CASCADE');
 owner=randomUUID();other=randomUUID();organisation=randomUUID();foreignOrganisation=randomUUID();venue=randomUUID();
 await pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[owner,other]);
 await pool.query('INSERT INTO organisations(id,name) VALUES($1,$2),($3,$4)',[organisation,'Owner Org',foreignOrganisation,'Foreign Org']);
 const business=randomUUID();await pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Owner SL','ES')",[business,organisation]);
 await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true),($3,$2,true,false)',[owner,organisation,other]);
 token=(await transaction(pool,client=>createSession(client,owner))).token;
});

const input=(overrides:Record<string,unknown>={})=>({
 organisationId:organisation,venueId:venue,type:'installation.revoked' as const,
 actorKind:'account' as const,actorId:owner,subjectKind:'installation' as const,
 subjectId:randomUUID(),sourceId:randomUUID(),...overrides,
});

test('writer returns one stable fixed-shape event and rejects a conflicting retry',async()=>{
 const event=input();
 const first=await transaction(pool,client=>recordSecurityAuditEvent(client,event));
 const retry=await transaction(pool,client=>recordSecurityAuditEvent(client,event));
 assert.deepEqual(retry,first);assert.match(first.id,/^[0-9a-f-]{36}$/);assert.ok(Number.isFinite(Date.parse(first.occurredAt)));
 const row=(await pool.query('SELECT * FROM security_audit_events')).rows[0];
 assert.deepEqual(Object.keys(row).sort(),['actor_id','actor_kind','event_type','id','occurred_at','organisation_id','source_id','subject_id','subject_kind','venue_id']);
 await assert.rejects(transaction(pool,client=>recordSecurityAuditEvent(client,{...event,actorId:other})),/security_audit_conflict/);
 assert.equal((await pool.query('SELECT count(*) FROM security_audit_events')).rows[0].count,'1');
});

test('audit insert rolls back with its protected action and rows reject mutation',async()=>{
 const rolled=input();
 await assert.rejects(transaction(pool,async client=>{await recordSecurityAuditEvent(client,rolled);throw new Error('action failed');}),/action failed/);
 assert.equal((await pool.query('SELECT count(*) FROM security_audit_events')).rows[0].count,'0');
 const saved=await transaction(pool,client=>recordSecurityAuditEvent(client,input()));
 await assert.rejects(pool.query('UPDATE security_audit_events SET actor_id=$2 WHERE id=$1',[saved.id,other]),/security_audit_immutable/);
 await assert.rejects(pool.query('DELETE FROM security_audit_events WHERE id=$1',[saved.id]),/security_audit_immutable/);
 assert.equal((await pool.query('SELECT count(*) FROM security_audit_events')).rows[0].count,'1');
});

test('owner pages are passive, tenant-scoped and stable when timestamps tie',async()=>{
 const occurredAt='2026-09-26T04:00:00.000Z',ids=[randomUUID(),randomUUID(),randomUUID()].sort().reverse();
 for(const [index,id] of ids.entries())await pool.query(`INSERT INTO security_audit_events
  (id,occurred_at,organisation_id,venue_id,event_type,actor_kind,actor_id,subject_kind,subject_id,source_id)
  VALUES($1,$2,$3,$4,$5,'account',$6,'installation',$7,$8)`,[id,occurredAt,organisation,venue,index===0?'installation.revoked':'installation.credentials_renewed',owner,randomUUID(),randomUUID()]);
 const before=(await pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at;
 const first=await store.page(token,{organisationId:organisation,limit:2});
 assert.equal(first.version,1);assert.deepEqual(first.events.map(event=>event.id),ids.slice(0,2));assert.ok(first.nextCursor);
 const second=await store.page(token,{organisationId:organisation,limit:2,cursor:first.nextCursor!});
 assert.deepEqual(second.events.map(event=>event.id),ids.slice(2));assert.equal(second.nextCursor,null);
 assert.equal((await pool.query('SELECT last_seen_at FROM cloud_sessions')).rows[0].last_seen_at.getTime(),before.getTime());
 for(const event of [...first.events,...second.events])assert.deepEqual(Object.keys(event).sort(),['actorId','actorKind','id','occurredAt','organisationId','subjectId','subjectKind','type','venueId']);
 await assert.rejects(store.page(token,{organisationId:foreignOrganisation,limit:2}),/permission_denied/);
 await assert.rejects(store.page(token,{organisationId:organisation,limit:2,cursor:'not-a-cursor'}),/invalid_input/);
 await assert.rejects(store.page(token,{organisationId:organisation,limit:0}),/invalid_input/);
 await pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[owner]);
 await assert.rejects(store.page(token,{organisationId:organisation,limit:2}),/permission_denied/);
});

test('cursor preserves PostgreSQL precision across events in one millisecond',async()=>{
 const rows=[
  {id:randomUUID(),occurredAt:'2026-09-26T04:00:00.124000Z'},
  {id:randomUUID(),occurredAt:'2026-09-26T04:00:00.123789Z'},
  {id:randomUUID(),occurredAt:'2026-09-26T04:00:00.123456Z'},
 ];
 for(const row of rows)await pool.query(`INSERT INTO security_audit_events
  (id,occurred_at,organisation_id,venue_id,event_type,actor_kind,actor_id,subject_kind,subject_id,source_id)
  VALUES($1,$2,$3,$4,'installation.credentials_renewed','installation',$5,'installation',$5,$6)`,[row.id,row.occurredAt,organisation,venue,randomUUID(),randomUUID()]);
 const returned:string[]=[];let cursor:string|undefined;
 do{const page=await store.page(token,{organisationId:organisation,limit:1,...(cursor?{cursor}:{})});returned.push(...page.events.map(event=>event.id));cursor=page.nextCursor??undefined;}while(cursor);
 assert.deepEqual(returned,rows.map(row=>row.id));
});

test('an in-progress owner page serializes with ownership removal',async()=>{
 await transaction(pool,client=>recordSecurityAuditEvent(client,input()));
 const blocker=await admin.connect();await blocker.query('BEGIN');await blocker.query(`LOCK TABLE ${schema}.security_audit_events IN ACCESS EXCLUSIVE MODE`);
 const page=store.page(token,{organisationId:organisation,limit:2});
 const waitFor=async(pattern:string)=>{for(let n=0;n<100;n++){const waiting=await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[schema,pattern]);if(waiting.rowCount)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('request did not reach lock');};
 try{
  await waitFor('SELECT %FROM security_audit_events%');
  const remove=pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[owner,organisation]);
  await waitFor('UPDATE organisation_memberships SET is_owner=false%');
  assert.equal((await admin.query(`SELECT is_owner FROM ${schema}.organisation_memberships WHERE account_id=$1 AND organisation_id=$2`,[owner,organisation])).rows[0].is_owner,true);
  await blocker.query('COMMIT');
  assert.equal((await page).events.length,1);await remove;
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
 await assert.rejects(store.page(token,{organisationId:organisation,limit:2}),/permission_denied/);
});
