import {createRequire} from 'node:module';
import {loadRuntime,runtimeEnvironment} from './runtime.mjs';
import {operationsStatus} from '../../packages/operations/src/status.ts';

const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
const {DATABASE_URL}=runtimeEnvironment('usage',await loadRuntime('/run/local-stack'));
const pool=new Pool({connectionString:DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:10000});
try{
 if(process.argv[2]==='seed'){
  await pool.query(`WITH organisation AS(INSERT INTO organisations DEFAULT VALUES RETURNING id),
   business AS(INSERT INTO legal_businesses(organisation_id) SELECT id FROM organisation RETURNING id,organisation_id),
   venue AS(INSERT INTO venues(organisation_id,legal_business_id,local_venue_id,environment) SELECT organisation_id,id,gen_random_uuid(),'test' FROM business RETURNING id),
   installation AS(INSERT INTO installations(venue_id,public_key) SELECT id,gen_random_uuid()::text FROM venue RETURNING id)
   INSERT INTO installation_operations(installation_id,operation_id,digest,result) SELECT id,gen_random_uuid(),'usage-proof','{}' FROM installation`);
  console.log(JSON.stringify({seeded:true}));
 }else if(process.argv[2]==='status'){
  const usage=(await operationsStatus(pool,{controlApiUrl:'http://127.0.0.1:1',probeTimeoutMs:50,reconciliationStaleSeconds:2})).components.usage;
  const rows=await pool.query("SELECT count(*)::integer AS events,count(DISTINCT organisation_id)::integer AS organisations FROM usage_events WHERE event_type='operation.installation_completed'");
  console.log(JSON.stringify({...rows.rows[0],usage}));
 }else throw new Error('invalid_usage_proof_mode');
}finally{await pool.end();}
