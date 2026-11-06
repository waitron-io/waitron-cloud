import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../src/migrate.ts';

// Proof wrappers must reach the actual candidate schema before reporting any qualification.
export async function requireAllowanceSchema(){
 const schema='allowance_proof_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const ledger=(await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows;
  assert.equal(ledger.length,51,'allowance proof requires the actual candidate through migration51');
  assert.equal(ledger[47].name,'048_billing_allowances_traffic.sql');assert.equal(ledger[48].name,'049_ses_feedback.sql');
  assert.equal(ledger[49].name,'050_mail_legacy_suppression_scopes.sql');assert.equal(ledger[50].name,'051_mail_suppression_reconciliation.sql');
  for(const name of ['billing_allowance_versions','billing_allowance_reservations','remote_traffic_processes','remote_traffic_samples','remote_traffic_coverage','remote_traffic_reports','mail_legacy_suppression_scopes','mail_legacy_suppression_lifetimes','mail_unblock_requests','mail_unblock_outcomes','mail_suppression_revisions','mail_unblock_provider_attempts','mail_unblock_provider_results']){
   assert.equal((await pool.query(`SELECT count(*) FROM ${name}`)).rows[0].count,'0',name+' must start empty');
  }
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
}
