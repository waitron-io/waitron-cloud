import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate,migrationNames} from '../src/migrate.ts';

test('v2 discards old connection requests and unclaimed codes while preserving venue and installation identity',async()=>{
 const schema='pairing_upgrade_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,digest text NOT NULL,applied_at timestamptz DEFAULT clock_timestamp())');
  for(const name of migrationNames.slice(0,63)){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await pool.query(sql);
   await pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
  }
  const org=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),request=randomUUID(),code=randomUUID();
  await pool.query('INSERT INTO organisations(id) VALUES($1)',[org]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,org]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,org,business,randomUUID()]);
  await pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'retained-key')",[installation,venue]);
  await pool.query("INSERT INTO pairing_requests(id,public_key,local_venue_id,environment,code_hash) VALUES($1,'pending-key',$2,'test',$3)",[request,randomUUID(),'a'.repeat(64)]);
  await pool.query("INSERT INTO connection_requests(operation_id,installation_key,local_venue_id,environment,organisation_id,legal_business_id) VALUES($1,'pending-key',$2,'test',$3,$4)",[request,randomUUID(),org,business]);
  await pool.query("INSERT INTO backup_recovery_requests(id,public_key,code_hash) VALUES($1,'recovery-key',$2)",[code,'a'.repeat(64)]);
  const account=randomUUID(),point=randomUUID(),pending=randomUUID(),completed=randomUUID(),node=randomUUID();
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
  await pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://storage.test','retained-bucket','local')",[venue,installation]);
  await pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'retained-ciphertext')",[venue]);
  await pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[point,venue,installation]);
  await pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules) VALUES($1,$2,$3,1,'snapshot','retained-object',$4,32,clock_timestamp(),'daily',$5,'{}')",[point,venue,installation,'b'.repeat(64),node]);
  await pool.query("INSERT INTO backup_managed_streams(venue_id,installation_id,requested_revision,configuration_revision,key_version,local_venue_id,source_node_id,pointer_signer_public_key,object_prefix,writer_reference,reader_reference,generation,recoverable_at,observed_at) VALUES($1,$2,0,1,1,$3,$4,'retained-signer',$5,'writer','reader','old-generation',clock_timestamp(),clock_timestamp())",[venue,installation,randomUUID(),node,`streams/${venue}/`]);
  await pool.query("INSERT INTO backup_recoveries(id,venue_id,account_id,target_public_key,mode,source_kind,stream_configuration_revision,stream_generation,stream_recoverable_at,stream_source_node_id) VALUES($1,$2,$3,'pending-target','failure','continuous',1,'old-generation',clock_timestamp(),$4)",[pending,venue,account,node]);
  await pool.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,status) VALUES($1,$2,$3,$4,'completed-target','failure','closed')",[completed,venue,point,account]);
  const result={localVenueId:randomUUID(),registration:{venueId:venue,installationId:installation},state:'complete'};
  await pool.query("INSERT INTO installation_replacements(id,venue_id,old_installation_id,public_key,peer_public_key,local_venue_id,node_id,completed_at,result) VALUES($1,$2,$3,'pending-new','pending-peer',$4,$5,NULL,NULL),($6,$2,$3,'completed-new','completed-peer',$4,$5,clock_timestamp(),$7)",[pending,venue,installation,result.localVenueId,node,completed,result]);
  await pool.query("INSERT INTO backup_recovery_requests(id,public_key,code_hash,account_id,operation_id) VALUES($1,'claimed-key',$2,$3,$1)",[pending,'c'.repeat(64),account]);
  const retained=(await pool.query('SELECT * FROM backup_key_versions')).rows,objects=(await pool.query('SELECT * FROM backup_points')).rows;
  const claimed=(await pool.query('SELECT * FROM backup_recovery_requests WHERE id=$1',[pending])).rows;
  const identity=(await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations')).rows;
  await migrate(pool);await migrate(pool);
  assert.equal((await pool.query('SELECT count(*) FROM pairing_requests')).rows[0].count,'0');
  assert.equal((await pool.query('SELECT count(*) FROM connection_requests')).rows[0].count,'0');
  assert.equal((await pool.query('SELECT expires_at<clock_timestamp() AS expired FROM backup_recovery_requests WHERE id=$1',[code])).rows[0].expired,true);
  assert.deepEqual((await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations')).rows,identity);
  assert.deepEqual((await pool.query('SELECT id,organisation_id,legal_business_id,environment FROM venues')).rows,[{id:venue,organisation_id:org,legal_business_id:business,environment:'test'}]);
  const columns=(await pool.query("SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND (column_name='local_venue_id' OR column_name='requested_venue_id') ORDER BY table_name,column_name",[schema])).rows;
  assert.deepEqual((await pool.query('SELECT generation,recoverable_at,observed_at,reader_reference,writer_reference FROM backup_managed_streams')).rows,[{generation:null,recoverable_at:null,observed_at:null,reader_reference:'reader',writer_reference:'writer'}]);
  assert.equal((await pool.query('SELECT status FROM backup_recoveries WHERE id=$1',[pending])).rows[0].status,'closed');
  assert.deepEqual((await pool.query('SELECT id,result FROM installation_replacements')).rows,[{id:completed,result:{registration:result.registration,state:'complete'}}]);
  assert.deepEqual((await pool.query('SELECT * FROM backup_key_versions')).rows,retained);
  assert.deepEqual((await pool.query('SELECT * FROM backup_points')).rows,objects);
  assert.deepEqual((await pool.query('SELECT * FROM backup_recovery_requests WHERE id=$1',[pending])).rows,claimed);
  assert.deepEqual(columns,[{table_name:'connection_requests',column_name:'requested_venue_id',is_nullable:'YES'},{table_name:'pairing_requests',column_name:'requested_venue_id',is_nullable:'YES'}]);
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
