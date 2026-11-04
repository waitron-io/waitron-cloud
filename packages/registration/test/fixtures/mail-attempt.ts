import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../src/migrate.ts';
import {validateSesFeedbackConfig} from '../../src/ses-feedback-config.ts';
import {feedbackFixture} from './ses-feedback.ts';

export const keys={activeKeyId:'v1',keys:{v1:'11'.repeat(32)}};
export const rotated={activeKeyId:'v2',keys:{v1:'11'.repeat(32),v2:'22'.repeat(32)}};
export function config(region='eu-north-1',country='ES') {
 const f=feedbackFixture(region,['cloud-account-email','venue-email']);
 if(country!=='ES'){
  f.policy.country=country;f.input.scope.country=country;
  for(const flow of f.input.flows)flow.country=country;
 }
 return validateSesFeedbackConfig(f.policy,f.input);
}
export async function fixture(){
 const schema='mail_attempt_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,application_name:schema,options:`-c search_path=${schema} -c statement_timeout=5000`});
 try{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);}
 catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw error;}
 return {schema,pool,admin,async account(recipient='original@example.test'){
   const outboxId=randomUUID(),claimId=randomUUID();
   await pool.query(`INSERT INTO email_outbox(id,kind,key_id,payload,expires_at,status,claim_id,lease_until,attempts)
     VALUES($1,'password_changed','payload',decode('1234','hex'),clock_timestamp()+interval '1 hour','processing',$2,clock_timestamp()+interval '1 minute',1)`,[outboxId,claimId]);
   return {config:config(),recipientKeys:keys,recipient,claim:{purpose:'cloud-account-email' as const,outboxId,claimId,attempt:1}};
 },async close(){await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}
