import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createSession} from '@waitron-cloud/identity';
import * as registration from '../src/index.ts';
import {migrate} from '../src/migrate.ts';

test('onlyTwoInitiationExceptions: every other repair waits and no executor is available',()=>{
 assert.equal(typeof registration.CloudActions,'function','country action catalogue is missing');
 const actions=registration.cloudActionCatalogue;
 assert.deepEqual(actions.filter(a=>a.policy==='act-and-report').map(a=>a.id),['cloud_restart','machine_replace']);
 assert.deepEqual(actions.filter(a=>a.policy==='ask-first').map(a=>a.id),[
  'machine_drain','machine_add','machine_resize','hosted_restart','hosted_move','cell_create','country_failover',
  'release_expand','release_pause','release_resume','certificate_rotate','key_rotate','permission_change','security_change']);
 assert.ok(actions.every(a=>a.available===false));
});

test('configuredCountryOperatorOnly: customer ownership supplies no country grant',async()=>{
 assert.equal(typeof registration.CloudActions,'function','country operator boundary is missing');
 if(!process.env.TEST_DATABASE_URL)throw Error('Run through scripts/test-postgres.mjs');
 const schema=`actions_${randomUUID().replaceAll('-','')}`,admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const operator=randomUUID(),owner=randomUUID();
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[operator,owner]);
  const org=randomUUID();await pool.query("INSERT INTO organisations(id,name) VALUES($1,'Synthetic venue')",[org]);
  await pool.query('INSERT INTO organisation_memberships(organisation_id,account_id,is_owner) VALUES($1,$2,true)',[org,owner]);
  const actor=await registration.transaction(pool,c=>createSession(c,operator));
  const customer=await registration.transaction(pool,c=>createSession(c,owner));
  const actions=new registration.CloudActions(pool,operator);
  const hash=createHash('sha256').update(actor.token).digest('hex');
  await pool.query("UPDATE cloud_sessions SET last_seen_at=clock_timestamp()-interval '5 minutes' WHERE token_hash=$1",[hash]);
  const before=(await pool.query('SELECT last_seen_at FROM cloud_sessions WHERE token_hash=$1',[hash])).rows[0].last_seen_at;
  assert.equal((await actions.read(actor.token)).actions.length,16);
  assert.deepEqual((await pool.query('SELECT last_seen_at FROM cloud_sessions WHERE token_hash=$1',[hash])).rows[0].last_seen_at,before);
  const denied=(p:Promise<unknown>)=>assert.rejects(p,e=>e instanceof Error&&'code'in e&&e.code==='permission_denied');
  await denied(actions.read(customer.token));
  await denied(new registration.CloudActions(pool).read(actor.token));
  await denied(new registration.CloudActions(pool,'').read(actor.token));
  assert.throws(()=>new registration.CloudActions(pool,'not-an-account-id'));
  await pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[operator]);
  await assert.rejects(actions.read(actor.token));
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
