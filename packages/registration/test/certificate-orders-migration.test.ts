import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';
import {migrationRelease} from './fixtures/migration-release.ts';

test('the upgrade preserves custom names and permits one order row per hostname',async()=>{
 const old=await migrationRelease(73),schema='certificate_orders_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL}),pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),cell=randomUUID();
 const name='staff.cafe.example.test',assigned=`staff-v-${venue}.example.test`;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await old.migrate(pool);
  await pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venue,organisation,business]);
  await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'synthetic-order-key')",[installation,venue]);
  await pool.query("INSERT INTO remote_country_zones(country,environment,suffix) VALUES('ES','test','example.test')");
  await pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','example.test',7,$2,'gateway.example.test:51820')",[cell,randomBytes(32).toString('base64')]);
  await pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,'10.77.7.2',$4,443)",[venue,installation,cell,randomBytes(32).toString('base64')]);
  await pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind,assigned_hostname) VALUES($1,$2,'staff',$3)",[name,venue,assigned]);
  await migrate(pool);
  assert.deepEqual((await pool.query('SELECT hostname,assigned_hostname,record_moved_at FROM remote_hostnames')).rows,[{hostname:name,assigned_hostname:assigned,record_moved_at:null}]);
  const insert="INSERT INTO remote_certificate_orders(hostname,claim_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '5 minutes')";
  await pool.query(insert,[name,randomUUID()]);
  await assert.rejects(pool.query(insert,[name,randomUUID()]),{code:'23505'});
 }finally{
  await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await old.close();
 }
});
