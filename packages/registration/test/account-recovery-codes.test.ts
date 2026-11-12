import {openProofWindow} from './fixtures/action-proof.ts';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {createSession,hashSecret,resolveSession,encryptFactorSecret} from '@waitron-cloud/identity';
import * as registration from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';
import {resetSchema} from './fixtures/reset-schema.ts';

if(!process.env.TEST_DATABASE_URL)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`account_codes_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema} -c statement_timeout=10000`,application_name:schema});
const accountId=randomUUID(),password='A synthetic recovery code password';
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await resetSchema(pool);
 await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
 await pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[accountId,'owner@example.test',await hashSecret(password)]);
 await pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[accountId,Buffer.alloc(32,1)]);
 await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
  VALUES($1,$2,'c3ludGhldGlj',$3,0,'multiDevice',true)`,[randomUUID(),accountId,Buffer.from([1,2,3])]);
});

// Requiring an app secret or saving raw codes would break passkey-only recovery.
test('a passkey-only owner obtains ten account recovery codes without an app secret',async()=>{
 const session=await transaction(pool,client=>createSession(client,accountId));await openProofWindow(pool,session.token);
 const store=new registration.AuthenticatorFactorStore(pool,null,{pendingLifetimeMs:300_000,enrolmentAttempts:5});
 const {recoveryCodes:codes}=await store.regenerate({...session});
 assert.equal(codes.length,10);assert.equal(new Set(codes).size,10);
 for(const code of codes)assert.match(code,/^[A-F0-9]{32}$/);
 const rows=(await pool.query('SELECT * FROM cloud_factor_recovery_codes WHERE account_id=$1 AND consumed_at IS NULL',[accountId])).rows;
 assert.equal(rows.length,10);
 for(const code of codes)assert.equal(JSON.stringify(rows).includes(code),false);
});

const outbox=new registration.EmailOutbox({activeKeyId:'test',keys:{test:'07'.repeat(32)}});
const policy={loginLifetimeMs:300_000,challengeAttempts:5};
const login=()=>new registration.PasswordLoginStore(pool,null,policy,outbox);
async function codes(){
 const session=await transaction(pool,client=>createSession(client,accountId));await openProofWindow(pool,session.token);
 const result=await new registration.AuthenticatorFactorStore(pool,null,{pendingLifetimeMs:300_000,enrolmentAttempts:5}).regenerate({...session});
 return result.recoveryCodes;
}
async function challenge(store=login()){
 const result=await store.start({email:'owner@example.test',password});assert.equal(result.kind,'email');return result.challengeToken;
}
const refused=(action:Promise<unknown>)=>assert.rejects(action,error=>error instanceof Error&&'code' in error&&error.code==='credentials_invalid');

// Accepting a code twice, or outside the password-bound challenge, would create extra sessions.
test('a saved code replaces passkey proof once after email and password',async()=>{
 const [code]=await codes(),store=login(),token=await challenge(store);assert.ok(code);
 assert.equal(typeof store.completeRecoveryCheck,'function','saved-code completion is not implemented');
 await refused(store.completeRecoveryCheck('x'.repeat(43),code));
 const credentials=await store.completeRecoveryCheck(token,code.toLowerCase().match(/.{8}/g)!.join('-'));
 assert.equal((await transaction(pool,client=>resolveSession(client,credentials.token))).accountId,accountId);
 await refused(store.completeRecoveryCheck(await challenge(store),code));
 assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE ended_at IS NULL')).rows[0].count,'1');
});

test('concurrent challenges cannot both consume the same recovery code',async()=>{
 const [code]=await codes(),store=login(),tokens=await Promise.all([challenge(store),challenge(store)]);assert.ok(code);
 assert.equal(typeof store.completeRecoveryCheck,'function','saved-code completion is not implemented');
 const results=await Promise.allSettled(tokens.map(token=>store.completeRecoveryCheck(token,code)));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.code==='credentials_invalid').length,1);
});

test('legacy codes retain their original version hash without an app secret',async()=>{
 const code='0123456789ABCDEF0123456789ABCDEF',version=3;
 const hash=createHash('sha256').update(JSON.stringify(['cloud-factor-recovery-v1',accountId,version,code])).digest('hex');
 await pool.query('INSERT INTO cloud_factor_recovery_codes(account_id,secret_generation,factor_version,code_hash) VALUES($1,$2,$3,$4)',[accountId,randomUUID(),version,hash]);
 const store=login(),token=await challenge(store);
 assert.equal(typeof store.completeRecoveryCheck,'function','saved-code completion is not implemented');
 const credentials=await store.completeRecoveryCheck(token,code);
 assert.equal(credentials.accountId,accountId);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NOT NULL')).rows[0].count,'1');
});

const keys={activeKeyId:'test',keys:{test:'07'.repeat(32)}};
const management=()=>new registration.AuthenticatorFactorStore(pool,keys,{pendingLifetimeMs:300_000,enrolmentAttempts:5});
async function authority(){const actor=await transaction(pool,client=>createSession(client,accountId));await openProofWindow(pool,actor.token);return actor;}
function totp(secret:string,offset=0){
 const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
 const key=Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)+offset));
 const mac=createHmac('sha1',key).update(counter).digest();return ((mac.readUInt32BE(mac[19]!&15)&0x7fffffff)%1_000_000).toString().padStart(6,'0');
}
async function activeApp(){await pool.query(`INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope)
 VALUES($1,1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET version=1,secret_generation=excluded.secret_generation,secret_envelope=excluded.secret_envelope`,
 [accountId,randomUUID(),encryptFactorSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',keys,{accountId,version:1,purpose:'active'})]);}

// Removing one method must not destroy the other method's unused recovery codes.
test('removing an app keeps unused account codes while a passkey remains',async()=>{
 const saved=await codes();await activeApp();const store=management();
 const actor=await authority();await new registration.AccountActionProofStore(pool,keys,policy).factor(actor.token,actor.csrfToken,{kind:'recovery',code:saved[0]!});
 await store.remove(actor);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'9');
 const session=await login().completeRecoveryCheck(await challenge(),saved[1]!);assert.equal(session.accountId,accountId);
 assert.equal((await store.status(session.token)).recoveryCodesRemaining,8);
});

test('removing the last passkey retires codes and refuses a pending recovery sign-in',async()=>{
 const [code]=await codes(),token=await challenge(),a=await authority();assert.ok(code);
 const id=(await pool.query('SELECT id FROM cloud_passkeys')).rows[0].id;
 const passkeys=new registration.PasskeyStore(pool,{rpName:'Cloud',rpId:'cloud.example.test',origin:'https://cloud.example.test'});
 assert.equal(await passkeys.remove(a.token,a.csrfToken,id),true);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'0');
 await refused(login().completeRecoveryCheck(token,code));
});

test('adding an app preserves the existing recovery set without returning it again',async()=>{
 const saved=await codes(),a=await authority(),store=management();
 const before=(await pool.query('SELECT code_hash FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows;
 const pending=await store.begin(a),result=await store.activate(a,pending.pendingToken,totp(pending.secret));
 assert.equal(result.active,true);assert.equal('recoveryCodes' in result,false);
 assert.deepEqual((await pool.query('SELECT code_hash FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows,before);
 const signIn=new registration.PasswordLoginStore(pool,keys,policy,outbox),check=await signIn.start({email:'owner@example.test',password});assert.equal(check.kind,'factor');
 assert.equal((await signIn.complete(check.challengeToken,{kind:'recovery',code:saved[0]!})).accountId,accountId);
});

test('explicit regeneration retires old codes and reports the new account-wide count',async()=>{
 const [old]=await codes(),fresh=await codes(),a=await authority();assert.ok(old);
 assert.equal((await management().status(a.token)).recoveryCodesRemaining,10);
 await refused(login().completeRecoveryCheck(await challenge(),old));
 assert.equal((await login().completeRecoveryCheck(await challenge(),fresh[0]!)).accountId,accountId);
});


test('the app-only column upgrade preserves every legacy recovery hash and input',async()=>{
 await pool.query('ALTER TABLE cloud_factor_recovery_codes ALTER COLUMN factor_version SET NOT NULL');
 await pool.query("DELETE FROM schema_migrations WHERE name='058_account_recovery_codes.sql'");
 const code='ABCDEF0123456789ABCDEF0123456789',hash=createHash('sha256').update(JSON.stringify(['cloud-factor-recovery-v1',accountId,7,code])).digest('hex');
 await pool.query('INSERT INTO cloud_factor_recovery_codes(account_id,secret_generation,factor_version,code_hash) VALUES($1,$2,7,$3)',[accountId,randomUUID(),hash]);
 const before=(await pool.query('SELECT * FROM cloud_factor_recovery_codes')).rows;
 await migrate(pool);assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_recovery_codes')).rows,before);
 assert.equal((await login().completeRecoveryCheck(await challenge(),code)).accountId,accountId);
});

test('a retained code cannot replace a method when no enrolled method remains',async()=>{
 const [code]=await codes();assert.ok(code);const token=await challenge();
 await pool.query('DELETE FROM cloud_passkeys');
 await refused(login().completeRecoveryCheck(token,code));
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'10');
});

test('expiry during session insertion rolls back recovery-code consumption while keeping its attempt',async t=>{
 const [code]=await codes();assert.ok(code);const token=await challenge(),blocker=await pool.connect();let completion:Promise<void>|undefined;
 try{
  await pool.query("UPDATE cloud_sign_in_checks SET expires_at=clock_timestamp()+interval '2 seconds'");
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE cloud_sessions IN ACCESS EXCLUSIVE MODE');
  completion=refused(login().completeRecoveryCheck(token,code));
  await t.waitFor(async()=>assert.equal((await pool.query(`SELECT count(*) FROM pg_stat_activity WHERE application_name=$1
   AND wait_event_type='Lock' AND query LIKE 'INSERT INTO cloud_sessions%'`,[schema])).rows[0].count,'1'),{timeout:5000});
  await blocker.query('SELECT pg_sleep(2.1)');await blocker.query('COMMIT');await completion;
  const check=(await pool.query('SELECT attempts,consumed_at FROM cloud_sign_in_checks')).rows[0];assert.equal(check.attempts,1);assert.equal(check.consumed_at,null);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'10');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE ended_at IS NULL')).rows[0].count,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();await completion;}
});


test('an app added after a passkey fallback challenge still requires the current app login path',async()=>{
 const [code]=await codes();assert.ok(code);const token=await challenge();await activeApp();
 await refused(login().completeRecoveryCheck(token,code));
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'10');
 const store=new registration.PasswordLoginStore(pool,keys,policy,outbox),current=await store.start({email:'owner@example.test',password});assert.equal(current.kind,'factor');
 assert.equal((await store.complete(current.challengeToken,{kind:'recovery',code})).accountId,accountId);
});


test('concurrent removal of the final two passkeys retires every unused recovery code',async t=>{
 await codes();const a=await authority(),b=await authority(),blocker=await pool.connect();let removal:Promise<PromiseSettledResult<boolean>[]>|undefined;
 const second=randomUUID();await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
 VALUES($1,$2,'c2Vjb25k',$3,0,'multiDevice',true)`,[second,accountId,Buffer.from([3,2,1])]);
 const ids=(await pool.query('SELECT id FROM cloud_passkeys ORDER BY id')).rows.map(row=>row.id);
 const store=new registration.PasskeyStore(pool,{rpName:'Cloud',rpId:'cloud.example.test',origin:'https://cloud.example.test'});
 try{
  await blocker.query('SELECT pg_advisory_lock(hashtext($1))',[schema]);
  await pool.query(`CREATE FUNCTION hold_passkey_removal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   PERFORM pg_advisory_xact_lock(hashtext(current_schema())); RETURN OLD; END $$`);
  await pool.query('CREATE TRIGGER hold_passkey_removal AFTER DELETE ON cloud_passkeys FOR EACH ROW EXECUTE FUNCTION hold_passkey_removal()');
  removal=Promise.allSettled([store.remove(a.token,a.csrfToken,ids[0]),store.remove(b.token,b.csrfToken,ids[1])]);
  await t.waitFor(async()=>assert.equal((await pool.query(`SELECT count(*) FROM pg_stat_activity
   WHERE application_name=$1 AND wait_event_type='Lock'`,[schema])).rows[0].count,'2'),{timeout:5000});
  assert.equal((await pool.query(`SELECT count(*) FROM pg_stat_activity WHERE application_name=$1
   AND wait_event_type='Lock' AND query LIKE 'DELETE FROM cloud_passkeys%'`,[schema])).rows[0].count,'1','one removal must wait before deleting its method');
  await blocker.query('SELECT pg_advisory_unlock(hashtext($1))',[schema]);
  const results=await removal;assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value===true).length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='proof_required').length,1);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count,'1');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'10');
  await openProofWindow(pool,a.token);const last=(await pool.query('SELECT id FROM cloud_passkeys')).rows[0].id;assert.equal(await store.remove(a.token,a.csrfToken,last),true);
  assert.equal((await pool.query('SELECT count(*) FROM cloud_passkeys')).rows[0].count,'0');
  assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'0');
 }finally{
  await blocker.query('SELECT pg_advisory_unlock_all()');blocker.release();await removal?.catch(()=>{});
  await pool.query('DROP TRIGGER IF EXISTS hold_passkey_removal ON cloud_passkeys');await pool.query('DROP FUNCTION IF EXISTS hold_passkey_removal()');
 }
});


