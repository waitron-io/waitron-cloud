import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {after,before,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {createSession,type SessionCredentials} from '@waitron-cloud/identity';
import {migrate} from '../src/migrate.ts';
import {transaction} from '../src/transaction.ts';
import * as relay from '../src/relay-grants.ts';
const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Run through scripts/test-postgres.mjs');
const schema=`relay_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url});
const pool=new Pool({connectionString:url,options:`-c search_path=${schema} -c statement_timeout=5000`});
let account:string,otherAccount:string,org:string,otherOrg:string,installation:string,secondInstallation:string,foreignInstallation:string;
let session:SessionCredentials,otherSession:SessionCredentials;
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await pool.query('TRUNCATE organisations,cloud_accounts,relay_policies CASCADE');
 account=randomUUID();otherAccount=randomUUID();org=randomUUID();otherOrg=randomUUID();
 installation=randomUUID();secondInstallation=randomUUID();foreignInstallation=randomUUID();
 await pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[account,otherAccount]);
 await pool.query("INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,'ana@example.test',clock_timestamp()),($2,'bea@example.test',clock_timestamp())",[account,otherAccount]);
 await pool.query('INSERT INTO organisations(id) VALUES($1),($2)',[org,otherOrg]);
 await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true),($3,$4,true)',[account,org,otherAccount,otherOrg]);
 for(const [id,organisation] of [[installation,org],[secondInstallation,org],[foreignInstallation,otherOrg]]){
  const business=randomUUID(),venue=randomUUID();
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
  await pool.query("INSERT INTO installations(id,venue_id,public_key,lease_expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[id,venue,`key-${id}`]);
 }
 session=await transaction(pool,c=>createSession(c,account));otherSession=await transaction(pool,c=>createSession(c,otherAccount));
});
const origin='https://manage.example.test';
function configured(overrides:Record<string,unknown>={}){
 return {mode:'local-proof',consentVersion:'local-owner-v1',policy:{version:'local-test-v1',units:3,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'},
  verifyOrigin:async (request:any)=>({...request,domainControl:true,httpsEndpoint:true,expiresAt:new Date(Date.now()+3600_000).toISOString()}),...overrides};
}
function store(config:any=configured()){
 assert.ok(relay?.RelayGrantStore,'disabled relay grant core must be implemented');
 return new relay.RelayGrantStore(pool,config);
}
function approval(id=installation,overrides:Record<string,unknown>={}){
 return {installationId:id,expectedRevision:0,consent:true as const,consentVersion:'local-owner-v1',managementOrigin:origin,expiresAt:new Date(Date.now()+1800_000).toISOString(),...overrides};
}
async function approve(s=store(),input:any=approval(),actor=session){return s.approve(actor.token,actor.csrfToken,input);}
async function code(action:Promise<unknown>,expected:string){await assert.rejects(action,(e:any)=>e?.code===expected);}

test('default core exposes no grant capability even with complete caller fields',async()=>{
 assert.ok(relay?.RelayGrantStore);const s=new relay.RelayGrantStore(pool);await code(approve(s),'relay_disabled');
 assert.equal((await pool.query('SELECT count(*) FROM relay_grants')).rows[0].count,'0');
});
test('explicit owner consent binds a verified account and installation without paid services',async()=>{
 const g=await approve();assert.equal(g.accountId,account);assert.equal(g.organisationId,org);assert.equal(g.installationId,installation);
 assert.equal(g.managementOrigin,origin);assert.equal(g.revision,1);assert.equal(g.environment,'test');
 assert.equal((await pool.query('SELECT count(*) FROM installation_services')).rows[0].count,'0');
});
test('a foreign owner, missing consent, stale consent version and forged attribution are refused',async()=>{
 const s=store();await code(approve(s,approval(),otherSession),'grant_unavailable');
 for(const fields of [{consent:false},{consentVersion:'wrong'},{accountId:otherAccount},{managementOrigin:'https://evil.example/path'}]){
  await code(approve(s,approval(installation,fields)),'invalid_input');
 }
 await code(s.approve(session.token,otherSession.csrfToken,approval()),'grant_unavailable');
});
test('origin evidence must bind both checks, installation, origin and challenge and must be live',async()=>{
 for(const change of [{domainControl:false},{httpsEndpoint:false},{installationId:randomUUID()},{managementOrigin:'https://evil.example'},{challenge:'wrong'},{expiresAt:'2000-01-01T00:00:00.000Z'}]){
  const s=store(configured({verifyOrigin:async (r:any)=>({...r,domainControl:true,httpsEndpoint:true,expiresAt:new Date(Date.now()+3600_000).toISOString(),...change})}));
  await code(approve(s),'origin_unverified');
 }
});
test('an unverified or disabled account, non-owner or production installation cannot approve',async()=>{
 await pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[account]);await code(approve(),'grant_unavailable');
 await pool.query('UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1',[account]);
 await pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[account]);await code(approve(),'grant_unavailable');
 await pool.query('UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1',[account]);
 await pool.query("UPDATE venues SET environment='production' WHERE organisation_id=$1",[org]);await code(approve(),'grant_unavailable');
 await pool.query("UPDATE venues SET environment='test' WHERE organisation_id=$1",[org]);
 await pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[account]);await code(approve(),'grant_unavailable');
});

function reservation(g:any,messageId=randomUUID(),overrides:Record<string,unknown>={}){
 return {grantId:g.id,grantRevision:g.revision,messageId,binding:'opaque-keyed-message-fingerprint',...overrides};
}
async function reserve(s:any,g:any,input=reservation(g),who={installationId:g.installationId,publicKey:`key-${g.installationId}`}){
 return transaction(pool,c=>s.reserve(c,who,input));
}

test('one account shares three units across installations; another account has its own balance',async()=>{
 const s=store(),a=await approve(s),b=await approve(s,approval(secondInstallation)),foreign=await approve(s,approval(foreignInstallation),otherSession);
 const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>reserve(s,i%2?a:b)));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,3);
 for(const x of outcomes)if(x.status==='rejected')assert.equal(x.reason.code,'allowance_exhausted');
 const accepted:any=await reserve(s,foreign);assert.equal(accepted.accountId,otherAccount);
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations WHERE account_id=$1',[account])).rows[0].count,'3');
});
test('concurrent duplicates debit once and changed binding conflicts without spending',async()=>{
 const s=store(),g=await approve(s),input=reservation(g);
 const values:any[]=await Promise.all(Array.from({length:8},()=>reserve(s,g,input)));
 assert.equal(values.filter(v=>!v.replay).length,1);assert.equal(new Set(values.map(v=>v.periodStart)).size,1);
 await code(reserve(s,g,{...input,binding:'changed'}),'message_conflict');
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
});
test('foreign installation, wrong public key and payload account ID cannot spend a grant',async()=>{
 const s=store(),g=await approve(s),input=reservation(g);
 await code(reserve(s,g,input,{installationId:foreignInstallation,publicKey:`key-${foreignInstallation}`}), 'grant_unavailable');
 await code(reserve(s,g,input,{installationId:installation,publicKey:'wrong'}),'grant_unavailable');
 await code(reserve(s,g,{...input,accountId:otherAccount} as any),'invalid_input');
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'0');
});
test('revocation fences new calls and exact retries; fresh consent advances revision',async()=>{
 const s=store(),g=await approve(s),input=reservation(g);await reserve(s,g,input);
 await code(s.revoke(otherSession.token,otherSession.csrfToken,g.id),'grant_unavailable');
 await s.revoke(session.token,session.csrfToken,g.id);
 await code(reserve(s,g,input),'grant_unavailable');
 const newer=await approve(s,approval(installation,{expectedRevision:1}));assert.equal(newer.revision,2);
 await code(reserve(s,g),'grant_unavailable');
 await code(reserve(s,newer,reservation(newer,input.messageId)),'message_conflict');
 await reserve(s,newer);
});
test('origin changes require new evidence and invalidate the old revision',async()=>{
 const s=store(),g=await approve(s);
 const newer=await approve(s,approval(installation,{expectedRevision:1,managementOrigin:'https://new.example.test'}));
 assert.equal(newer.managementOrigin,'https://new.example.test');await code(reserve(s,g),'grant_unavailable');await reserve(s,newer);
 await code(approve(s,approval()),'grant_conflict');
});
for(const [name,sql] of [
 ['owner removal','DELETE FROM organisation_memberships WHERE account_id=$1'],
 ['disabled account','UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1'],
 ['lost email verification','UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1'],
 ['installation revocation','UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$2'],
 ['expired installation lease',"UPDATE installations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$2"],
 ['changed installation key',"UPDATE installations SET public_key='new-key' WHERE id=$2"],
 ['disabled grant','UPDATE relay_grants SET enabled=false WHERE installation_id=$2'],
 ['expired grant',"UPDATE relay_grants SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE installation_id=$2"],
 ['changed environment',"UPDATE venues SET environment='production' WHERE organisation_id=$3"],
] as const){test(`${name} prevents reservations including exact retries`,async()=>{
 const s=store(),g=await approve(s),input=reservation(g);await reserve(s,g,input);
 // Bind only parameters actually present in each authority mutation.
 const params=[account,installation,org];const index=Number(sql.match(/\$(\d)/)![1]);
 await pool.query(sql.replace(/\$\d/g,'$1'),[params[index-1]]);await code(reserve(s,g,input),'grant_unavailable');
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
});}
test('replacement cannot inherit the old grant or reset the account allowance',async()=>{
 const s=store(),g=await approve(s);await reserve(s,g);await reserve(s,g);await reserve(s,g);
 const replacement=randomUUID();await transaction(pool,async c=>{
  const venue=(await c.query('SELECT venue_id FROM installations WHERE id=$1',[installation])).rows[0].venue_id;
  await c.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$2 WHERE id=$1',[installation,replacement]);
  await c.query("INSERT INTO installations(id,venue_id,public_key,lease_expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[replacement,venue,`key-${replacement}`]);
 });
 await code(reserve(s,g),'grant_unavailable');
 const fresh=await approve(s,approval(replacement));await code(reserve(s,fresh),'allowance_exhausted');
});
test('rollback leaves no reservation and an exact retry can commit',async()=>{
 const s=store(),g=await approve(s),input=reservation(g);
 await assert.rejects(transaction(pool,async c=>{await s.reserve(c,{installationId:installation,publicKey:`key-${installation}`},input);throw Error('queue insert failed');}),/queue insert failed/);
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'0');
 const accepted:any=await reserve(s,g,input);assert.equal(accepted.replay,false);
});
test('policy versions and changed values cannot reset an account balance',async()=>{
 const s=store(),g=await approve(s);await reserve(s,g);
 for(const fields of [{version:'v2'},{units:100},{periodSeconds:30},{epoch:'2026-01-01T00:00:01.000Z'}]){
  const c=configured();const changed=store({...c,policy:{...c.policy,...fields}});await code(reserve(changed,g),'policy_conflict');
 }
});
test('period rollover admits new work but replay retains its original period',async()=>{
 const c=configured();const s=store({...c,policy:{...c.policy,units:1,periodSeconds:1}}),g=await approve(s),input=reservation(g);
 const first:any=await reserve(s,g,input);
 await new Promise(r=>setTimeout(r,1100));
 const replay:any=await reserve(s,g,input);assert.equal(replay.periodStart,first.periodStart);assert.equal(replay.replay,true);
 const next:any=await reserve(s,g);assert.notEqual(next.periodStart,first.periodStart);
});
test('default startup refuses reservations against grants created by configured local proof',async()=>{
 const g=await approve();assert.ok(relay?.RelayGrantStore);const disabled=new relay.RelayGrantStore(pool);
 await code(reserve(disabled,g),'relay_disabled');
});

test('a fresh process returns the original reservation after restart',async()=>{
 const s=store(),g=await approve(s),input=reservation(g),first:any=await reserve(s,g,input);
 const child=spawn(process.execPath,['test/fixtures/relay-restart.ts'],{env:{...process.env,TEST_DATABASE_OPTIONS:`-c search_path=${schema} -c statement_timeout=5000`},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
 const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 child.stdin.end(JSON.stringify({config:configured(),authenticated:{installationId:installation,publicKey:`key-${installation}`},input}));
 assert.equal(await exited,0,stderr);assert.deepEqual(JSON.parse(stdout),{...first,replay:true});
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
});

test('expiry is checked after waiting for a grant lock',async()=>{
 const s=store(),g=await approve(s),block=await pool.connect();
 await block.query('BEGIN');await block.query("UPDATE relay_grants SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",[g.id]);
 const pending=code(reserve(s,g),'grant_unavailable');
 try{await new Promise(r=>setTimeout(r,300));await block.query('COMMIT');await pending;}
 finally{await block.query('ROLLBACK');block.release();}
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'0');
});

test('owner removal committed during admission prevents a reservation',async()=>{
 const s=store(),g=await approve(s),block=await pool.connect();
 await block.query('BEGIN');await block.query('DELETE FROM organisation_memberships WHERE account_id=$1',[account]);
 const pending=code(reserve(s,g),'grant_unavailable');
 try{await new Promise(r=>setTimeout(r,30));await block.query('COMMIT');await pending;}
 finally{await block.query('ROLLBACK');block.release();}
});

test('new owner needs fresh consent and historical debits retain the original account',async()=>{
 const s=store(),g=await approve(s);await reserve(s,g);
 await pool.query('DELETE FROM organisation_memberships WHERE account_id=$1',[account]);
 await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[otherAccount,org]);
 await code(reserve(s,g),'grant_unavailable');
 const next=await approve(s,approval(installation,{expectedRevision:1}),otherSession);await reserve(s,next);
 assert.deepEqual((await pool.query('SELECT account_id,count(*) FROM relay_reservations GROUP BY account_id ORDER BY account_id')).rows,
  [account,otherAccount].sort().map(account_id=>({account_id,count:'1'})));
});

test('incomplete or production configuration cannot enable the core',()=>{
 for(const fields of [{mode:'production'},{consentVersion:undefined},{verifyOrigin:undefined},{policy:{...configured().policy,version:undefined}},{policy:{...configured().policy,excess:'unlimited'}}]){
  assert.throws(()=>store(configured(fields)),(e:any)=>e.code==='invalid_input');
 }
});

test('policy lock contention cannot preserve an expired grant for a replay',async()=>{
 const s=store(),g=await approve(s),input=reservation(g);await reserve(s,g,input);
 await pool.query("UPDATE relay_grants SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",[g.id]);
 const block=await pool.connect();await block.query('BEGIN');await block.query('SELECT version FROM relay_policies FOR UPDATE');
 const pending=code(reserve(s,g,input),'grant_unavailable');void pending.catch(()=>{});
 try{await new Promise(r=>setTimeout(r,300));await block.query('COMMIT');await pending;}
 finally{await block.query('ROLLBACK');block.release();}
});
