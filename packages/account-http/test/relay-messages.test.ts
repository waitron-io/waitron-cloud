import {spawn} from 'node:child_process';
import {InstallationStore} from '@waitron-cloud/registration';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {RelayGrantStore} from '../../registration/src/relay-grants.ts';
import {relayFixture} from './fixtures/relay.ts';
let f:Awaited<ReturnType<typeof relayFixture>>;
before(async()=>{f=await relayFixture();});after(async()=>f?.close());
beforeEach(async()=>{await f.db.pool.query('TRUNCATE account_rate_limits');});
const lookup=(id:string)=>({version:1,messageId:id});
async function submit(a:Awaited<ReturnType<typeof f.venue>>,body=a.body){return f.request('submit',a.proof('email-submit',body));}
async function read(a:Awaited<ReturnType<typeof f.venue>>,action='status',id=a.body.messageId){return f.request(action,a.proof('email-'+action,lookup(id)));}
async function count(table:string){return Number((await f.db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);}

test('signed admission commits one encrypted message and debit and replays after a lost reply and restart',async()=>{
 const a=await f.venue(),n=await count('relay_reservations');
 const first=await submit(a);assert.equal(first.status,202,first.text);
 assert.deepEqual(first.body,{version:1,messageId:a.body.messageId,state:'queued',statusRevision:1,expiresAt:a.body.expiresAt,reason:null});
 assert.equal(first.headers['cache-control'],'no-store');
 // Discard the accepted reply, then reconnect with the same durable ID and body.
 await f.restart();const again=await submit(a);assert.equal(again.status,200,again.text);assert.deepEqual(again.body,first.body);
 assert.deepEqual((await read(a)).body,first.body);assert.equal(await count('relay_reservations'),n+1);
 const row=(await f.db.pool.query('SELECT * FROM relay_messages WHERE message_id=$1',[a.body.messageId])).rows[0];
 for(const [field,secret] of Object.entries({recipient:a.body.recipient,token:a.body.token,displayName:a.body.displayName})){assert.equal(JSON.stringify(row).includes(secret),false);assert.equal(row.payload.toString('utf8').includes(JSON.stringify(field)+':'+JSON.stringify(secret)),false);}
 assert.ok(Buffer.isBuffer(row.payload));assert.ok(row.payload.length>28);
 assert.equal(await count('email_outbox'),0);
});
test('three classes match current Waitron deadlines and email change uses its shorter code deadline',async()=>{
 for(const kind of ['invitation','password_reset','email_change']){
  const a=await f.venue(),body:any={...a.body,class:kind,expiresAt:new Date(Date.now()+(kind==='invitation'?86400000:1800000)).toISOString()};
  if(kind==='email_change'){delete body.token;body.code='012345';body.codeExpiresAt=new Date(Date.now()+600000).toISOString();}
  const r=await submit(a,body);assert.equal(r.status,202,r.text);assert.equal(r.body.expiresAt,body.codeExpiresAt??body.expiresAt);
 }
});
test('parallel same-ID admissions debit once and a changed body conflicts',async()=>{
 const a=await f.venue(),before=await count('relay_reservations');
 const results=await Promise.all(Array.from({length:6},()=>submit(a)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,200,200,200,200,202]);
 const changed=await submit(a,{...a.body,recipient:'bea@example.test'});assert.equal(changed.status,409,changed.text);
 assert.equal(await count('relay_reservations'),before+1);
});
test('wrong key, action, origin, lease and operation identity cannot admit work',async()=>{
 const a=await f.venue(),b=await f.venue(),n=await count('relay_reservations');
 for(const proof of [a.proof('email-status'),a.proof('email-submit',a.body,{installationId:b.installationId}),a.proof('email-submit',a.body,{origin:'https://wrong.example.test'}),a.proof('email-submit',a.body,{lease:JSON.stringify(b.lease)}),a.proof('email-submit',a.body,{lease:JSON.stringify(f.issuer.issue({...a.leaseInput,issuedAt:Date.now()-3600000,expiresAt:Date.now()-1}))}),a.proof('email-submit',a.body,{issuedAt:Date.now()-120000})]){
  const r=await f.request('submit',proof);assert.equal(r.status,401,r.text);
 }
 const mismatch=await f.request('submit',a.proof('email-submit',a.body,{operationId:randomUUID()}));assert.equal(mismatch.status,400,mismatch.text);
 assert.equal((await f.request('submit',a.proof('email-submit'),{origin:f.origin})).status,403);
 assert.equal(await count('relay_reservations'),n);
});
test('unknown fields, HTML/header injection, supplied links and invalid version, class, token or expiry never queue',async()=>{
 const a=await f.venue(),n=await count('relay_reservations');
 for(const change of [{version:2},{class:'marketing'},{html:'<img src=x>'},{headers:{From:'attacker'}},{actionUrl:'https://evil.example.test'},{accountId:randomUUID()},{displayName:'<b>Ana</b>'},{displayName:'Ana\r\nBcc:x@y.test'},{recipient:'ana@example.test\r\nBcc:x@y.test'},{timeZone:'not-a-zone'},{locale:'xx'},{token:'not-a-token'},{expiresAt:'2000-01-01T00:00:00.000Z'},{expiresAt:new Date(Date.now()+90000000).toISOString()}]){
  const r=await submit(a,{...a.body,...change} as any);assert.equal(r.status,400,r.text);
 }
 assert.equal(await count('relay_reservations'),n);
});
test('foreign and missing IDs have identical status/cancel errors without revealing content',async()=>{
 const a=await f.venue(),b=await f.venue();assert.equal((await submit(a)).status,202);
 for(const action of ['status','cancel']){
  const foreign=await read(b,action,a.body.messageId),missing=await read(b,action,randomUUID());
  assert.equal(foreign.status,403);assert.deepEqual(foreign.body,missing.body);assert.equal(foreign.text.includes(a.body.recipient),false);
 }
 const forged=await submit(b,{...b.body,grantId:a.grant.id});assert.equal(forged.status,403,forged.text);
});
test('cancel clears ciphertext, retains the debit and tombstone, and cannot cancel started handoff',async()=>{
 const a=await f.venue();assert.equal((await submit(a)).status,202);const n=await count('relay_reservations');
 const cancelled=await read(a,'cancel');assert.equal(cancelled.status,200);assert.equal(cancelled.body.state,'cancelled');assert.equal(cancelled.body.statusRevision,2);
 assert.deepEqual((await read(a,'cancel')).body,cancelled.body);assert.deepEqual((await submit(a)).body,cancelled.body);
 assert.equal((await f.db.pool.query('SELECT payload FROM relay_messages WHERE message_id=$1',[a.body.messageId])).rows[0].payload,null);assert.equal(await count('relay_reservations'),n);
 const b=await f.venue();assert.equal((await submit(b)).status,202);await f.db.pool.query("UPDATE relay_messages SET state='sending',status_revision=2 WHERE message_id=$1",[b.body.messageId]);
 assert.equal((await read(b,'cancel')).body.state,'sending');
});
for(const [name,sql] of [
 ['revoked grant','UPDATE relay_grants SET enabled=false WHERE installation_id=$1'],
 ['stale grant','UPDATE relay_grants SET revision=revision+1 WHERE installation_id=$1'],
 ['removed owner','DELETE FROM organisation_memberships WHERE organisation_id=(SELECT v.organisation_id FROM venues v JOIN installations i ON i.venue_id=v.id WHERE i.id=$1)'],
 ['revoked installation','UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1'],
] as const)test(`${name} fences submit retries, status and cancel`,async()=>{
 const a=await f.venue();assert.equal((await submit(a)).status,202);await f.db.pool.query(sql,[a.installationId]);
 for(const r of [await submit(a),await read(a),await read(a,'cancel')])assert.equal(r.status,403,r.text);
});
test('origin revision replacement never delivers content using a newly approved origin',async()=>{
 const a=await f.venue();assert.equal((await submit(a)).status,202);
 await new RelayGrantStore(f.db.pool,f.grants).approve(a.session.token,a.session.csrfToken,{...a.approval,expectedRevision:1,managementOrigin:'https://new.example.test'});
 assert.equal((await read(a)).status,403);assert.equal((await submit(a)).status,403);
});
test('replay keys survive rotation; their loss fails closed without a second debit or content diagnostics',async()=>{
 const a=await f.venue(),body:any={...a.body,class:'email_change',code:'012345',codeExpiresAt:new Date(Date.now()+600000).toISOString()};delete body.token;
 assert.equal((await submit(a,body)).status,202);const n=await count('relay_reservations');
 const row=(await f.db.pool.query('SELECT * FROM relay_messages WHERE message_id=$1',[body.messageId])).rows[0];
 // A database copy has the message metadata and can guess six-digit codes; neither
 // a plain payload hash nor a public-metadata salt may validate those guesses.
 const storedDigest=row.binding.split(':').at(-1);
 assert.notEqual(storedDigest,createHash('sha256').update(JSON.stringify(body)).digest('hex'));
 assert.notEqual(storedDigest,createHash('sha256').update(JSON.stringify(['waitron-relay-v1',a.installationId,body.messageId,JSON.stringify(body)])).digest('hex'));
 assert.equal(JSON.stringify(row).includes(body.code),false);assert.equal(row.payload.toString('utf8').includes('"code":'+JSON.stringify(body.code)),false);
 const rotated={...f.relay,payloadKeys:{activeKeyId:'p2',keys:{...f.relay.payloadKeys.keys,p2:randomBytes(32).toString('hex')}},replayKeys:{activeKeyId:'r2',keys:{...f.relay.replayKeys.keys,r2:randomBytes(32).toString('hex')}}};
 try{
  await f.restart(rotated);assert.equal((await submit(a,body)).status,200);
  await f.restart({...rotated,replayKeys:{activeKeyId:'r2',keys:{r2:rotated.replayKeys.keys.r2}}});
  const r=await submit(a,body);assert.equal(r.status,503,r.text);assert.deepEqual(r.body,{error:'relay_unavailable'});
  assert.equal(await count('relay_reservations'),n);
 }finally{await f.restart();}
});

test('payload loss and swapped ciphertext fail closed; cancel still clears unavailable content',async()=>{
 const a=await f.venue(),b=await f.venue();assert.equal((await submit(a)).status,202);assert.equal((await submit(b)).status,202);
 const ar=(await f.db.pool.query('SELECT * FROM relay_messages WHERE message_id=$1',[a.body.messageId])).rows[0];
 await f.db.pool.query('UPDATE relay_messages SET payload=$2 WHERE message_id=$1',[b.body.messageId,ar.payload]);
 assert.equal((await read(b)).status,503);assert.equal((await read(b,'cancel')).body.state,'cancelled');
 try{
  await f.restart({...f.relay,payloadKeys:{activeKeyId:'p2',keys:{p2:randomBytes(32).toString('hex')}}});
  const r=await submit(a);assert.equal(r.status,503);assert.deepEqual(r.body,{error:'relay_unavailable'});
  assert.equal((await read(a)).status,503);assert.equal((await read(a,'cancel')).body.state,'cancelled');
 }finally{await f.restart();}
});
test('message insert failure rolls back its reservation and diagnostics never echo database errors',async()=>{
 const a=await f.venue(),n=await count('relay_reservations');
 await f.db.pool.query(`CREATE FUNCTION refuse_relay_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'secret-recipient@example.test'; END $$;
 CREATE TRIGGER refuse_relay_insert BEFORE INSERT ON relay_messages FOR EACH ROW EXECUTE FUNCTION refuse_relay_insert()`);
 try{const r=await submit(a);assert.equal(r.status,503);assert.equal(r.text.includes('secret-recipient'),false);assert.equal(await count('relay_reservations'),n);}
 finally{await f.db.pool.query('DROP TRIGGER refuse_relay_insert ON relay_messages; DROP FUNCTION refuse_relay_insert()');}
 assert.equal((await submit(a)).status,202);assert.equal(await count('relay_reservations'),n+1);
});
test('queued expiry clears payload and retry returns the expired tombstone with no new debit',async()=>{
 const a=await f.venue();assert.equal((await submit(a)).status,202);const n=await count('relay_reservations');
 await f.db.pool.query("UPDATE relay_messages SET expires_at=clock_timestamp()-interval '1 second' WHERE message_id=$1",[a.body.messageId]);
 const r=await read(a);assert.equal(r.body.state,'expired');assert.equal(r.body.statusRevision,2);
 assert.deepEqual((await submit(a)).body,r.body);assert.equal(await count('relay_reservations'),n);
 assert.equal((await f.db.pool.query('SELECT payload FROM relay_messages WHERE message_id=$1',[a.body.messageId])).rows[0].payload,null);
});
test('account contention across installations admits only the explicit fixture allowance',async()=>{
 const a=await f.venue(),b=await f.venue(a),other=await f.venue(),config={...f.relay,grants:{...f.grants,policy:{...f.grants.policy,version:'small-fixture',units:2}}};
 try{
  await f.restart(config);
  const results=await Promise.all(Array.from({length:6},(_,i)=>{const v=i%2?a:b;return submit(v,{...v.body,messageId:randomUUID()});}));
  assert.deepEqual(results.map(r=>r.status).sort(),[202,202,429,429,429,429]);
  assert.equal((await submit(other)).status,202);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations WHERE account_id=$1',[a.accountId])).rows[0].count,'2');
 }finally{await f.restart();}
});
test('authority revoked while admission waits is rechecked under transaction locks',async()=>{
 const a=await f.venue(),block=await f.db.pool.connect();await block.query('BEGIN');
 await block.query('UPDATE relay_grants SET enabled=false WHERE id=$1',[a.grant.id]);
 const pending=submit(a);
 try{await new Promise(r=>setTimeout(r,50));await block.query('COMMIT');assert.equal((await pending).status,403);}
 finally{await block.query('ROLLBACK');block.release();}
 assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations WHERE installation_id=$1',[a.installationId])).rows[0].count,'0');
});
test('a lease expiring behind a grant lock is refused without charging allowance',async()=>{
 const a=await f.venue(),block=await f.db.pool.connect();await block.query('BEGIN');await block.query('SELECT * FROM relay_grants WHERE id=$1 FOR UPDATE',[a.grant.id]);
 const lease=f.issuer.issue({...a.leaseInput,expiresAt:Date.now()+150});
 const pending=f.request('submit',a.proof('email-submit',a.body,{lease:JSON.stringify(lease)}));
 try{await new Promise(r=>setTimeout(r,200));await block.query('COMMIT');assert.equal((await pending).status,401);}
 finally{await block.query('ROLLBACK');block.release();}
 assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations WHERE installation_id=$1',[a.installationId])).rows[0].count,'0');
});

test('a new process replays the committed message using the original key rings and charges nothing',async()=>{
 const a=await f.venue(),first=await submit(a);assert.equal(first.status,202);const n=await count('relay_reservations');
 const child=spawn(process.execPath,['test/fixtures/relay-process.ts'],{env:process.env,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
 const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 child.stdin.end(JSON.stringify({schema:f.db.schema,issuerKey:f.issuerKey,config:f.relay,origin:f.origin,envelope:a.proof('email-submit')}));
 assert.equal(await exit,0,stderr);assert.deepEqual(JSON.parse(stdout),{created:false,status:first.body});assert.equal(await count('relay_reservations'),n);
});
test('installation owner revocation and admission finish without reversing their shared lock order',async()=>{
 const a=await f.venue(),lifecycle=new InstallationStore(f.db.secondPool,f.issuer,f.origin);
 const [admitted,revoked]=await Promise.all([submit(a),lifecycle.revokeWithSession(a.session.token,a.session.csrfToken,a.installationId)]);
 assert.ok([202,403].includes(admitted.status),admitted.text);assert.ok(revoked.revokedAt);
 assert.equal((await submit(a)).status,403);assert.equal((await read(a)).status,403);
});

test('disconnecting before reading the committed response replays the one durable admission',async()=>{
 const a=await f.venue(),n=await count('relay_reservations');
 await f.discardReply(a.proof('email-submit'));
 const retry=await submit(a);assert.equal(retry.status,200,retry.text);assert.equal(retry.body.state,'queued');
 assert.equal(await count('relay_reservations'),n+1);
});
test('forged installation IDs spend ingress but cannot exhaust the victim installation limit',async()=>{
 const a=await f.venue(),b=await f.venue();
 for(let i=0;i<31;i++)assert.equal((await f.request('submit',a.proof('email-submit',a.body,{installationId:b.installationId}))).status,401);
 assert.equal((await submit(b)).status,202);
});

test('cancel waiting behind a started handoff cannot overwrite its sending state',async()=>{
 const a=await f.venue();assert.equal((await submit(a)).status,202);
 const handoff=await f.db.pool.connect();await handoff.query('BEGIN');
 await handoff.query("UPDATE relay_messages SET state='sending',status_revision=2 WHERE message_id=$1",[a.body.messageId]);
 const pending=read(a,'cancel');
 try{
  // Wait for cancellation's UPDATE to be blocked by the handoff transaction.
  let blocked=false;
  for(let i=0;i<100;i++){
   const r=await f.db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'UPDATE relay_messages SET state=%'",[f.db.schema]);
   if(r.rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(blocked,true,'cancellation must reach the row lock before handoff commits');
  await handoff.query('COMMIT');const r=await pending;assert.equal(r.status,200,r.text);assert.equal(r.body.state,'sending');assert.equal(r.body.statusRevision,2);
  assert.ok((await f.db.pool.query('SELECT payload FROM relay_messages WHERE message_id=$1',[a.body.messageId])).rows[0].payload);
 }finally{await handoff.query('ROLLBACK');handoff.release();await pending;}
});

test('signed relay routes remain HTTP APIs when the account portal is served alongside them',async()=>{
 const a=await f.venue();
 try{
  await f.restart(f.relay,true);const r=await submit(a);assert.equal(r.status,202,r.text);assert.equal((await read(a)).body.state,'queued');
  await f.restart(null,true);const disabled=await submit(a);assert.equal(disabled.status,404);assert.deepEqual(disabled.body,{error:'not_found'});
 }finally{await f.restart();}
});

test('a clock-ahead invitation is admitted but its queue deadline never exceeds 24 Cloud hours',async()=>{
 const a=await f.venue(),cloudNow=Date.now(),issuedAt=cloudNow+3000,body={...a.body,class:'invitation',expiresAt:new Date(issuedAt+86400000).toISOString()};
 const r=await f.request('submit',a.proof('email-submit',body,{issuedAt}));
 assert.equal(r.status,202,r.text);assert.ok(Date.parse(r.body.expiresAt)<=Date.now()+86400000);assert.ok(Date.parse(r.body.expiresAt)<Date.parse(body.expiresAt));
 const beyond={...body,messageId:randomUUID(),expiresAt:new Date(issuedAt+86400001).toISOString()};
 assert.equal((await f.request('submit',a.proof('email-submit',beyond,{issuedAt}))).status,400);
});
test('the signed request age is rechecked after a grant lock wait even when its lease stays live',async()=>{
 const a=await f.venue(),block=await f.db.pool.connect();await block.query('BEGIN');await block.query('SELECT * FROM relay_grants WHERE id=$1 FOR UPDATE',[a.grant.id]);
 const issuedAt=Date.now()-55000,pending=f.request('submit',a.proof('email-submit',a.body,{issuedAt}));
 try{
  let blocked=false;for(let i=0;i<200;i++){const r=await f.db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM relay_grants WHERE id=%'",[f.db.schema]);if(r.rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(blocked,true,'proof must authenticate before the grant wait');
  await new Promise(r=>setTimeout(r,Math.max(0,issuedAt+60050-Date.now())));await block.query('COMMIT');
  const r=await pending;assert.equal(r.status,401,r.text);
 }finally{await block.query('ROLLBACK');block.release();await pending;}
 assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations WHERE installation_id=$1',[a.installationId])).rows[0].count,'0');
});
test('relay and lifecycle requests share the same authenticated machine request budget',async()=>{
 const a=await f.venue();
 for(let i=0;i<30;i++){
  const r=await f.request('/api/installations/configuration',a.proof('configuration',{}));assert.equal(r.status,200,r.text);
 }
 const r=await submit(a);assert.equal(r.status,429,r.text);assert.deepEqual(r.body,{error:'rate_limited'});
});
test('omitting the local grant configuration keeps admission disabled even when routes are injected',async()=>{
 const a=await f.venue();
 try{await f.restart({...f.relay,grants:undefined});const r=await submit(a);assert.equal(r.status,403,r.text);assert.deepEqual(r.body,{error:'relay_disabled'});}
 finally{await f.restart();}
});