test('reactivating an app after last-method retirement returns ten fresh codes once',async()=>{
 await pool.query('DELETE FROM cloud_passkeys');const store=management(),a=await authority(),first=await store.begin(a);
 const created=await store.activate(a,first.pendingToken,totp(first.secret));assert.ok(created.recoveryCodes);assert.equal(created.recoveryCodes.length,10);
 await store.remove({...await authority()});
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'0');
 const next=await authority(),pending=await store.begin(next),result=await store.activate(next,pending.pendingToken,totp(pending.secret));
 assert.ok(result.recoveryCodes);assert.equal(result.recoveryCodes.length,10);
 assert.equal(result.recoveryCodes.some(code=>created.recoveryCodes!.includes(code)),false);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes')).rows[0].count,'20');
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'10');
});

test('app activation after code exhaustion issues a fresh set and retains consumed hashes',async()=>{
 await codes();await pool.query('UPDATE cloud_factor_recovery_codes SET consumed_at=clock_timestamp()');await activeApp();
 const before=(await pool.query('SELECT * FROM cloud_factor_recovery_codes ORDER BY code_hash')).rows;
 const store=management(),a=await authority();
 const pending=await store.begin({...a});
 const result=await store.activate({...a},pending.pendingToken,totp(pending.secret));
 assert.ok(result.recoveryCodes);assert.equal(result.recoveryCodes.length,10);
 assert.deepEqual((await pool.query('SELECT * FROM cloud_factor_recovery_codes WHERE consumed_at IS NOT NULL ORDER BY code_hash')).rows,before);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'10');
});
