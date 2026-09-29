import {UsageReconciler} from '../../packages/registration/src/usage-metering.ts';
import {createRequire} from 'node:module';
import {loadRuntime,runtimeEnvironment} from './runtime.mjs';
import {operationsStatus} from '../../packages/operations/src/status.ts';

const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
const {DATABASE_URL}=runtimeEnvironment('usage',await loadRuntime('/run/local-stack'));
const pool=new Pool({connectionString:DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:10000});
try{
 if(process.argv[2]==='seed'){
  const seeded=await pool.query(`WITH organisation AS(INSERT INTO organisations(id) VALUES(gen_random_uuid()) RETURNING id),
   business AS(INSERT INTO legal_businesses(id,organisation_id) SELECT gen_random_uuid(),id FROM organisation RETURNING id,organisation_id),
   venue AS(INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) SELECT gen_random_uuid(),organisation_id,id,gen_random_uuid(),'test' FROM business RETURNING id),
   installation AS(INSERT INTO installations(id,venue_id,public_key) SELECT gen_random_uuid(),id,gen_random_uuid()::text FROM venue RETURNING id)
   INSERT INTO installation_operations(installation_id,operation_id,digest,result) SELECT id,gen_random_uuid(),'usage-proof','{}' FROM installation RETURNING installation_id`);
  const installationId=seeded.rows[0].installation_id;
  const owner=(await pool.query('SELECT v.id AS venue_id,v.organisation_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1',[installationId])).rows[0];
  console.log(JSON.stringify({seeded:true,installationId,...owner}));
 }else if(process.argv[2]==='lock'){
  const client=await pool.connect();
  // The final source blocks after earlier event writes, so timeout must roll them back too.
  try{
   await client.query("SET application_name='usage-proof-lock'");
   await client.query('BEGIN');
   await client.query("SELECT * FROM usage_reconciliation_sources WHERE source='service_alerts' FOR UPDATE");
   console.log('locked');
   await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});
   await client.query('ROLLBACK');
  }finally{client.release();}
 }else if(process.argv[2]==='status'){
  const usage=(await operationsStatus(pool,{controlApiUrl:'http://127.0.0.1:1',probeTimeoutMs:50,reconciliationStaleSeconds:2})).components.usage;
  const rows=await pool.query("SELECT count(*)::integer AS events,count(DISTINCT organisation_id)::integer AS organisations FROM usage_events WHERE event_type='operation.installation_completed'");
  const sources=(await new UsageReconciler(pool).status()).sources;
  const totals=(await pool.query("SELECT organisation_id,venue_id,source_reference,quantity::text FROM usage_events WHERE event_type='operation.installation_completed' ORDER BY source_reference")).rows;
  const locks=(await pool.query(`SELECT a.pid,a.query,a.wait_event_type FROM pg_stat_activity a
   WHERE EXISTS(SELECT 1 FROM pg_stat_activity blocker WHERE blocker.application_name='usage-proof-lock'
    AND blocker.pid=ANY(pg_blocking_pids(a.pid)))`)).rows;
  console.log(JSON.stringify({...rows.rows[0],usage,sources,totals,locks}));
 }else throw new Error('invalid_usage_proof_mode');
}finally{await pool.end();}
