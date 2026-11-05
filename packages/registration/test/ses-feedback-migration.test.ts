import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';

const tables=['mail_queue_scopes','mail_attempts','mail_attempt_recipients','mail_feedback_receipts',
  'mail_feedback_events','mail_suppressions','mail_recipient_key_versions','mail_suppression_actions','mail_legacy_suppression_scopes'];
async function fixture() {
  const schema='ses_upgrade_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,application_name:schema,
    options:`-c search_path=${schema} -c statement_timeout=10000`});
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    for(const name of migrationNames.slice(0,48)) {
      const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    await pool.query('INSERT INTO organisations(id,name) VALUES($1,$2)',[randomUUID(),'preserved organisation']);
    await pool.query(`INSERT INTO email_outbox(id,kind,key_id,payload,expires_at) VALUES($1,'password_changed','old-key',decode('1234','hex'),clock_timestamp()+interval '1 hour')`,[randomUUID()]);
    const names=(await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema()')).rows;
    const before:Record<string,unknown>={};
    for(const {tablename} of names)before[tablename]=(await pool.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    return {schema,admin,pool,before,async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
  } catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw error;}
}

test('SES upgrade appends empty feedback records and preserves every old row and ledger digest',async()=>{
  const f=await fixture();try {
    await Promise.all([migrate(f.pool),migrate(f.pool)]);await migrate(f.pool);
    const ledger=(await f.pool.query('SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY name')).rows;
    assert.equal(ledger.length,50,'SES persistence and handoff mapping append their own migrations');
    assert.equal(ledger[48].row.name,'049_ses_feedback.sql');
    assert.deepEqual(ledger.slice(0,48),f.before.schema_migrations);
    for(const [name,rows] of Object.entries(f.before))if(name!=='schema_migrations')
      assert.deepEqual((await f.pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t ORDER BY to_jsonb(t)::text`)).rows,rows,name);
    for(const name of tables)assert.equal((await f.pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count,'0',name);
    const {checkConsumerSchema}=await import(new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href);
    await checkConsumerSchema(f.pool,new URL('../../../',import.meta.url).pathname);
  }finally{await f.close();}
});

test('interrupted SES ledger insert rolls back every new relation before a repeatable retry',async()=>{
  const f=await fixture(),held=await f.pool.connect();let pending:Promise<unknown>|undefined;
  try {
    assert.equal(migrationNames.at(48),'049_ses_feedback.sql');assert.equal(migrationNames.at(-1),'050_mail_legacy_suppression_scopes.sql');
    await held.query('BEGIN');await held.query('LOCK TABLE schema_migrations IN SHARE MODE');
    const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending=migrate(f.pool).then(()=>null,error=>error);
    let target:number|undefined;const until=performance.now()+5000;
    do {
      const row=(await f.admin.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query LIKE 'INSERT INTO schema_migrations%' AND $2=ANY(pg_blocking_pids(pid))",[f.schema,pid])).rows[0];
      if(row){target=row.pid;break;}await setImmediate();
    }while(performance.now()<until);
    assert.ok(target,'migration reaches the held ledger insert');
    await f.admin.query('SELECT pg_cancel_backend($1)',[target]);
    assert.equal((await pending as {code:string}).code,'57014');await held.query('ROLLBACK');
    for(const name of tables)assert.equal((await f.pool.query('SELECT to_regclass($1) AS relation',[name])).rows[0].relation,null);
    assert.deepEqual((await f.pool.query('SELECT to_jsonb(t) AS row FROM schema_migrations t ORDER BY name')).rows,f.before.schema_migrations);
    await Promise.all([migrate(f.pool),migrate(f.pool)]);
    assert.equal((await f.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'50');
  }finally{await held.query('ROLLBACK');held.release();await pending;await f.close();}
});

test('feedback ledger enforces transport deduplication and preserves first evidence',async()=>{
 const f=await fixture();try{
  await migrate(f.pool);
  const {emptySesFeedback}=await import(new URL('../../../scripts/schema-upgrade-fixture.mjs',import.meta.url).href);
  assert.equal(await emptySesFeedback(f.pool),true);
  const values=['ES','arn:aws:sns:eu-north-1:123456789012:mail-feedback','sns-one','a'.repeat(64)];
  const insert=`INSERT INTO mail_feedback_receipts(country,topic_arn,sns_id,content_digest,result,diagnostic) VALUES($1,$2,$3,$4,'ignored','unresolved')`;
  await f.pool.query(insert,values);
  await assert.rejects(emptySesFeedback(f.pool),{name:'AssertionError'});
  await assert.rejects(f.pool.query(insert,[...values.slice(0,3),'b'.repeat(64)]),{code:'23505'});
  await assert.rejects(f.pool.query("UPDATE mail_feedback_receipts SET content_digest=repeat('b',64)"),/mail_binding_immutable/);
  await assert.rejects(f.pool.query('DELETE FROM mail_feedback_receipts'),/mail_binding_immutable/);
  assert.equal((await f.pool.query('SELECT content_digest FROM mail_feedback_receipts')).rows[0].content_digest,'a'.repeat(64));
  for(const id of ['','a'.repeat(257),'unsafe\nvalue'])await assert.rejects(f.pool.query(insert,['ES',values[1],id,values[3]]),{code:'23514'});
 }finally{await f.close();}
});

test('receipt scope and fixed processing results refuse contradictory records',async()=>{
 const f=await fixture();try{
  await migrate(f.pool);
  const sql=`INSERT INTO mail_feedback_receipts(country,topic_arn,sns_id,content_digest,result,diagnostic) VALUES($1,$2,'scope-test',repeat('a',64),$3,$4)`;
  for(const row of [['not-a-country','arn:aws:sns:eu-north-1:123456789012:mail-feedback','ignored','unresolved'],
   ['ES','arbitrary-topic','ignored','unresolved'],['ES','arn:aws:sns:eu-north-1:123456789012:mail-feedback','applied','unresolved']])
   await assert.rejects(f.pool.query(sql,row),{code:'23514'});
 }finally{await f.close();}
});
