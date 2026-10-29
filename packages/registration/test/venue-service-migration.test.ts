import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';
import {migrationRelease} from './fixtures/migration-release.ts';
import {venueServiceFixture as fixture,set,snapshot} from './fixtures/venue-service.ts';

// Catch rewritten historical receipts, partial DDL and mutable or unbound authority.
async function upgrade(){
 const schema='venue_upgrade_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});const old=await migrationRelease(45);
 try{await admin.query(`CREATE SCHEMA ${schema}`);await old.migrate(pool);return {schema,pool,old,async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await old.close();}};}
 catch(e){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await old.close();throw e;}
}
test('045 upgrades to venue service authority without changing old bytes',async()=>{
 const f=await upgrade();try{
  const before=(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;assert.equal(before.length,45);
  await Promise.all([migrate(f.pool),migrate(f.pool)]);
  assert.equal(migrationNames.length,46);assert.equal(migrationNames.at(45),'046_venue_service_authority.sql');
  const after=(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  assert.deepEqual(after.slice(0,45),before);assert.equal(after.length,46);assert.equal(after[45].name,'046_venue_service_authority.sql');
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_service_authority')).rows[0].count,'0');
  await migrate(f.pool);assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,after);
 }finally{await f.close();}
});
test('interrupted venue service migration rolls back DDL ledger and retries',async()=>{
 const f=await upgrade();try{
  const before=(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await f.pool.query("CREATE FUNCTION reject_046() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='046_venue_service_authority.sql' THEN RAISE EXCEPTION 'synthetic-046-interruption'; END IF; RETURN NEW; END $$");
  await f.pool.query('CREATE TRIGGER reject_046 BEFORE INSERT ON schema_migrations FOR EACH ROW EXECUTE FUNCTION reject_046()');
  await assert.rejects(migrate(f.pool),/synthetic-046-interruption/);
  assert.equal((await f.pool.query("SELECT to_regclass('billing_service_authority') AS relation")).rows[0].relation,null);
  assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,before);
  await f.pool.query('DROP TRIGGER reject_046 ON schema_migrations');await migrate(f.pool);
  const final=(await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;assert.equal(final.length,46);assert.deepEqual(final.slice(0,45),before);
  await migrate(f.pool);assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,final);
 }finally{await f.close();}
});
test('service authority refuses deletion identity changes skipped or rewound generations',async()=>{
 const f=await fixture();try{
  await set(f);const before=await snapshot(f),id=f.venues[0];
  for(const query of ["DELETE FROM billing_service_authority WHERE venue_id=$1","UPDATE billing_service_authority SET venue_id='00000000-0000-0000-0000-000000000000' WHERE venue_id=$1","UPDATE billing_service_authority SET organisation_id='00000000-0000-0000-0000-000000000000' WHERE venue_id=$1","UPDATE billing_service_authority SET legal_business_id='00000000-0000-0000-0000-000000000000' WHERE venue_id=$1","UPDATE billing_service_authority SET revision=revision+2 WHERE venue_id=$1","UPDATE billing_service_authority SET revision=revision-1 WHERE venue_id=$1"]){
   await assert.rejects(f.pool.query(query,[id]),{code:'55000'});assert.deepEqual(await snapshot(f),before);
  }
  await assert.rejects(f.pool.query('INSERT INTO billing_service_authority(organisation_id,legal_business_id,venue_id,revision) VALUES($1,$2,$3,1)',[f.scope.organisationId,f.scope.legalBusinessId,f.otherVenue]),{code:'23503'});
  await assert.rejects(f.pool.query('UPDATE billing_service_authority SET setup_grant_active=false,setup_grant_until=$2 WHERE venue_id=$1',[id,f.today]),{code:'23514'});
 }finally{await f.close();}
});
test('overflow refuses permission changes before event setup or fact effects',async()=>{
 const f=await fixture();try{
  await f.pool.query('INSERT INTO billing_service_authority(organisation_id,legal_business_id,venue_id,revision) VALUES($1,$2,$3,9007199254740991)',[f.scope.organisationId,f.scope.legalBusinessId,f.venues[0]]);
  const before=await snapshot(f);await assert.rejects(set(f),/billing_state_conflict/);assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});
