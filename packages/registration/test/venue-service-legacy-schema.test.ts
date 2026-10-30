import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {RegistrationStore,type ConnectionBinding} from '../src/index.ts';
import {OrganisationPlanStore,readVenuePlan} from '../src/organisation-plans.ts';
import {PairingStore} from '../src/pairing.ts';
import type {PairingClaims} from '../src/pairing-proof.ts';
import {transaction} from '../src/transaction.ts';
import {migrationRelease} from './fixtures/migration-release.ts';
import {venueServiceFixture} from './fixtures/venue-service.ts';

// New authority checks must preserve historical clients without treating damaged current schemas as legacy.
async function legacyFixture(){
 const schema='venue_legacy_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema} -c statement_timeout=5000`});
 const release=await migrationRelease(45),organisationId=randomUUID(),legalBusinessId=randomUUID(),account=randomUUID();
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await release.migrate(pool);
  await pool.query("INSERT INTO organisations(id,name) VALUES($1,'Test organisation')",[organisationId]);
  await pool.query("INSERT INTO legal_businesses(id,organisation_id,name) VALUES($1,$2,'Test business')",[legalBusinessId,organisationId]);
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
  await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues) VALUES($1,$2,true)',[account,organisationId]);
  const binding:ConnectionBinding={organisationId,legalBusinessId,operationId:randomUUID(),localVenueId:randomUUID(),environment:'test',
   installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')};
  const ledger=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;assert.equal(ledger.length,45);
  return {pool,binding,account,ledger,async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await release.close();}};
 }catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await release.close();throw error;}
}
async function unchanged(f:Awaited<ReturnType<typeof legacyFixture>>){
 assert.deepEqual((await f.pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows,f.ledger);
 assert.equal((await f.pool.query("SELECT to_regclass('billing_service_authority') AS authority")).rows[0].authority,null);
}
test('release 45 registration completion and replay preserve the historical schema',async()=>{
 const f=await legacyFixture();try{
  const store=new RegistrationStore(f.pool);await store.start(f.binding);await store.approveLocal(f.binding,randomUUID());await store.approveCloud(f.binding,f.account);
  const first=await store.complete(f.binding);assert.ok(first.installationId);assert.deepEqual(await store.complete(f.binding),first);
  assert.equal((await f.pool.query('SELECT count(*) FROM installations')).rows[0].count,'1');await unchanged(f);
 }finally{await f.close();}
});
test('release 45 pairing completion and replay preserve the historical schema',async()=>{
 const f=await legacyFixture();try{
  const store=new PairingStore(f.pool),c:PairingClaims={...f.binding,environment:'test',origin:'https://cloud.example',action:'start',requestId:f.binding.operationId,
   publicKey:f.binding.installationKey,code:'12345678',issuedAt:Date.now()};
  await store.start(c);await f.pool.query('UPDATE pairing_requests SET cloud_account_id=$2,organisation_id=$3,legal_business_id=$4 WHERE id=$1',
   [c.requestId,f.account,f.binding.organisationId,f.binding.legalBusinessId]);
  const completed={...c,action:'complete' as const,code:''},first=await store.complete(completed);assert.ok(first.registration?.installationId);
  assert.deepEqual((await store.complete(completed)).registration,first.registration);
  assert.equal((await f.pool.query('SELECT count(*) FROM installations')).rows[0].count,'1');await unchanged(f);
 }finally{await f.close();}
});
for(const action of ['read','change'] as const)test(`release 45 legacy plan ${action} does not require venue authority`,async()=>{
 const f=await legacyFixture();try{
  const venue=randomUUID(),installation=randomUUID();
  await f.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[venue,f.binding.organisationId,f.binding.legalBusinessId]);
  await f.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installation,venue,installation]);
  await f.pool.query("INSERT INTO installation_services(installation_id,service,state,configuration) VALUES($1,'remote_access','ready','{\"synthetic\":true}')",[installation]);
  if(action==='read')assert.equal(await transaction(f.pool,c=>readVenuePlan(c,venue,'test-free-paid')),'free');
  else{
   const store=new OrganisationPlanStore(f.pool);assert.equal((await store.set(f.binding.organisationId,'paid')).revision,1);
   assert.equal((await store.set(f.binding.organisationId,'free')).revision,2);
   assert.equal((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installation])).rows[0].configuration_revision,2);
   assert.deepEqual((await f.pool.query('SELECT state,configuration FROM installation_services WHERE installation_id=$1',[installation])).rows,[{state:'unconfigured',configuration:{}}]);
  }
  await unchanged(f);
 }finally{await f.close();}
});
test('a missing current authority table cannot silently restore legacy plan access',async()=>{
 const f=await venueServiceFixture();try{
  await f.pool.query('DROP TABLE billing_service_authority');
  await assert.rejects(transaction(f.pool,c=>readVenuePlan(c,f.venues[0]!,'test-free-paid')),{code:'42P01'});
  await assert.rejects(new OrganisationPlanStore(f.pool).set(f.scope.organisationId,'paid'),{code:'42P01'});
  assert.equal((await new OrganisationPlanStore(f.pool).show(f.scope.organisationId)).plan,'free');
 }finally{await f.close();}
});
