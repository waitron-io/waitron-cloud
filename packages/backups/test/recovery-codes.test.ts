import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {RecoveryCodes,recoveryCodeKeysFromEnv} from '../src/recovery-codes.ts';
const config={activeKeyId:'old',keys:{old:'a'.repeat(64)}},binding={id:randomUUID(),public_key:'machine-public-key'},code='12345678';
test('recovery verifier uses a separate domain and both immutable identity fields',()=>{
 const codes=new RecoveryCodes(config),stored=codes.protect(binding,code),digest=createHash('sha256').update(code).digest('hex');
 const expected=createHmac('sha256',Buffer.from(config.keys.old,'hex')).update(JSON.stringify(['waitron-cloud/recovery-code/v1',binding.id,binding.public_key,digest])).digest('hex');
 assert.equal(stored,'v1:old:'+expected);assert(codes.matches(binding,stored,code));assert(!stored.includes(digest));
 assert(!codes.matches({...binding,id:randomUUID()},stored,code));assert(!codes.matches({...binding,public_key:'another-machine'},stored,code));assert(!codes.matches(binding,stored,'87654321'));
 assert.equal(codes.protectDigest(binding,digest),stored);
});
test('configuration refuses absent, partial, malformed or missing named keys without disclosing them',()=>{
 assert.equal(recoveryCodeKeysFromEnv({}),undefined);assert.equal(recoveryCodeKeysFromEnv({CLOUD_PAIRING_ACTIVE_KEY_ID:'old',CLOUD_PAIRING_KEYS:JSON.stringify(config.keys)}),undefined);
 for(const env of [{CLOUD_RECOVERY_ACTIVE_KEY_ID:'old'},{CLOUD_RECOVERY_KEYS:'secret-not-for-logs'},{CLOUD_RECOVERY_ACTIVE_KEY_ID:'private-id',CLOUD_RECOVERY_KEYS:'{}'},{CLOUD_RECOVERY_ACTIVE_KEY_ID:'old',CLOUD_RECOVERY_KEYS:JSON.stringify({old:'short-private-key'})}])assert.throws(()=>recoveryCodeKeysFromEnv(env),{message:'Recovery code configuration unavailable'});
 assert.deepEqual(recoveryCodeKeysFromEnv({CLOUD_RECOVERY_ACTIVE_KEY_ID:'old',CLOUD_RECOVERY_KEYS:JSON.stringify(config.keys)}),config);
 const stored=new RecoveryCodes(config).protect(binding,code);
 for(const keys of [undefined,{activeKeyId:'new',keys:{new:'b'.repeat(64)}}])assert.throws(()=>new RecoveryCodes(keys).matches(binding,stored,code),{message:'Recovery code configuration unavailable'});
 for(const stored of [createHash('sha256').update(code).digest('hex'),'v1:old:invalid','v2:old:'+'a'.repeat(64)])assert.throws(()=>new RecoveryCodes(config).matches(binding,stored,code),{message:'Recovery code configuration unavailable'});
});
test('upgrade CLI diagnostics reveal neither malformed secret nor database address',()=>{
 const result=spawnSync(process.execPath,['src/recovery-codes-cli.ts','--once'],{encoding:'utf8',timeout:15000,env:{...process.env,DATABASE_URL:'postgres://private:database-password@127.0.0.1:1/private',CLOUD_RECOVERY_ACTIVE_KEY_ID:'private-id',CLOUD_RECOVERY_KEYS:'private-secret-material'}});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'Recovery code upgrade failed; check database, migrations and key configuration');
});

test('migration upgrades the previous release with legacy request rows intact',async()=>{
 const {Pool}=await import('pg'),{readFile}=await import('node:fs/promises'),{migrate,migrationNames}=await import('../../registration/src/migrate.ts'),{upgradeRecoveryCodes}=await import('../src/recovery-codes.ts');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}),schema='recovery_upgrade_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
  for(const name of migrationNames){if(name==='028_recovery_code_protection.sql')break;const sql=await readFile(new URL('../../registration/migrations/'+name,import.meta.url),'utf8');await pool.query(sql);await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);}
  const legacy=createHash('sha256').update(code).digest('hex');await pool.query('INSERT INTO backup_recovery_requests(id,public_key,code_hash,failed_codes) VALUES($1,$2,$3,2)',[binding.id,binding.public_key,legacy]);
  const before=(await pool.query('SELECT * FROM backup_recovery_requests')).rows;
  await migrate(pool);assert.deepEqual((await pool.query('SELECT * FROM backup_recovery_requests')).rows,before);
  assert.equal(await upgradeRecoveryCodes(pool,config),1);const row=(await pool.query('SELECT * FROM backup_recovery_requests')).rows[0];
  assert(new RecoveryCodes(config).matches(row,row.code_hash,code));assert.deepEqual({...row,code_hash:legacy},before[0]);
  assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,String(migrationNames.length));
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
