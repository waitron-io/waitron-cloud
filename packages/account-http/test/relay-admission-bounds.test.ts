import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {relayFixture} from './fixtures/relay.ts';

test('recipient HTTP refusal is fixed 429 with retry hint and no extra debit',async()=>{
 const f=await relayFixture();try{
  f.relay.bounds.recipientLimit=2;await f.restart();
  const a=await f.venue(),b=await f.venue(),c=await f.venue();
  for(const v of [a,b])assert.equal((await f.request('submit',v.proof('email-submit'))).status,202);
  const denied=await f.request('submit',c.proof('email-submit'));assert.equal(denied.status,429);assert.deepEqual(denied.body,{error:'rate_limited'});assert.equal(denied.headers['retry-after'],'60');
  const retry=await f.request('submit',a.proof('email-submit'));assert.equal(retry.status,200);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'2');
 }finally{await f.close();}
});
test('grant HTTP refusal leaves conflicts and forged installations independent',async()=>{
 const f=await relayFixture();try{
  f.relay.bounds.grantLimit=3;await f.restart();const v=await f.venue(),other=await f.venue();
  for(let i=0;i<3;i++){
   const body={...v.body,messageId:i===0?v.body.messageId:randomUUID(),recipient:`recipient${i}@example.test`};
   assert.equal((await f.request('submit',v.proof('email-submit',body))).status,202);
  }
  assert.equal((await f.request('submit',v.proof('email-submit',{...v.body,messageId:randomUUID()}))).status,429);
  assert.equal((await f.request('submit',v.proof('email-submit',{...v.body,recipient:'changed@example.test'}))).status,409);
  assert.equal((await f.request('submit',other.proof('email-submit',{...other.body,grantId:v.grant.id}))).status,403);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'3');
 }finally{await f.close();}
});
for(const kind of ['recipient','grant','bytes','storage'])test(`${kind} race across independent HTTP processes respects the shared cap`,async()=>{
 const f=await relayFixture();try{
  if(kind==='recipient')f.relay.bounds.recipientLimit=2;
  if(kind==='grant')f.relay.bounds.grantLimit=3;
  if(kind==='storage')f.relay.bounds.maxCounterRows=5;
  const venues=await Promise.all(Array.from({length:6},()=>f.venue()));
  const bodies=venues.map((v,i)=>({...v.body,recipient:kind==='recipient'?'shared@example.test':`person${i}@example.test`}));
  if(kind==='grant')for(let i=1;i<6;i++)bodies[i]={...bodies[0]!,messageId:randomUUID(),recipient:`person${i}@example.test`};
  const length=Buffer.byteLength(JSON.stringify({...bodies[0],managementOrigin:'https://manage.example.test'}))+28;
  if(kind==='bytes'){
   for(const body of bodies)assert.equal(Buffer.byteLength(JSON.stringify({...body,managementOrigin:'https://manage.example.test'}))+28,length);
   f.relay.bounds.queuedPayloadBytes=2*length;
  }
  await f.restart();const second=await f.second();
  const lock=await f.db.pool.connect();await lock.query('BEGIN');await lock.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('relay-admission-bounds'))");
  const pending=bodies.map((body,i)=>(i%2?second.request:f.request)('submit',venues[kind==='grant'?0:i]!.proof('email-submit',body)));
  let reached=false;
  try{
   for(let i=0;i<200;i++){
    if((await f.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%relay-admission-bounds%'",[f.db.schema])).rowCount){reached=true;break;}await new Promise(r=>setTimeout(r,10));
   }
   assert.ok(reached);await lock.query('COMMIT');
   const results=await Promise.all(pending),expected=kind==='grant'?3:2;
   assert.equal(results.filter(r=>r.status===202).length,expected);assert.equal(results.filter(r=>r.status===429).length,6-expected);
   assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,String(expected));
   assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,String(expected));
   const sum=(await f.db.pool.query('SELECT sum(octet_length(payload))::text AS bytes FROM relay_messages')).rows[0].bytes;
   assert.equal((await f.db.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,sum);
   if(kind==='bytes')assert.equal(sum,String(2*length));
   if(kind==='storage')assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_bounds_counters')).rows[0].count,'4');
   await second.close();
  }finally{await lock.query('ROLLBACK');lock.release();await Promise.allSettled(pending);}
 }finally{await f.close();}
});
test('different active recipient keys share one budget, including HTTP restart and lost replies',async()=>{
 const f=await relayFixture();try{
  f.relay.bounds.recipientLimit=2;await f.restart();
  const second=await f.second({...f.relay,bounds:{...f.relay.bounds,recipientKeys:{activeKeyId:'b2',keys:{...f.relay.bounds.recipientKeys.keys,b2:'a'.repeat(64)}}}});
  const a=await f.venue(),b=await f.venue(),c=await f.venue();await f.discardReply(a.proof('email-submit'));
  assert.equal((await second.request('submit',b.proof('email-submit'))).status,202);assert.equal((await second.request('submit',c.proof('email-submit'))).status,429);
  const before=(await f.db.pool.query('SELECT * FROM relay_bounds_counters ORDER BY kind,subject')).rows;
  await f.restart();assert.equal((await f.request('submit',a.proof('email-submit'))).status,200);
  assert.deepEqual((await f.db.pool.query('SELECT * FROM relay_bounds_counters ORDER BY kind,subject')).rows,before);
  await second.close();
 }finally{await f.close();}
});
for(const timing of ['insert','commit'])test(`${timing} database failure leaves no partial budget, bytes, message or debit`,async()=>{
 const f=await relayFixture();try{
  const v=await f.venue();
  await f.db.pool.query("CREATE FUNCTION fail_admission_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private fixture failure'; END; $$");
  await f.db.pool.query(timing==='insert'?"CREATE TRIGGER reject_insert BEFORE INSERT ON relay_messages FOR EACH ROW EXECUTE FUNCTION fail_admission_fixture()":"CREATE CONSTRAINT TRIGGER reject_commit AFTER INSERT ON relay_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_admission_fixture()");
  const result=await f.request('submit',v.proof('email-submit'));assert.equal(result.status,503);assert.ok(!result.text.includes('private fixture'));
  for(const table of ['relay_reservations','relay_messages','relay_bounds_windows','relay_bounds_counters'])assert.equal((await f.db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
  assert.equal((await f.db.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,'0');
 }finally{await f.close();}
});
test('exact byte cap admits, one-byte growth refuses and cancellation releases capacity',async()=>{
 const f=await relayFixture();try{
  const v=await f.venue(),body=v.body;
  const length=Buffer.byteLength(JSON.stringify({...body,managementOrigin:'https://manage.example.test'}))+28;
  f.relay.bounds.queuedPayloadBytes=length;await f.restart();assert.equal((await f.request('submit',v.proof('email-submit'))).status,202);
  await assert.rejects(f.db.pool.query('UPDATE relay_messages SET payload=payload||$1 WHERE message_id=$2',[Buffer.alloc(1),body.messageId]),/relay_bytes_exhausted/);
  assert.equal((await f.db.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,String(length));
  assert.equal((await f.request('cancel',v.proof('email-cancel',{version:1,messageId:body.messageId}))).status,200);
  assert.equal((await f.db.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,'0');
  assert.equal((await f.request('submit',v.proof('email-submit',{...body,messageId:randomUUID()}))).status,202);
 }finally{await f.close();}
});
