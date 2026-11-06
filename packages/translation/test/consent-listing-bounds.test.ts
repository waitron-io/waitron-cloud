import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync} from 'node:crypto';
import type {PoolClient} from 'pg';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {listConsents} from '../src/consent.ts';
import {database,connectedVenue,giveConsent} from './fixtures.ts';
interface PlanNode {
 'Relation Name'?:string;'Actual Rows'?:number;'Rows Removed by Filter'?:number;'Actual Loops'?:number;Plans?:PlanNode[];
}
test('listing one venue does not read unrelated active consent rows',async t=>{
 const db=await database();
 try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const viewer=await connectedVenue(db,issuer,'https://cloud.example.test'),foreign=await connectedVenue(db,issuer,'https://cloud.example.test');
  await giveConsent(db,viewer);
  await db.pool.query(`INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment)
   SELECT gen_random_uuid(),$1,$2,gen_random_uuid(),'test' FROM generate_series(1,5000)`,[foreign.organisationId,foreign.legalBusinessId]);
  await db.pool.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers)
   SELECT gen_random_uuid(),id,organisation_id,$2,'providers-2026-10-14',ARRAY['openai','anthropic','google'] FROM venues WHERE organisation_id=$1`,[foreign.organisationId,foreign.accountId]);
  await db.pool.query('ANALYZE venues; ANALYZE translation_consents; ANALYZE organisation_memberships; ANALYZE cloud_accounts; ANALYZE cloud_credentials');
  let sql='',values:unknown[]=[];
  await transaction(db.pool,async c=>{
   const original=c.query;
   c.query=function(this:PoolClient,...args:unknown[]){sql=String(args[0]);values=args[1] as unknown[];return Reflect.apply(original,this,args);} as PoolClient['query'];
   try{const rows=await listConsents(c,viewer.accountId);assert.equal(rows.length,1);assert.equal(rows[0]!.venueId,viewer.venueId);assert.equal(rows[0]!.consented,true);}finally{c.query=original;}
  });
  const plan=(await db.pool.query('EXPLAIN (ANALYZE,FORMAT JSON) '+sql,values)).rows[0]['QUERY PLAN'];
  const consentRows=(node:PlanNode):number=>(node['Relation Name']==='translation_consents'
   ?((node['Actual Rows']??0)+(node['Rows Removed by Filter']??0))*(node['Actual Loops']??0):0)
   +(node.Plans??[]).reduce((sum:number,child:PlanNode)=>sum+consentRows(child),0);
  const scanned=consentRows(plan[0].Plan);
  t.diagnostic(`consent rows read for one owned venue with 5000 unrelated venues: ${scanned}`);
  assert.ok(scanned<=16,`one venue must use a bounded consent lookup, read ${scanned} rows`);
 }finally{await db.close();}
});
