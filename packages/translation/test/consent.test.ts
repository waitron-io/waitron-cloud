import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {PoolClient} from 'pg';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {agreeConsent,hasConsent,listConsents,translationConsentVersion,TranslationError,withdrawConsent} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
const tx=<T>(work:(client:PoolClient)=>Promise<T>)=>transaction(db.pool,work);
const code=(name:string)=>(e:unknown)=>e instanceof TranslationError&&e.code===name;
async function account(organisationId:string,owner:boolean){
 const id=randomUUID();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
 await db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[id,`consent-${id}@example.test`]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,false,$3)',[id,organisationId,owner]);
 return id;
}
test('consent counts only while its owner is a current, enabled, verified owner and its version is current',async()=>{
 const v=await connectedVenue(db,issuer,origin),has=()=>tx(c=>hasConsent(c,v.venueId));
 const agree=()=>tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 const withdraw=()=>tx(c=>withdrawConsent(c,v.accountId,{venueId:v.venueId}));
 assert.equal(await has(),false);await agree();assert.equal(await has(),true);await withdraw();assert.equal(await has(),false);
 for(const [change,undo] of [
  ['UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1','UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1'],
  ['UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1','UPDATE cloud_accounts SET disabled_at=NULL WHERE id=$1'],
  ['UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1','UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1'],
  ["UPDATE translation_consents SET consent_version='providers-2026-01-01' WHERE account_id=$1 AND withdrawn_at IS NULL","UPDATE translation_consents SET consent_version='providers-2026-10-14' WHERE account_id=$1 AND withdrawn_at IS NULL"],
 ]){
  await agree();assert.equal(await has(),true);
  await db.pool.query(change!,[v.accountId]);assert.equal(await has(),false,change);
  await db.pool.query(undo!,[v.accountId]);await withdraw();
 }
});
test('only an owner of the venue may agree, with the current version; any owner may withdraw',async()=>{
 const v=await connectedVenue(db,issuer,origin),other=await connectedVenue(db,issuer,origin);
 const member=await account(v.organisationId,false),second=await account(v.organisationId,true);
 const agreeAs=(accountId:string,consentVersion=translationConsentVersion,venueId=v.venueId)=>tx(c=>agreeConsent(c,accountId,{venueId,consentVersion}));
 await assert.rejects(agreeAs(member),code('forbidden'));
 await assert.rejects(agreeAs(other.accountId),code('forbidden'));
 await assert.rejects(agreeAs(v.accountId,'providers-2026-01-01'),code('invalid_request'));
 await assert.rejects(agreeAs(v.accountId,translationConsentVersion,'not-a-venue'),code('invalid_request'));
 assert.equal((await agreeAs(v.accountId)).consented,true);
 assert.equal((await tx(c=>withdrawConsent(c,second,{venueId:v.venueId}))).consented,false);
 const rows=(await db.pool.query('SELECT providers,withdrawn_at FROM translation_consents WHERE venue_id=$1',[v.venueId])).rows;
 assert.equal(rows.length,1);assert.deepEqual(rows[0].providers,['openai','anthropic','google']);assert.ok(rows[0].withdrawn_at);
 assert.deepEqual((await tx(c=>listConsents(c,second))).map(x=>[x.venueId,x.consented]),[[v.venueId,false]]);
 assert.deepEqual(await tx(c=>listConsents(c,member)),[]);
});
test('a new owner needs fresh consent, and agreeing replaces the one whose owner left',async()=>{
 const v=await connectedVenue(db,issuer,origin),second=await account(v.organisationId,true);
 await tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[v.accountId]);
 assert.equal(await tx(c=>hasConsent(c,v.venueId)),false);
 assert.equal((await tx(c=>agreeConsent(c,second,{venueId:v.venueId,consentVersion:translationConsentVersion}))).consented,true);
 assert.deepEqual((await db.pool.query('SELECT account_id,withdrawn_at IS NULL AS current FROM translation_consents WHERE venue_id=$1 ORDER BY consented_at',[v.venueId])).rows,
  [{account_id:v.accountId,current:false},{account_id:second,current:true}]);
});

for(const [name,change] of [
 ['disabled','UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1'],
 ['unverified','UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1'],
] as const)
test(`${name} owners cannot record, withdraw or list consent`,async()=>{
 const v=await connectedVenue(db,issuer,origin);
 await tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 await db.pool.query(change,[v.accountId]);
 await assert.rejects(tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion})),code('forbidden'));
 await assert.rejects(tx(c=>withdrawConsent(c,v.accountId,{venueId:v.venueId})),code('forbidden'));
 assert.deepEqual(await tx(c=>listConsents(c,v.accountId)),[]);
 const row=(await db.pool.query('SELECT withdrawn_at FROM translation_consents WHERE venue_id=$1',[v.venueId])).rows[0];
 assert.equal(row.withdrawn_at,null);
});

