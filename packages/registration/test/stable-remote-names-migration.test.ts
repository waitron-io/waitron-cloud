import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import {migrationRelease} from './fixtures/migration-release.ts';

test('the migration writes every assigned name under the zone, including a venue in a second cell',async()=>{
 const old=await migrationRelease(69),schema='stable_names_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}),pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await old.migrate(pool);
  const organisation=randomUUID(),business=randomUUID(),venues=[randomUUID(),randomUUID()],installations=[randomUUID(),randomUUID()],cells=[randomUUID(),randomUUID()];
  await pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
  for(let n=0;n<2;n++){
   const suffix=n===0?'a.example.test':'b.example.test';
   await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venues[n],organisation,business]);
   await pool.query('INSERT INTO installations(id,venue_id,public_key,configuration_revision) VALUES($1,$2,$3,5)',[installations[n],venues[n],'synthetic-'+n]);
   await pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test',$2,$3,$4,'gateway.example.test:51820')",[cells[n],suffix,n,randomBytes(32).toString('base64')]);
   await pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,$4,$5,443)",[venues[n],installations[n],cells[n],`10.77.${n}.2`,randomBytes(32).toString('base64')]);
   const staff=`staff-v-${venues[n]}.${suffix}`,publicName=n===0?`v-${venues[n]}.${suffix}`:'menu.cafe.example.test';
   await pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES($1,$2,'staff'),($3,$2,'public')",[staff,venues[n],publicName]);
   await pool.query("INSERT INTO installation_services(installation_id,service,state,configuration) VALUES($1,'remote_access','provisioning',$2)",[installations[n],{version:1,staffHostname:staff,publicHostname:publicName,cellId:cells[n]}]);
  }
  const disabled=[];
  for(const configuration of [{},{peerPublicKey:'retired-key'}]){
   const venue=randomUUID(),installation=randomUUID(),staff=`staff-v-${venue}.a.example.test`,publicName=`v-${venue}.a.example.test`;
   await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venue,organisation,business]);
   await pool.query('INSERT INTO installations(id,venue_id,public_key,configuration_revision) VALUES($1,$2,$3,5)',[installation,venue,'disabled-'+installation]);
   await pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,$4,$5,443)",[venue,installation,cells[0],`10.77.0.${3+disabled.length}`,randomBytes(32).toString('base64')]);
   await pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES($1,$2,'staff'),($3,$2,'public')",[staff,venue,publicName]);
   await pool.query("INSERT INTO installation_services(installation_id,service,state,configuration) VALUES($1,'remote_access','unconfigured',$2)",[installation,configuration]);
   disabled.push({installation,configuration});
  }
  const ledger=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  await Promise.all([migrate(pool),migrate(pool)]);await migrate(pool);
  assert.deepEqual((await pool.query('SELECT * FROM remote_country_zones')).rows,[{country:'ES',environment:'test',suffix:'a.example.test'}]);
  const names=(await pool.query('SELECT hostname,assigned_hostname,kind FROM remote_hostnames WHERE venue_id=$1 ORDER BY kind',[venues[1]])).rows;
  assert.deepEqual(names,[{hostname:'menu.cafe.example.test',assigned_hostname:`v-${venues[1]}.a.example.test`,kind:'public'},
   {hostname:`staff-v-${venues[1]}.a.example.test`,assigned_hostname:`staff-v-${venues[1]}.a.example.test`,kind:'staff'}]);
  assert.equal((await pool.query("SELECT count(*) FROM remote_hostnames WHERE assigned_hostname LIKE '%.b.example.test'")).rows[0].count,'0');
  const view=(await pool.query("SELECT s.configuration,i.configuration_revision FROM installation_services s JOIN installations i ON i.id=s.installation_id WHERE i.id=$1",[installations[1]])).rows[0];
  assert.deepEqual(view,{configuration:{version:1,cellId:cells[1],staffHostname:`staff-v-${venues[1]}.a.example.test`,publicHostname:'menu.cafe.example.test'},configuration_revision:6});
  assert.equal((await pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installations[0]])).rows[0].configuration_revision,5);
  for(const row of disabled)assert.deepEqual((await pool.query("SELECT s.state,s.configuration,i.configuration_revision FROM installation_services s JOIN installations i ON i.id=s.installation_id WHERE i.id=$1",[row.installation])).rows,[{state:'unconfigured',configuration:row.configuration,configuration_revision:5}]);
  const current=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;assert.deepEqual(current.slice(0,69),ledger);assert.equal(current.length,77);assert.equal(current[69].name,'070_stable_remote_names.sql');
  await assert.rejects(pool.query("INSERT INTO remote_country_zones(country,environment,suffix) VALUES('ES','test','other.example.test')"),{code:'23505'});
  await assert.rejects(pool.query("UPDATE remote_hostnames SET assigned_hostname=$1 WHERE venue_id=$2 AND kind='staff'",[names[0]!.assigned_hostname,venues[0]]),{code:'23505'});
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await old.close();}
});
