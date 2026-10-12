import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import {fixture} from './fixtures/relay-worker.ts';
import {RelayMessages} from '../src/relay-messages.ts';

// Removing shared reservations permits the third account to spend the same recipient budget.
function bounds(change:Record<string,unknown>={}){
 return {version:'bounds-local-v1',epoch:'2026-01-01T00:00:00.000Z',windowSeconds:3600,recipientLimit:2,grantLimit:3,queuedPayloadBytes:1000000,maxCounterRows:64,recipientKeys:{activeKeyId:'b1',keys:{b1:randomBytes(32).toString('hex')}},...change};
}
async function configured(change:Record<string,unknown>={}){
 const f=await fixture();
 const config={...f.relay,bounds:bounds(change)};
 const messages=new RelayMessages(f.pool,f.issuer,'http://localhost',config);
 return {...f,workerConfig:f.config,config,messages};
}
async function submit(f:any,v:any,recipient:string,id=randomUUID(),kind='password_reset'){
 const body:any={version:1,messageId:id,grantId:v.grant.id,grantRevision:v.grant.revision,class:kind,recipient,displayName:'Ána',locale:'es-ES',timeZone:'Europe/Madrid',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')};
 if(kind==='email_change'){delete body.token;body.code='123456';body.codeExpiresAt=new Date(Date.now()+600000).toISOString();}
 return {body,result:await f.messages.execute('email-submit',v.proof('email-submit',body))};
}
test('recipient counts are shared across accounts and exact retries spend nothing',async()=>{
 const f=await configured();try{
  const a=await f.venue(),b=await f.venue(),c=await f.venue();
  const first=await submit(f,a,'ana@example.test');await submit(f,b,'ana@example.test');
  assert.equal((await f.messages.execute('email-submit',a.proof('email-submit',first.body))).created,false);
  await assert.rejects(submit(f,c,'ana@example.test'),{code:'rate_limited'});
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'2');
 }finally{await f.close();}
});
test('grant count combines recipients and classes without refund on cancellation',async()=>{
 const f=await configured();try{
  const v=await f.venue();const first=await submit(f,v,'one@example.test');
  await f.messages.execute('email-cancel',v.proof('email-cancel',{version:1,messageId:first.body.messageId}));
  await submit(f,v,'two@example.test',randomUUID(),'invitation');await submit(f,v,'three@example.test',randomUUID(),'email_change');
  await assert.rejects(submit(f,v,'four@example.test'),{code:'rate_limited'});
 }finally{await f.close();}
});
test('policy drift and missing live recipient keys fail closed',async()=>{
 const f=await configured();try{
  const v=await f.venue();await submit(f,v,'one@example.test');
  const changed=new RelayMessages(f.pool,f.issuer,'http://localhost',{...f.config,bounds:{...f.config.bounds,recipientLimit:100}});
  await assert.rejects(submit({...f,messages:changed},v,'two@example.test'),{code:'relay_unavailable'});
  const missing=new RelayMessages(f.pool,f.issuer,'http://localhost',{...f.config,bounds:{...f.config.bounds,recipientKeys:{activeKeyId:'b2',keys:{b2:randomBytes(32).toString('hex')}}}});
  await assert.rejects(submit({...f,messages:missing},v,'two@example.test'),{code:'relay_unavailable'});
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
 }finally{await f.close();}
});
test('invalid bounds configuration refuses omitted, unknown and malformed values',async()=>{
 const f=await fixture();try{
  for(const bad of [undefined,{},bounds({extra:true}),bounds({recipientLimit:0}),bounds({grantLimit:-1}),bounds({windowSeconds:1.5}),bounds({queuedPayloadBytes:Number.MAX_SAFE_INTEGER+1}),bounds({maxCounterRows:2}),bounds({epoch:'bad'}),bounds({recipientKeys:{activeKeyId:'missing',keys:{}}})]){
   assert.throws(()=>new RelayMessages(f.pool,f.issuer,'http://localhost',{...f.relay,bounds:bad} as any),{code:'relay_unavailable'});
  }
 }finally{await f.close();}
});
test('retained bytes track UTF-8 ciphertext, replacement, clearing, delete and truncate',async()=>{
 const f=await configured();try{
  const v=await f.venue(),first=await submit(f,v,'one@example.test');
  async function tally(){return (await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes;}
  const payload=(await f.row(first.body.messageId)).payload;
  assert.equal(await tally(),String(payload.length));
  const text=JSON.stringify({...first.body,managementOrigin:'https://manage.example.test'});
  assert.equal(payload.length,Buffer.byteLength(text)+28);assert.ok(Buffer.byteLength(text)>text.length);
  await f.pool.query('UPDATE relay_messages SET payload=$1 WHERE message_id=$2',[Buffer.alloc(19),first.body.messageId]);assert.equal(await tally(),'19');
  await f.messages.execute('email-cancel',v.proof('email-cancel',{version:1,messageId:first.body.messageId}));assert.equal(await tally(),'0');
  await f.messages.execute('email-cancel',v.proof('email-cancel',{version:1,messageId:first.body.messageId}));assert.equal(await tally(),'0');
  const second=await submit(f,v,'two@example.test');await f.pool.query('DELETE FROM relay_messages WHERE message_id=$1',[second.body.messageId]);assert.equal(await tally(),'0');
  await submit(f,v,'three@example.test');await f.pool.query('TRUNCATE relay_messages');assert.equal(await tally(),'0');
 }finally{await f.close();}
});
test('byte exhaustion rolls back counters, debit and queue together',async()=>{
 const f=await configured({queuedPayloadBytes:1});try{
  const v=await f.venue();await assert.rejects(submit(f,v,'ana@example.test'),{code:'rate_limited'});
  for(const table of ['relay_reservations','relay_messages','relay_bounds_windows','relay_bounds_counters'])assert.equal((await f.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
  assert.equal((await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,'0');
 }finally{await f.close();}
});
// A lock barrier proves the clock is sampled after waiting, not before admission.
async function waitForLock(f:any,fragment:string){
 for(let i=0;i<300;i++){
  if((await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[f.schema,'%'+fragment+'%'])).rowCount)return;
  await new Promise(r=>setTimeout(r,10));
 }
 assert.fail('admission did not reach '+fragment);
}
for(const wait of ['bounds','tally'])for(const deadline of ['grant','installation','message','lease','proof'])test(`${deadline} deadline passing during ${wait} wait rolls back admission`,async()=>{
 const f=await configured(),lock=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const v=await f.venue();
  // Bind the byte policy before taking its row; this request remains a baseline receipt.
  if(wait==='tally')await submit(f,v,'baseline@example.test');
  let time=Date.now();
  const body={version:1,messageId:randomUUID(),grantId:v.grant.id,grantRevision:1,class:'password_reset',recipient:'wait@example.test',displayName:'Ana',locale:'es',timeZone:'UTC',expiresAt:new Date(time+1800000).toISOString(),token:randomBytes(32).toString('base64url')};
  if(deadline==='grant')await f.pool.query("UPDATE relay_grants SET expires_at=clock_timestamp()+interval '700 milliseconds' WHERE id=$1",[v.grant.id]);
  if(deadline==='installation')await f.pool.query("UPDATE installations SET lease_expires_at=clock_timestamp()+interval '700 milliseconds' WHERE id=$1",[v.installation]);
  if(deadline==='message')body.expiresAt=new Date(time+700).toISOString();
  // Short signed deadlines keep existing proof-window assertions and values intact.
  const proof=v.proof('email-submit',body,deadline==='proof'?{issuedAt:time-59500}:deadline==='lease'?{leaseExpiresAt:time+700}:{});
  await lock.query('BEGIN');
  await lock.query(wait==='bounds'?"SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('relay-admission-bounds'))":'SELECT 1 FROM relay_queue_bytes WHERE singleton FOR UPDATE');
  pending=f.messages.execute('email-submit',proof);void pending.catch(()=>{});
  await waitForLock(f,wait==='bounds'?'relay-admission-bounds':'INSERT INTO relay_messages');
  await new Promise(r=>setTimeout(r,850));await lock.query('COMMIT');
  await assert.rejects(pending,(e:any)=>['grant_unavailable','invalid_message','invalid_proof'].includes(e.code));
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,wait==='tally'?'1':'0');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,wait==='tally'?'1':'0');
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending.catch(()=>{});await f.close();}
});
test('active key rotation uses the pinned key and changed material refuses live windows',async()=>{
 const f=await configured();try{
  const v=await f.venue();await submit(f,v,'ana@example.test');
  const recipientKeys={activeKeyId:'b2',keys:{...f.config.bounds.recipientKeys.keys,b2:randomBytes(32).toString('hex')}};
  const rotated=new RelayMessages(f.pool,f.issuer,'http://localhost',{...f.config,bounds:{...f.config.bounds,recipientKeys}});
  await submit({...f,messages:rotated},v,'ana@example.test');
  await assert.rejects(submit({...f,messages:rotated},v,'ana@example.test'),{code:'rate_limited'});
  const changed=new RelayMessages(f.pool,f.issuer,'http://localhost',{...f.config,bounds:{...f.config.bounds,recipientKeys:{...recipientKeys,keys:{...recipientKeys.keys,b1:randomBytes(32).toString('hex')}}}});
  await assert.rejects(submit({...f,messages:changed},v,'other@example.test'),{code:'relay_unavailable'});
  const windows=(await f.pool.query('SELECT key_id FROM relay_bounds_windows')).rows;assert.deepEqual(windows,[{key_id:'b1'}]);
  assert.ok(!JSON.stringify((await f.pool.query('SELECT * FROM relay_bounds_counters')).rows).includes('ana@example.test'));
 }finally{await f.close();}
});
test('counter storage cannot grow past its explicit ceiling across accounts',async()=>{
 const f=await configured({maxCounterRows:3});try{
  const a=await f.venue(),b=await f.venue();await submit(f,a,'one@example.test');
  await assert.rejects(submit(f,b,'two@example.test'),{code:'rate_limited'});
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_bounds_counters')).rows[0].count,'2');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
 }finally{await f.close();}
});
test('idle cleanup removes only expired budget rows, one bounded chunk at a time',async()=>{
 const f=await configured();try{
  const {HistoryCleanup,parseHistoryCleanupPolicy}=await import('../src/history-cleanup.ts');
  const v=await f.venue();await submit(f,v,'ana@example.test');
  await f.pool.query("INSERT INTO relay_bounds_windows(window_start,ends_at,key_id,key_verifier) VALUES('2020-01-01','2020-01-02','old','old')");
  await f.pool.query("INSERT INTO relay_bounds_counters(window_start,kind,subject,count) VALUES('2020-01-01','recipient','old',1),('2020-01-01','grant','old',1)");
  const policy=parseHistoryCleanupPolicy({cutoffs:{relayAdmissionCounters:new Date(Date.now()-1000).toISOString()},chunkSize:2});
  const cleanup=new HistoryCleanup(f.pool),dry=await cleanup.run(policy,{apply:false});
  assert.equal(dry.categories.relayAdmissionCounters?.eligible,3);assert.equal(dry.categories.relayAdmissionCounters?.deleted,0);
  assert.equal((await cleanup.run(policy,{apply:true})).categories.relayAdmissionCounters?.deleted,2);
  assert.equal((await cleanup.run(policy,{apply:true})).categories.relayAdmissionCounters?.deleted,1);
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_bounds_windows')).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_bounds_counters')).rows[0].count,'2');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
 }finally{await f.close();}
});
test('bounds client methods refuse autocommit and status exposes only aggregate data',async()=>{
 const f=await configured(),c=await f.pool.connect();try{
  const {RelayBounds}=await import('../src/relay-bounds.ts'),store=new RelayBounds(f.pool,f.config.bounds);
  for(const action of [()=>store.check(c),()=>store.reserve(c,{grantId:randomUUID(),recipient:'ana@example.test'}),()=>store.prune(c,10)])await assert.rejects(action(),{code:'relay_unavailable'});
  const v=await f.venue();await submit(f,v,'ana@example.test');
  const status=await store.status();assert.deepEqual(Object.keys(status).sort(),['counterRows','retainedPayloadBytes']);assert.equal(status.counterRows,3);assert.ok(Number(status.retainedPayloadBytes)>0);
  assert.ok(!JSON.stringify(status).includes('ana@example.test'));
 }finally{c.release();await f.close();}
});
test('counter rollover during byte wait rolls back the old window and fresh retry succeeds',async()=>{
 const f=await configured({windowSeconds:1,recipientLimit:100}),lock=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const v=await f.venue();await submit(f,v,'baseline@example.test');
  const body={version:1,messageId:randomUUID(),grantId:v.grant.id,grantRevision:1,class:'password_reset',recipient:'rollover@example.test',displayName:'Ana',locale:'es',timeZone:'UTC',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')};
  const before=(await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes;
  await lock.query('BEGIN');await lock.query('SELECT 1 FROM relay_queue_bytes FOR UPDATE');
  pending=f.messages.execute('email-submit',v.proof('email-submit',body));void pending.catch(()=>{});await waitForLock(f,'INSERT INTO relay_messages');
  await new Promise(r=>setTimeout(r,1100));await lock.query('COMMIT');await assert.rejects(pending,{code:'relay_unavailable'});
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');assert.equal((await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,before);
  assert.equal((await f.messages.execute('email-submit',v.proof('email-submit',body))).created,true);
 }finally{await lock.query('ROLLBACK');lock.release();await pending?.catch(()=>{});await f.close();}
});
test('expired windows allow recipient key retirement and retries after rollover reserve no new units',async()=>{
 const f=await configured({windowSeconds:1}),v=await f.venue();try{
  const first=await submit(f,v,'ana@example.test');await new Promise(r=>setTimeout(r,1100));
  const messages=new RelayMessages(f.pool,f.issuer,'http://localhost',{...f.config,bounds:{...f.config.bounds,recipientKeys:{activeKeyId:'b2',keys:{b2:randomBytes(32).toString('hex')}}}});
  assert.equal((await messages.execute('email-submit',v.proof('email-submit',first.body))).created,false);
  const second=await submit({...f,messages},v,'ana@example.test');assert.equal(second.result.created,true);
  assert.deepEqual((await f.pool.query('SELECT key_id FROM relay_bounds_windows')).rows,[{key_id:'b2'}]);
  assert.equal((await f.pool.query("SELECT count::text FROM relay_bounds_counters WHERE kind='recipient'")).rows[0].count,'1');
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'2');
 }finally{await f.close();}
});
test('every missing field and malformed bounds/key field is refused',async()=>{
 const f=await fixture();try{
  const valid=bounds();
  const malformed:unknown[]=[];
  for(const field of Object.keys(valid)){const copy:Record<string,unknown>={...valid};delete copy[field];malformed.push(copy);}
  for(const field of ['windowSeconds','recipientLimit','grantLimit','queuedPayloadBytes','maxCounterRows'])for(const value of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'1',null])malformed.push({...valid,[field]:value});
  for(const value of ['',null,'not version!'])malformed.push({...valid,version:value});
  for(const value of ['2026-01-01','2026-01-01T00:00:00Z',null])malformed.push({...valid,epoch:value});
  for(const recipientKeys of [null,{},[],{activeKeyId:'b1',keys:{b1:'a'.repeat(63)}},{activeKeyId:'bad id',keys:{'bad id':'a'.repeat(64)}},{activeKeyId:'b1',keys:{b1:'z'.repeat(64)}},{activeKeyId:'b1',keys:{b1:'a'.repeat(64)},extra:true}])malformed.push({...valid,recipientKeys});
  for(const bad of malformed)assert.throws(()=>new RelayMessages(f.pool,f.issuer,'http://localhost',{...f.relay,bounds:bad} as any),{code:'relay_unavailable'});
 }finally{await f.close();}
});
test('two workers, cancellation, reaping and new admissions keep exact bytes without deadlock',async()=>{
 const {SMTPServer}=await import('smtp-server');const {RelayWorker}=await import('../src/relay-worker.ts');
 const f=await configured();const completions:(()=>void)[]=[];let ready!:()=>void;const sending=new Promise<void>(r=>ready=r);
 const server=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],logger:false,onData(stream,_session,done){stream.resume();stream.on('end',()=>{completions.push(()=>done());if(completions.length===2)ready();});}});
 server.on('error',()=>{});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.server.address();assert.ok(address&&typeof address!=='string');
 let runs:Promise<boolean>[]=[];
 try{
  const a=await f.venue(),b=await f.venue(),c=await f.venue();const aa=await submit(f,a,'one@example.test'),bb=await submit(f,b,'two@example.test');
  const config={...f.workerConfig,smtpPort:address.port};runs=[new RelayWorker(f.pool,config).runOnce(),new RelayWorker(f.pool,config).runOnce()];for(const run of runs)void run.catch(()=>{});await sending;
  assert.equal((await f.row(aa.body.messageId)).state,'sending');const before=(await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes;
  const cancel=f.messages.execute('email-cancel',a.proof('email-cancel',{version:1,messageId:aa.body.messageId}));
  const admission=submit(f,c,'three@example.test');assert.equal((await cancel).status.state,'sending');const third=await admission;
  assert.ok(Number((await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes)>Number(before));
  await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second' WHERE message_id=$1",[bb.body.messageId]);
  await new RelayWorker(f.pool,config).runOnce();assert.equal((await f.row(bb.body.messageId)).state,'uncertain');
  for(const finish of completions)finish();await Promise.all(runs);
  assert.equal((await f.row(aa.body.messageId)).state,'accepted');assert.equal((await f.row(bb.body.messageId)).state,'uncertain');
  assert.equal((await f.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,String((await f.row(third.body.messageId)).payload.length));
 }finally{for(const finish of completions)finish();await Promise.allSettled(runs);await new Promise<void>(r=>server.close(r));await f.close();}
});
test('counter-row capacity serializes distinct subjects before either counter insertion',async()=>{
 const f=await fixture();try{
  const {RelayBounds}=await import('../src/relay-bounds.ts');const {transaction}=await import('../src/transaction.ts');
  const store=new RelayBounds(f.pool,bounds({maxCounterRows:3}));await transaction(f.pool,c=>store.check(c));
  // Delay the first write after the capacity read; without serialization all readers see room.
  await f.pool.query("CREATE FUNCTION delay_counter_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.1); RETURN NEW; END; $$; CREATE TRIGGER delay_counter BEFORE INSERT ON relay_bounds_counters FOR EACH ROW EXECUTE FUNCTION delay_counter_fixture()");
  const results=await Promise.allSettled(Array.from({length:6},(_,i)=>transaction(f.pool,c=>store.reserve(c,{grantId:randomUUID(),recipient:`person${i}@example.test`}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='rate_limited').length,5);
  assert.equal((await store.status()).counterRows,3);
 }finally{await f.close();}
});
