import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../src/migrate.ts';

const root=new URL('../../../',import.meta.url).pathname;
// Missing restored pending calls, source rows, or exact retry identity must refuse qualification.
test('allowance recovery retains pending calls and exact traffic retries without refunding spent units',async()=>{
 const schema='allowance_recovery_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 let proof:any;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const base=await import(new URL('../../../scripts/schema-upgrade-fixture.mjs',import.meta.url).href);
  const key=(name:string)=>({activeKeyId:name,keys:{[name]:randomBytes(32).toString('hex')}});
  const state=await base.seed(root,pool,key('email'),key('pairing'));
  const fixture=await import(new URL('../../../scripts/schema-upgrade-allowance-fixture.mjs',import.meta.url).href).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
  assert.equal(typeof fixture.seedAllowances,'function','recovery must populate real allowance and traffic state');
  proof=await fixture.seedAllowances(root,pool,state);
  const expected=await fixture.allowanceState(pool);
  assert.equal(expected.billing_allowance_versions.length,2);
  assert.equal(expected.billing_allowance_reservations.length,4);
  assert.equal(expected.remote_traffic_reports.length,2);
  assert.equal(expected.remote_traffic_samples.length,4);
  assert.equal(expected.usage_events.length,2);
  assert.deepEqual(expected.translation_jobs.map((r:any)=>r.value.allowance_open_calls).sort(),[0,0,0,1]);
  await fixture.restoredAllowances(root,pool,proof,expected);
  assert.deepEqual(await fixture.allowanceState(pool),expected);
  await pool.query('UPDATE translation_jobs SET allowance_open_calls=0 WHERE id=$1',[proof.pendingJob]);
  await assert.rejects(fixture.restoredAllowances(root,pool,proof,expected),/pending calls and exact allowance facts survive/);
 }finally{
  await proof?.close();await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});