test('repeat and concurrent agreements keep one unchanged current record, and rollback restores history',async()=>{
 const v=await connectedVenue(db,issuer,origin),agree=()=>tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 const first=await agree();assert.equal(first.consented,true);assert.ok(first.consentedAt);
 for(const reply of await Promise.all(Array.from({length:6},agree)))assert.deepEqual(reply,first);
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_consents WHERE venue_id=$1',[v.venueId])).rows[0].n,1);
 await assert.rejects(tx(async c=>{await withdrawConsent(c,v.accountId,{venueId:v.venueId});throw new Error('rollback consent');}),/rollback consent/);
 assert.equal(await tx(c=>hasConsent(c,v.venueId)),true);
 await tx(c=>withdrawConsent(c,v.accountId,{venueId:v.venueId}));
 await tx(c=>withdrawConsent(c,v.accountId,{venueId:v.venueId}));
 assert.deepEqual(await tx(c=>listConsents(c,v.accountId)),[{venueId:v.venueId,consented:false,consentedAt:null}]);
});

test('withdrawal waits for a replacement agreement and closes its new current record',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 await tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 await db.pool.query("UPDATE translation_consents SET consent_version='old' WHERE venue_id=$1",[v.venueId]);
 const client=await db.pool.connect();let withdrawal:Promise<unknown>|undefined;
 try{
  await client.query('BEGIN');
  const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await agreeConsent(client,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion});
  withdrawal=tx(c=>withdrawConsent(c,v.accountId,{venueId:v.venueId}));
  const end=Date.now()+5000;
  while(!(await db.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount){
   if(Date.now()>end)throw new Error('withdrawal did not wait for agreement');
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  await client.query('COMMIT');
  assert.deepEqual(await withdrawal,{venueId:v.venueId,consented:false,consentedAt:null});
  assert.equal(await tx(c=>hasConsent(c,v.venueId)),false);
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_consents WHERE venue_id=$1 AND withdrawn_at IS NOT NULL',[v.venueId])).rows[0].n,2);
 }finally{await client.query('ROLLBACK');client.release();await withdrawal;}
});

for(const [name,change] of [
 ['account disable','UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1'],
 ['email verification removal','UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1'],
 ['ownership removal','UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1'],
] as const)
test(`agreement rechecks a committed ${name} after its row-lock wait`,async()=>{
 const v=await connectedVenue(db,issuer,origin),client=await db.pool.connect();
 let operation:Promise<unknown>|undefined;
 try{
  await client.query('BEGIN');await client.query(change,[v.accountId]);
  const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  operation=tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
  // Observe either completion or the actual row-lock wait before committing the authority change.
  const settled=operation.then(value=>({value}),error=>({error}));
  const end=Date.now()+5000;
  for(;;){
   const result=await Promise.race([settled,db.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid]).then(r=>r.rowCount?'blocked':null)]);
   if(result)break;if(Date.now()>end)throw new Error('agreement did not settle or wait');
  }
  await client.query('COMMIT');
  const result=await settled;
  assert.ok('error' in result&&code('forbidden')(result.error),JSON.stringify(result));
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_consents WHERE venue_id=$1',[v.venueId])).rows[0].n,0);
 }finally{await client.query('ROLLBACK');client.release();await operation?.catch(()=>{});}
});

test('listing includes owned venues in id order with current consent and excludes another organisation',async()=>{
 const v=await connectedVenue(db,issuer,origin),second=await connectedVenue(db,issuer,origin),foreign=await connectedVenue(db,issuer,origin);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,false)',[v.accountId,second.organisationId]);
 const consent=await tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 const rows=await tx(c=>listConsents(c,v.accountId));
 const expected=[consent,{venueId:second.venueId,consented:false,consentedAt:null}].sort((a,b)=>a.venueId.localeCompare(b.venueId));
 assert.deepEqual(rows,expected);assert.equal(rows.some(row=>row.venueId===foreign.venueId),false);
 await assert.rejects(tx(c=>withdrawConsent(c,v.accountId,{venueId:foreign.venueId})),code('forbidden'));
 await assert.rejects(tx(c=>withdrawConsent(c,v.accountId,{venueId:'not-a-venue'})),code('invalid_request'));
});

for(const target of ['membership','venue'] as const)
test(`an account change may update its ${target} while agreement waits without a deadlock`,async()=>{
 const v=await connectedVenue(db,issuer,origin),client=await db.pool.connect();let operation:Promise<unknown>|undefined;
 try{
  await client.query('BEGIN');await client.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[v.accountId]);
  const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  operation=tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion})).then(value=>({value}),error=>({error}));
  const end=Date.now()+5000;
  while(!(await db.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount){
   if(Date.now()>end)throw new Error('agreement did not wait for account change');await new Promise(resolve=>setTimeout(resolve,10));
  }
  const changed=await client.query(target==='membership'?'UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1':'UPDATE venues SET organisation_id=organisation_id WHERE id=$1',[target==='membership'?v.accountId:v.venueId]).then(()=>true,error=>error);
  await client.query(changed===true?'COMMIT':'ROLLBACK');
  const result=await operation as {error?:unknown};
  assert.equal(changed,true,String(changed));assert.ok(code('forbidden')(result.error),String(result.error));
  assert.equal((await db.pool.query('SELECT * FROM translation_consents WHERE venue_id=$1',[v.venueId])).rowCount,0);
 }finally{await client.query('ROLLBACK');client.release();await operation;}
});
