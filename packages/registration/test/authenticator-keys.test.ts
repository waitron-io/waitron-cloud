import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {promisify} from 'node:util';
import {Pool, type PoolClient} from 'pg';
import {createSession, decryptFactorSecret, encryptFactorSecret} from '@waitron-cloud/identity';
import {migrate} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';

const schema=`factor_keys_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,max:2,application_name:schema});
const accounts=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'] as const;
const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const old={activeKeyId:'old',keys:{old:'01'.repeat(32)}};
const keys={activeKeyId:'next',keys:{...old.keys,next:'02'.repeat(32)}};
const execute=promisify(execFile);
async function rotate(config: unknown=keys){
  const module=await import('../src/authenticator-keys-cli.ts').catch(()=>null);
  assert.equal(typeof module?.reencryptAuthenticatorKeys,'function','factor rotation is unavailable');
  return module!.reencryptAuthenticatorKeys(pool,config as typeof keys);
}
const activeBinding=(accountId:string)=>({accountId,version:2,purpose:'active' as const});
async function snapshot(){
  const tables=['cloud_authenticator_factors','cloud_factor_enrolments','cloud_sessions','cloud_factor_login_challenges','cloud_factor_recovery_codes','cloud_factor_replays'];
  return Promise.all(tables.map(async table=>(await pool.query(`SELECT * FROM ${table} ORDER BY account_id`)).rows));
}
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
  await resetSchema(pool);
  for(const accountId of accounts){
    await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
    await pool.query(`INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,2,$2,$3)`,
      [accountId,randomUUID(),encryptFactorSecret(secret,old,activeBinding(accountId))]);
    await transaction(pool,c=>createSession(c,accountId));
    const session=(await pool.query('SELECT id FROM cloud_sessions WHERE account_id=$1',[accountId])).rows[0].id;
    const id=randomUUID();
    await pool.query(`INSERT INTO cloud_factor_enrolments(id,token_hash,account_id,session_id,password_fingerprint,base_version,secret_envelope,expires_at,attempt_limit)
      VALUES($1,$2,$3,$4,$5,2,$6,clock_timestamp()+interval '5 minutes',3)`,
      [id,accountId.replaceAll('-','').repeat(2),accountId,session,'ab'.repeat(32),encryptFactorSecret(secret,old,{accountId,version:3,purpose:'pending',pendingId:id})]);
    await pool.query(`INSERT INTO cloud_factor_login_challenges(token_hash,account_id,password_fingerprint,factor_version,expires_at,attempt_limit,attempts)
      VALUES($1,$2,$3,2,clock_timestamp()+interval '5 minutes',3,1)`,[accountId.replaceAll('-','').repeat(2),accountId,'ab'.repeat(32)]);
    const generation=(await pool.query('SELECT secret_generation FROM cloud_authenticator_factors WHERE account_id=$1',[accountId])).rows[0].secret_generation;
    await pool.query(`INSERT INTO cloud_factor_recovery_codes(account_id,secret_generation,factor_version,code_hash) VALUES($1,$2,2,$3)`,[accountId,generation,'cd'.repeat(32)]);
    await pool.query(`INSERT INTO cloud_factor_replays(account_id,secret_generation,time_step,code_hash,valid_until) VALUES($1,$2,1,$3,clock_timestamp()+interval '1 minute')`,[accountId,generation,'ef'.repeat(32)]);
  }
});
test('rotation changes only active and pending ciphertext, including terminal enrolments, and retry verifies without rewriting',async()=>{
  await pool.query('UPDATE cloud_factor_enrolments SET consumed_at=clock_timestamp() WHERE account_id=$1',[accounts[0]]);
  const before=await snapshot();
  assert.deepEqual(await rotate(),{activeKeyId:'next',active:2,pending:2});
  const after=await snapshot();
  for(const row of after[0]!)assert.equal(decryptFactorSecret(row.secret_envelope,{activeKeyId:'next',keys:{next:keys.keys.next}},activeBinding(row.account_id)),secret);
  for(const row of after[1]!)assert.equal(decryptFactorSecret(row.secret_envelope,{activeKeyId:'next',keys:{next:keys.keys.next}},{accountId:row.account_id,version:row.base_version+1,purpose:'pending',pendingId:row.id}),secret);
  for(let i=0;i<2;i++)for(let j=0;j<after[i]!.length;j++)after[i]![j].secret_envelope=before[i]![j].secret_envelope;
  assert.deepEqual(after,before);
  const rotated=await snapshot();assert.deepEqual(await rotate(),{activeKeyId:'next',active:0,pending:0});assert.deepEqual(await snapshot(),rotated);
});
test('missing, malformed and incorrect keys refuse without changing the current account',async()=>{
  const before=await snapshot();
  for(const config of [null,{activeKeyId:'next',keys:[]},{activeKeyId:'next',keys:{next:keys.keys.next}},{activeKeyId:'next',keys:{old:'03'.repeat(32),next:keys.keys.next}}]){
    await assert.rejects(rotate(config),/factor_unavailable/);assert.deepEqual(await snapshot(),before);
  }
});
test('restored or swapped ciphertext must retain exact account, version and pending bindings',async()=>{
  const rows=(await pool.query('SELECT * FROM cloud_authenticator_factors ORDER BY account_id')).rows;
  await pool.query('UPDATE cloud_authenticator_factors SET secret_envelope=$2 WHERE account_id=$1',[accounts[0],rows[1].secret_envelope]);
  const before=await snapshot();await assert.rejects(rotate(),/factor_unavailable/);assert.deepEqual(await snapshot(),before);
});
test('retry must verify current-key ciphertext rather than skipping unreadable rows',async()=>{
  await rotate();const before=await snapshot();
  await assert.rejects(rotate({activeKeyId:'next',keys:{old:old.keys.old,next:'ff'.repeat(32)}}),/factor_unavailable/);
  assert.deepEqual(await snapshot(),before);
});
test('an empty database still requires a valid current key',async()=>{
  await resetSchema(pool);
  for(const config of [null,{activeKeyId:'missing',keys:{old:old.keys.old}},{activeKeyId:'next',keys:{next:'invalid'}}])await assert.rejects(rotate(config),/factor_unavailable/);
});
test('CLI refuses incomplete, extra and changed migration ledgers before touching ciphertext',async()=>{
  const env={...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,PGOPTIONS:`-c search_path=${schema}`,CLOUD_FACTOR_ACTIVE_KEY_ID:'next',CLOUD_FACTOR_KEYS:JSON.stringify(keys.keys)};
  const path=new URL('../src/authenticator-keys-cli.ts',import.meta.url).pathname,before=await snapshot();
  const row=(await pool.query("SELECT * FROM schema_migrations WHERE name='035_authenticator_factor.sql'")).rows[0];
  for(const sql of ["DELETE FROM schema_migrations WHERE name='035_authenticator_factor.sql'", "INSERT INTO schema_migrations(name,digest) VALUES('036_unknown.sql','unknown')", "UPDATE schema_migrations SET digest='wrong' WHERE name='035_authenticator_factor.sql'"]){
    await pool.query(sql);
    try{await assert.rejects(execute(process.execPath,[path,'--reencrypt'],{env}),(e:any)=>{assert.equal(e.stdout,'');assert.equal(e.stderr,'Authenticator key rotation failed; check database, migrations and factor keys\n');return true;});assert.deepEqual(await snapshot(),before);}
    finally{await pool.query("DELETE FROM schema_migrations WHERE name IN('035_authenticator_factor.sql','036_unknown.sql')");await pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)',[row.name,row.digest,row.applied_at]);}
  }
});
test('an interrupted per-account rotation rolls back that account and retry resumes completed accounts',async()=>{
  await pool.query(`CREATE FUNCTION refuse_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='${accounts[1]}' THEN RAISE EXCEPTION 'interrupted'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER refuse_rotation BEFORE UPDATE ON cloud_factor_enrolments FOR EACH ROW EXECUTE FUNCTION refuse_rotation()`);
  try{await assert.rejects(rotate(),/interrupted/);}finally{await pool.query('DROP TRIGGER refuse_rotation ON cloud_factor_enrolments;DROP FUNCTION refuse_rotation()');}
  const rows=(await pool.query('SELECT secret_envelope FROM cloud_authenticator_factors ORDER BY account_id')).rows;
  assert.match(rows[0].secret_envelope,/^v1.next\./);assert.match(rows[1].secret_envelope,/^v1.old\./);
  assert.deepEqual(await rotate(),{activeKeyId:'next',active:1,pending:1});
});
async function rotationLockWaiter(){
  // Concurrent tests share this database; only sessions named for this fixture prove its wait.
  return (await admin.query<{pid:number;query:string}>("SELECT pid,query FROM pg_stat_activity WHERE application_name=$1 AND query LIKE '%cloud_accounts%' AND wait_event_type='Lock' AND pid<>pg_backend_pid()",[schema])).rows[0];
}
test('rotation takes the account lock before factor children and re-reads changes made while waiting',async()=>{
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[accounts[0]]);
  const running=rotate();
  try{
    let query='';for(let i=0;i<100;i++){
      query=(await rotationLockWaiter())?.query??'';
      if(query)break;await new Promise(r=>setTimeout(r,20));
    }
    assert.match(query,/cloud_accounts.*FOR UPDATE/s);
    await blocker.query('UPDATE cloud_authenticator_factors SET version=3,secret_envelope=$2 WHERE account_id=$1',
      [accounts[0],encryptFactorSecret(secret,old,{...activeBinding(accounts[0]),version:3})]);
    await blocker.query('COMMIT');
    assert.deepEqual(await running,{activeKeyId:'next',active:2,pending:2});
    const row=(await pool.query('SELECT * FROM cloud_authenticator_factors WHERE account_id=$1',[accounts[0]])).rows[0];
    assert.equal(row.version,3);assert.equal(decryptFactorSecret(row.secret_envelope,keys,{...activeBinding(accounts[0]),version:3}),secret);
  }finally{await blocker.query('ROLLBACK');blocker.release();await running.catch(()=>{});}
});
test('rotation lock probe ignores a foreign waiter before observing its own session',async()=>{
  const foreign=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,max:2,application_name:`${schema}_foreign`});
  let blocker:PoolClient|undefined,waiter:PoolClient|undefined;
  let waiting:Promise<unknown>|undefined,running:ReturnType<typeof rotate>|undefined;
  try{
    blocker=await foreign.connect();waiter=await foreign.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[accounts[0]]);
    const pid=(await waiter.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    waiting=waiter.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR SHARE',[accounts[0]]);
    void waiting.catch(()=>{});
    let blocked=false;
    for(let i=0;i<100;i++){
      blocked=(await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[pid])).rowCount===1;
      if(blocked)break;await new Promise(r=>setTimeout(r,20));
    }
    assert.equal(blocked,true,'the competing session must actually be waiting');
    assert.equal(await rotationLockWaiter(),undefined,'a foreign waiter is not evidence that rotation reached its account lock');
    running=rotate();void running.catch(()=>{});
    let observed:Awaited<ReturnType<typeof rotationLockWaiter>>;
    for(let i=0;i<100;i++){
      observed=await rotationLockWaiter();
      if(observed)break;await new Promise(r=>setTimeout(r,20));
    }
    assert.ok(observed,'rotation must reach its own account lock');
    assert.notEqual(observed.pid,pid);
    assert.match(observed.query,/cloud_accounts.*FOR UPDATE/s);
    await blocker.query('ROLLBACK');
    await waiting;
    assert.deepEqual(await running,{activeKeyId:'next',active:2,pending:2});
  }finally{
    try{await blocker?.query('ROLLBACK');}
    finally{
      blocker?.release(true);
      await waiting?.catch(()=>{});await running?.catch(()=>{});
      waiter?.release(true);await foreign.end();
    }
  }
});
test('CLI requires explicit configuration and reports only counts and key ID with fixed errors',async()=>{
  const env={...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,PGOPTIONS:`-c search_path=${schema}`,CLOUD_FACTOR_ACTIVE_KEY_ID:'next',CLOUD_FACTOR_KEYS:JSON.stringify(keys.keys)};
  const path=new URL('../src/authenticator-keys-cli.ts',import.meta.url).pathname;
  const result=await execute(process.execPath,[path,'--reencrypt'],{env});
  assert.deepEqual(JSON.parse(result.stdout),{activeKeyId:'next',active:2,pending:2});assert.equal(result.stderr,'');
  for(const args of [[],['--reencrypt','--reencrypt'],['--unknown']])await assert.rejects(execute(process.execPath,[path,...args],{env}),
    (e:any)=>{assert.equal(e.stdout,'');assert.equal(e.stderr,'Authenticator key rotation failed; check database, migrations and factor keys\n');return true;});
  await assert.rejects(execute(process.execPath,[path,'--reencrypt'],{env:{...env,CLOUD_FACTOR_KEYS:''}}),(e:any)=>{assert.equal(e.stderr,'Authenticator key rotation failed; check database, migrations and factor keys\n');return true;});
});
