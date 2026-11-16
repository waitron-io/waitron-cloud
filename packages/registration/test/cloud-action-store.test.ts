import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {createSession} from '@waitron-cloud/identity';
import {CloudActions,transaction} from '../src/index.ts';
import {migrate,migrationNames} from '../src/migrate.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import {openProofWindow} from './fixtures/action-proof.ts';

if(!process.env.TEST_DATABASE_URL)throw Error('Run through scripts/test-postgres.mjs');
const schema=`action_store_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema} -c statement_timeout=10000`,application_name:schema});
const operator=randomUUID();let actor:Awaited<ReturnType<typeof createSession>>,actions:CloudActions;
const proposal={occurrence:'synthetic-incident-1',cell:'synthetic-cell',target:'synthetic-worker',actionId:'machine_drain',proposal:'Drain the synthetic worker',evidence:'Synthetic health check failed'};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await resetSchema(pool);await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[operator]);
 await pool.query("INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,'operator@example.test','synthetic-hash',clock_timestamp())",[operator]);
 actor=await transaction(pool,c=>createSession(c,operator));await openProofWindow(pool,actor.token);actions=new CloudActions(pool,operator);
});
const code=(expected:string)=>(e:unknown)=>e instanceof Error&&'code'in e&&e.code===expected;
async function propose(input=proposal){assert.equal(typeof actions.propose,'function','durable proposals are missing');return actions.propose(actor.token,actor.csrfToken,input);}
function decision(request:{id:string;version:number},value:'approved'|'rejected'='approved'){return {requestId:request.id,version:request.version,decision:value};}

test('lostDecisionReplyKeepsIdentity: retry and polling preserve the exact approval and its deadline',async()=>{
 const request=await propose();assert.equal(request.state,'pending');assert.equal(request.available,false);
 assert.deepEqual(await propose(),request);
 const decided=await actions.decide(actor.token,actor.csrfToken,decision(request));
 assert.equal(decided.state,'approved');assert.equal(decided.effectId,request.effectId);
 assert.equal(Date.parse(decided.approvalExpiresAt!)-Date.parse(decided.decidedAt!),900000);
 assert.deepEqual(await actions.decide(actor.token,actor.csrfToken,decision(request)),decided);
 const view=await new CloudActions(pool,operator).read(actor.token);
 assert.deepEqual(view.requests,[decided]);
 assert.equal((await pool.query("SELECT count(*) FROM cloud_action_events WHERE kind='approved'")).rows[0].count,'1');
 await assert.rejects(actions.decide(actor.token,actor.csrfToken,decision(request,'rejected')),code('conflict'));
 assert.equal((await pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0','notices belong to slice 3');
});

test('changedProposalNeedsDecision: changed target/evidence creates a pending version and retires old approval',async()=>{
 const first=await propose();await actions.decide(actor.token,actor.csrfToken,decision(first));
 const next=await propose({...proposal,target:'synthetic-worker-2',evidence:'Another synthetic failure'});
 assert.equal(next.version,2);assert.equal(next.state,'pending');assert.notEqual(next.effectId,first.effectId);
 assert.equal((await propose()).id,first.id,'replaying an old observation must not revive its proposal');
 await assert.rejects(actions.decide(actor.token,actor.csrfToken,decision(first)),code('conflict'));
 await assert.rejects(actions.decide(actor.token,actor.csrfToken,{...decision(next),version:1}),code('conflict'));
 const rejected=await actions.decide(actor.token,actor.csrfToken,decision(next,'rejected'));assert.equal(rejected.state,'rejected');
 const view=await actions.read(actor.token);assert.equal(view.requests.find(r=>r.id===first.id)?.state,'superseded');
 assert.deepEqual((await pool.query('SELECT kind FROM cloud_action_events ORDER BY created_at,id')).rows.map(r=>r.kind),['proposed','approved','superseded','proposed','rejected']);
 await assert.rejects(pool.query("UPDATE cloud_action_requests SET target='rewritten' WHERE id=$1",[next.id]),/immutable/);
 await assert.rejects(pool.query("UPDATE cloud_action_events SET kind='approved' WHERE request_id=$1",[next.id]),/immutable/);
});

test('authorityRecheckedAfterWait: revoked session cannot decide after waiting for its account lock',async()=>{
 const request=await propose(),blocker=await pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[operator]);
  pending=actions.decide(actor.token,actor.csrfToken,decision(request));const rejected=assert.rejects(pending);
  let waiting=false;for(let i=0;i<100;i++){
   if((await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[schema])).rowCount){waiting=true;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(waiting,'decision must actually wait');
  await blocker.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[operator]);await blocker.query('COMMIT');await rejected;
  assert.equal((await pool.query('SELECT state FROM cloud_action_requests WHERE id=$1',[request.id])).rows[0].state,'pending');
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
});

test('decision admission requires current operator, request-forgery token and fresh sign-in',async()=>{
 const request=await propose(),other=randomUUID();await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[other]);
 const customer=await transaction(pool,c=>createSession(c,other));
 await assert.rejects(actions.decide(customer.token,customer.csrfToken,decision(request)),code('permission_denied'));
 await assert.rejects(new CloudActions(pool).decide(actor.token,actor.csrfToken,decision(request)),code('permission_denied'));
 await assert.rejects(actions.decide(actor.token,'wrong',decision(request)),code('csrf_invalid'));
 await pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '10 minutes' WHERE token_hash=$1",[createHash('sha256').update(actor.token).digest('hex')]);
 await assert.rejects(actions.decide(actor.token,actor.csrfToken,decision(request)),code('proof_required'));
 assert.equal((await actions.read(actor.token)).requests[0]!.state,'pending');
 await openProofWindow(pool,actor.token);
 await assert.rejects(propose({...proposal,actionId:'not-a-repair'}),code('invalid_input'));
 await assert.rejects(propose({...proposal,target:''}),code('invalid_input'));
});

test('populatedUpgradePreservesRows: append action storage without changing existing accounts or migration digests',async()=>{
 assert.equal(migrationNames.at(-1),'067_cloud_actions.sql');
 const old=`old_actions_${randomUUID().replaceAll('-','')}`,legacy=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${old}`});
 try{
  await admin.query(`CREATE SCHEMA ${old}`);await legacy.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,-1)){
   const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');await legacy.query(sql);
   await legacy.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  await legacy.query('INSERT INTO cloud_accounts(id) VALUES($1)',[operator]);const before=(await legacy.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await migrate(legacy);assert.equal((await legacy.query('SELECT id FROM cloud_accounts')).rows[0].id,operator);
  assert.deepEqual((await legacy.query('SELECT * FROM schema_migrations ORDER BY name')).rows.slice(0,-1),before);
  assert.equal((await legacy.query('SELECT count(*) FROM cloud_action_requests')).rows[0].count,'0');
 }finally{await legacy.end();await admin.query(`DROP SCHEMA ${old} CASCADE`);}
});
