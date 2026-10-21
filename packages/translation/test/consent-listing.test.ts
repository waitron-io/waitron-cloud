import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {PoolClient} from 'pg';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {listConsents,type ConsentView} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const consentedAt='2026-10-01T12:00:00.000Z';
before(async()=>{db=await database();});after(async()=>db?.close());
async function consent(v:{venueId:string;organisationId:string;accountId:string}){
 await db.pool.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers,consented_at)
  VALUES($1,$2,$3,$4,'providers-2026-10-14',ARRAY['openai','anthropic','google'],$5)`,[randomUUID(),v.venueId,v.organisationId,v.accountId,consentedAt]);
}
async function measuredListing(accountId:string){
 return transaction(db.pool,async client=>{
  const query=client.query;let queries=0;
  client.query=function(this:PoolClient,...args:unknown[]){queries++;return Reflect.apply(query,this,args);} as PoolClient['query'];
  try{const rows=await listConsents(client,accountId);return {rows,queries};}
  finally{client.query=query;}
 });
}
test('listing many venues keeps database round trips bounded and preserves every ordered result',async t=>{
 const v=await connectedVenue(db,issuer,origin),foreign=await connectedVenue(db,issuer,origin);
 await consent(v);await consent(foreign);
 const small=await measuredListing(v.accountId);
 assert.deepEqual(small.rows,[{venueId:v.venueId,consented:true,consentedAt}]);
 const expected:ConsentView[]=[...small.rows];
 for(let i=0;i<31;i++){
  const venueId=randomUUID();
  await db.pool.query(`INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment)
   SELECT $1,organisation_id,legal_business_id,$2,environment FROM venues WHERE id=$3`,[venueId,randomUUID(),v.venueId]);
  if(i===30)await consent({...v,venueId});
  expected.push({venueId,consented:i===30,consentedAt:i===30?consentedAt:null});
 }
 expected.sort((a,b)=>a.venueId.localeCompare(b.venueId));
 const large=await measuredListing(v.accountId);
 assert.deepEqual(large.rows,expected);
 t.diagnostic(`real PostgreSQL listing: 1 venue=${small.queries} queries; 32 venues=${large.queries} queries`);
 assert.ok(large.queries<=2,`32 venues need at most two reads, observed ${large.queries}`);
});

for(const [name,change,valid] of [
 ['another current owner',null,true],
 ['former owner','DELETE FROM organisation_memberships WHERE account_id=$1',false],
 ['non-owner','UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',false],
 ['disabled owner','UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',false],
 ['unverified owner','UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',false],
 ['old version',"UPDATE translation_consents SET consent_version='providers-2026-01-01' WHERE account_id=$1",false],
 ['withdrawn consent','UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE account_id=$1',false],
] as const)
test(`listing for a different active owner checks consent from ${name}`,async()=>{
 const v=await connectedVenue(db,issuer,origin),viewer=randomUUID();await consent(v);
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[viewer]);
 await db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[viewer,`listing-${viewer}@example.test`]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[viewer,v.organisationId]);
 if(change)await db.pool.query(change,[v.accountId]);
 assert.deepEqual(await transaction(db.pool,c=>listConsents(c,viewer)),[{venueId:v.venueId,consented:valid,consentedAt:valid?consentedAt:null}]);
});

test('listing an account with no owned venues returns no consent',async()=>{
 assert.deepEqual(await transaction(db.pool,c=>listConsents(c,randomUUID())),[]);
});

test('one batch keeps consent tied to each organisation and its own current owner',async()=>{
 const first=await connectedVenue(db,issuer,origin),second=await connectedVenue(db,issuer,origin);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true),($3,$4,true)',
  [first.accountId,second.organisationId,second.accountId,first.organisationId]);
 await consent(first);await consent(second);
 const expected=[{venueId:first.venueId,consented:true,consentedAt},{venueId:second.venueId,consented:true,consentedAt}]
  .sort((a,b)=>a.venueId.localeCompare(b.venueId));
 let result=await measuredListing(first.accountId);assert.deepEqual(result.rows,expected);
 assert.ok(result.queries<=2,`two organisations need at most two reads, observed ${result.queries}`);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[second.accountId,second.organisationId]);
 result=await measuredListing(first.accountId);
 assert.deepEqual(result.rows,expected.map(row=>row.venueId===second.venueId?{venueId:second.venueId,consented:false,consentedAt:null}:row));
});
