import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {migrate} from '../src/migrate.ts';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {SMTPServer,type SMTPServerOptions} from 'smtp-server';
import * as registration from '../src/index.ts';
import {fixture} from './fixtures/relay-worker.ts';
const Worker=(registration as any).RelayWorker;
async function setup(t:any){assert.equal(typeof Worker,'function','separate local relay worker must exist');const f=await fixture();t.after(()=>f.close());return f;}
async function smtp(t:any,options:SMTPServerOptions={}){
 const captured:string[]=[];
 const server=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],logger:false,onData(stream,_session,done){let raw='';stream.on('data',b=>raw+=b);stream.on('end',()=>{captured.push(raw);done();});},...options});
 server.on('error',()=>{});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise<void>(r=>server.close(r)));const a=server.server.address();assert.ok(a&&typeof a!=='string');return {port:a.port,captured,server};
}
function readable(raw:string){return raw.replace(/=\r\n/g,'').replace(/=3D/g,'=');}

test('default worker leaves admitted mail queued and has no SMTP capability',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();assert.equal(await new Worker(f.pool).runOnce(),false);assert.equal((await f.row(b.messageId)).state,'queued');
});
test('two workers deliver two accounts exactly once and retain one debit and tombstone each',async t=>{
 const f=await setup(t),s=await smtp(t),a=await f.venue(),b=await f.venue(),aa=await a.submit(),bb=await b.submit();
 const one=new Worker(f.pool,{...f.config,smtpPort:s.port}),two=new Worker(f.pool,{...f.config,smtpPort:s.port});
 await Promise.all([one.runOnce(),two.runOnce(),one.runOnce(),two.runOnce()]);
 assert.equal(s.captured.length,2);
 for(const body of [aa,bb]){const row=await f.row(body.messageId);assert.equal(row.state,'accepted');assert.equal(row.reason,null);assert.equal(row.payload,null);assert.equal(row.attempts,1);assert.equal(row.status_revision,3);assert.equal((await f.messages.execute('email-submit',(body===aa?a:b).proof('email-submit',body))).status.state,'accepted');}
 assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'2');
 const status=await one.status();assert.equal(status.counts.accepted,2);assert.equal(status.attempts,2);
 for(const secret of [aa.recipient,aa.token,aa.messageId,a.account,bb.recipient])assert.ok(!JSON.stringify(status).includes(secret));
});
test('all three templates use the verified origin, fixed sender and bounded structured fields',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),worker=new Worker(f.pool,{...f.config,smtpPort:s.port});
 for(const kind of ['invitation','password_reset','email_change']){
  const body=await v.submit({class:kind,locale:kind==='invitation'?'en':'es'});await worker.runOnce();const raw=readable(s.captured.at(-1)!);
  assert.match(raw,/From: Waitron <relay@example.test>/);assert.ok(raw.includes(body.recipient));
  if(kind==='email_change'){assert.ok(raw.includes('123456'));assert.ok(raw.includes('https://manage.example.test/'));}
  else {assert.ok(raw.includes('https://manage.example.test/manage/account?'));assert.ok(raw.includes(body.token));assert.ok(raw.includes(`purpose=${kind}`));}
  assert.ok(!raw.includes('Content-Type: text/html'));
 }
});
for(const [name,sql] of [
 ['revoked grant','UPDATE relay_grants SET enabled=false'],
 ['disabled account','UPDATE cloud_accounts SET disabled_at=clock_timestamp()'],
 ['owner removal','DELETE FROM organisation_memberships'],
 ['unverified account','UPDATE cloud_credentials SET email_verified_at=NULL'],
 ['revoked installation','UPDATE installations SET revoked_at=clock_timestamp()'],
 ['stale key',"UPDATE installations SET public_key='changed'"],
 ['stale grant revision','UPDATE relay_grants SET revision=revision+1'],
 ['expired lease',"UPDATE installations SET lease_expires_at=clock_timestamp()-interval '1 second'"],
 ['changed origin',"UPDATE relay_grants SET management_origin='https://changed.example.test',revision=revision+1"],
] as const)test(`${name} prevents handoff and clears terminal ciphertext`,async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit();await f.pool.query(sql);
 await new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();const row=await f.row(b.messageId);assert.equal(row.state,'cancelled');assert.equal(row.payload,null);assert.equal(s.captured.length,0);
});
test('revocation committed while handoff waits wins before SMTP',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit(),lock=await f.pool.connect();
 await lock.query('BEGIN');await lock.query('UPDATE relay_grants SET enabled=false WHERE id=$1',[v.grant.id]);
 const run=new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();void run.catch(()=>{});
 try{await delay(100);await lock.query('COMMIT');await run;}finally{await lock.query('ROLLBACK');lock.release();}
 assert.equal((await f.row(b.messageId)).state,'cancelled');assert.equal(s.captured.length,0);
});
test('cancel before handoff prevents delivery, cancel after handoff preserves acceptance',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();await v.cancel(b.messageId);
 let reached!:()=>void,finish!:()=>void;const data=new Promise<void>(r=>reached=r);
 const s=await smtp(t,{onData(stream,_session,done){stream.resume();stream.on('end',()=>{finish=()=>done();reached();});}});
 const worker=new Worker(f.pool,{...f.config,smtpPort:s.port});assert.equal(await worker.runOnce(),false);
 const c=await v.submit(),pending=worker.runOnce();await data;
 assert.equal((await v.cancel(c.messageId)).status.state,'sending');finish();await pending;assert.equal((await f.row(c.messageId)).state,'accepted');
});
test('expired queued work is cleared and never reaches SMTP',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit();await f.pool.query("UPDATE relay_messages SET expires_at=clock_timestamp()-interval '1 second'");
 await new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();assert.equal((await f.row(b.messageId)).state,'expired');assert.equal((await f.row(b.messageId)).payload,null);assert.equal(s.captured.length,0);
});
test('suppression is keyed, survives key rotation and refuses missing historical keys',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit();const worker=new Worker(f.pool,{...f.config,smtpPort:s.port});await worker.suppress(b.recipient);
 const stored=JSON.stringify((await f.pool.query('SELECT * FROM relay_suppressions')).rows);assert.ok(!stored.includes(b.recipient));
 const rotated={activeKeyId:'s2',keys:{...f.config.suppressionKeys.keys,s2:randomBytes(32).toString('hex')}};
 await new Worker(f.pool,{...f.config,smtpPort:s.port,suppressionKeys:rotated}).runOnce();assert.equal((await f.row(b.messageId)).reason,'refused');assert.equal(s.captured.length,0);
 const c=await v.submit();await assert.rejects(new Worker(f.pool,{...f.config,smtpPort:s.port,suppressionKeys:{activeKeyId:'s2',keys:{s2:rotated.keys.s2}}}).runOnce(),/relay_unavailable/);
 assert.equal((await f.row(c.messageId)).state,'queued');assert.equal(s.captured.length,0);
});
test('payload rotation keeps old mail readable and key loss clears unreadable mail without sending',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit();const key=randomBytes(32).toString('hex');
 await new Worker(f.pool,{...f.config,smtpPort:s.port,payloadKeys:{activeKeyId:'p2',keys:{...f.config.payloadKeys.keys,p2:key}}}).runOnce();assert.equal((await f.row(b.messageId)).state,'accepted');
 const c=await v.submit();await new Worker(f.pool,{...f.config,smtpPort:s.port,payloadKeys:{activeKeyId:'p2',keys:{p2:key}}}).runOnce();assert.equal((await f.row(c.messageId)).reason,'payload_unavailable');assert.equal((await f.row(c.messageId)).payload,null);assert.equal(s.captured.length,1);
});
for(const [responseCode,state] of [[451,'queued'],[550,'failed']] as const)test(`SMTP ${responseCode} is a confirmed refusal with fixed diagnostics`,async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();const s=await smtp(t,{onRcptTo(_a,_s,done){done(Object.assign(new Error(`private ${b.token} ${b.recipient}`),{responseCode}));}});
 await new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();const row=await f.row(b.messageId);assert.equal(row.state,state);assert.equal(row.reason,state==='failed'?'refused':null);assert.equal(row.attempts,1);assert.ok(!JSON.stringify(row).includes(b.token));
 if(state==='queued'){assert.ok(row.available_at.getTime()-Date.now()>25000);assert.ok(row.payload);}
 else assert.equal(row.payload,null);
});
test('post-DATA disconnect becomes uncertain and cannot be resent by another worker',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();let accepted=0;
 const s=await smtp(t,{onData(stream,_session,_done){stream.resume();stream.on('end',()=>{accepted++;for(const client of (s.server as any).connections)client.close();});}});
 const worker=new Worker(f.pool,{...f.config,smtpPort:s.port});await worker.runOnce();assert.equal(accepted,1);const row=await f.row(b.messageId);assert.equal(row.state,'uncertain');assert.equal(row.payload,null);assert.equal(await worker.runOnce(),false);
});
test('expired sending claims recover as uncertain while unstarted expired claims can retry',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit();
 await f.pool.query("UPDATE relay_messages SET state='sending',claim_id=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second',attempts=1,status_revision=2");
 const worker=new Worker(f.pool,{...f.config,smtpPort:s.port});await worker.runOnce();assert.equal((await f.row(b.messageId)).state,'uncertain');assert.equal(s.captured.length,0);
 const c=await v.submit();await f.pool.query("UPDATE relay_messages SET claim_id=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second' WHERE message_id=$1",[c.messageId]);await worker.runOnce();assert.equal((await f.row(c.messageId)).state,'accepted');assert.equal(s.captured.length,1);
});
test('database rejects inconsistent state/reason pairs',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();
 await assert.rejects(f.pool.query("UPDATE relay_messages SET reason='uncertain' WHERE message_id=$1",[b.messageId]),(e:any)=>e.code==='23514');
});

test('handoff rechecks grant expiry after a suppression lock wait',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit(),lock=await f.pool.connect();
 await f.pool.query("UPDATE relay_grants SET expires_at=clock_timestamp()+interval '250 milliseconds'");
 await lock.query('BEGIN');await lock.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-suppression',0))");
 const run=new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();void run.catch(()=>{});
 try{await delay(400);await lock.query('COMMIT');await run;}finally{await lock.query('ROLLBACK');lock.release();}
 assert.equal((await f.row(b.messageId)).state,'cancelled');assert.equal(s.captured.length,0);
});
test('eight confirmed temporary failures exhaust attempts with bounded backoff',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit({class:'invitation',expiresAt:new Date(Date.now()+7200000).toISOString()});
 const s=await smtp(t,{onRcptTo(_a,_s,done){done(Object.assign(new Error('temporary'),{responseCode:451}));}}),worker=new Worker(f.pool,{...f.config,smtpPort:s.port});
 for(let attempt=1;attempt<=8;attempt++){
  await f.pool.query("UPDATE relay_messages SET available_at=clock_timestamp() WHERE message_id=$1",[b.messageId]);await worker.runOnce();const row=await f.row(b.messageId);assert.equal(row.attempts,attempt);
  if(attempt<8){const wait=(row.available_at.getTime()-Date.now())/1000;assert.ok(wait>Math.min(900,30*2**(attempt-1))-2);assert.ok(wait<=900);assert.equal(row.state,'queued');}
  else {assert.equal(row.state,'failed');assert.equal(row.payload,null);}
 }
 assert.equal(await worker.runOnce(),false);
});
test('a retry whose delay passes expiry ends without another send',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit({expiresAt:new Date(Date.now()+20000).toISOString()});
 const s=await smtp(t,{onRcptTo(_a,_s,done){done(Object.assign(new Error('temporary'),{responseCode:451}));}});
 await new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();assert.equal((await f.row(b.messageId)).state,'expired');assert.equal((await f.row(b.messageId)).payload,null);
});
test('refused TCP connection can retry while a worker timeout is uncertain and closes the socket',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();const closed=createServer();await new Promise<void>(r=>closed.listen(0,'127.0.0.1',r));const a=closed.address();assert.ok(a&&typeof a!=='string');await new Promise<void>(r=>closed.close(()=>r()));
 await new Worker(f.pool,{...f.config,smtpPort:a.port}).runOnce();assert.equal((await f.row(b.messageId)).state,'queued');
 await f.pool.query("UPDATE relay_messages SET available_at=clock_timestamp()");
 let connections=0;const sockets=new Set<any>();const stalled=createServer(socket=>{connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.resume();});
 await new Promise<void>(r=>stalled.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise<void>(r=>stalled.close(()=>r()));});
 const address=stalled.address();assert.ok(address&&typeof address!=='string');
 await new Worker(f.pool,{...f.config,smtpPort:address.port,sendTimeoutMs:80}).runOnce();await delay(50);
 assert.equal((await f.row(b.messageId)).state,'uncertain');assert.equal(connections,1);assert.equal(sockets.size,0);
});
test('global claim capacity limits parallel workers to four SMTP handoffs',async t=>{
 const f=await setup(t),v=await f.venue();for(let i=0;i<6;i++)await v.submit();
 let reached!:()=>void,exhausted!:()=>void,idle=0;const four=new Promise<void>(r=>reached=r),competitors=new Promise<void>(r=>exhausted=r),finishes:(()=>void)[]=[];
 const s=await smtp(t,{onData(stream,_session,done){stream.resume();stream.on('end',()=>{finishes.push(()=>done());if(finishes.length===4)reached();});}});
 const pending=Promise.all(Array.from({length:8},()=>new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce().then((worked:boolean)=>{if(!worked&&++idle===4)exhausted();return worked;})));void pending.catch(()=>{});
 // Keep the four SMTP calls open until every competing claim has decided; a later claim may use a slot freed by a completed delivery.
 await four;const counts=await new Worker(f.pool).status();assert.equal(counts.counts.sending,4);assert.equal(counts.counts.queued,2);await competitors;for(const finish of finishes)finish();await pending;
 assert.equal(finishes.length,4);
});
test('process death after DATA cannot cause resend on restart',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();let received!:()=>void;const data=new Promise<void>(r=>received=r);let deliveries=0;
 const s=await smtp(t,{onData(stream,_session,_done){stream.resume();stream.on('end',()=>{deliveries++;received();});}});
 const child=spawn(process.execPath,['test/fixtures/relay-worker-process.ts'],{env:{...process.env,RELAY_TEST_SCHEMA:f.schema},stdio:['pipe','pipe','pipe']});
 let error='';child.stderr.on('data',b=>error+=b);const exit=new Promise<number|null>((r,j)=>{child.once('error',j);child.once('exit',r);});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});child.stdin.end(JSON.stringify({...f.config,smtpPort:s.port}));
 await Promise.race([data,exit.then(code=>{throw new Error(`worker exited ${code}: ${error}`);})]);
 assert.equal((await f.row(b.messageId)).state,'sending');child.kill('SIGKILL');await exit;
 await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second'");
 const worker=new Worker(f.pool,{...f.config,smtpPort:s.port});await worker.runOnce();assert.equal((await f.row(b.messageId)).state,'uncertain');assert.equal((await f.row(b.messageId)).payload,null);assert.equal(await worker.runOnce(),false);assert.equal(deliveries,1);
});

test('expired content is cleared even when an old suppression key is missing',async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit();await new Worker(f.pool,f.config).suppress(b.recipient);
 await f.pool.query("UPDATE relay_messages SET expires_at=clock_timestamp()-interval '1 second'");
 await new Worker(f.pool,{...f.config,smtpPort:s.port,suppressionKeys:{activeKeyId:'s2',keys:{s2:randomBytes(32).toString('hex')}}}).runOnce();
 assert.equal((await f.row(b.messageId)).state,'expired');assert.equal((await f.row(b.messageId)).payload,null);assert.equal(s.captured.length,0);
});

async function waitForSuppression(f:Awaited<ReturnType<typeof fixture>>){
 for(let i=0;i<100;i++){
  if((await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%relay-suppression%'",[f.schema])).rowCount)return;
  await delay(10);
 }
 assert.fail('worker did not reach suppression lock');
}
for(const stolen of [true,false])test(`handoff refuses a ${stolen?'stolen':'expired'} claim after a lock wait`,async t=>{
 const f=await setup(t),s=await smtp(t),v=await f.venue(),b=await v.submit(),lock=await f.pool.connect();
 await lock.query('BEGIN');await lock.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-suppression',0))");
 const run=new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();void run.catch(()=>{});
 try{
  await waitForSuppression(f);
  await f.pool.query(stolen?"UPDATE relay_messages SET claim_id=gen_random_uuid() WHERE message_id=$1":"UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second' WHERE message_id=$1",[b.messageId]);
  await lock.query('COMMIT');await run;
 }finally{await lock.query('ROLLBACK');lock.release();}
 assert.equal((await f.row(b.messageId)).state,'queued');assert.equal((await f.row(b.messageId)).attempts,0);assert.equal(s.captured.length,0);
});
for(const kind of ['relay-worker-capacity','relay-suppression'])test(`${kind} lock in another Cloud schema does not block this worker`,async t=>{
 const f=await setup(t),other=await fixture();t.after(()=>other.close());const s=await smtp(t),v=await other.venue(),b=await v.submit(),lock=await f.pool.connect();
 await lock.query('BEGIN');await lock.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':'||$1,0))",[kind]);
 const run=new Worker(other.pool,{...other.config,smtpPort:s.port}).runOnce();void run.catch(()=>{});
 let independent=false;
 try{independent=await Promise.race([run.then(()=>true),delay(1000).then(()=>false)]);await lock.query('COMMIT');await run;}
 finally{await lock.query('ROLLBACK');lock.release();}
 assert.equal(independent,true,'an unrelated Cloud schema blocked handoff');assert.equal((await other.row(b.messageId)).state,'accepted');
});
test('a late SMTP reply cannot overwrite a reaped claim',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();let reached!:()=>void,finish!:()=>void;const data=new Promise<void>(r=>reached=r);
 const s=await smtp(t,{onData(stream,_session,done){stream.resume();stream.on('end',()=>{finish=()=>done();reached();});}});
 const worker=new Worker(f.pool,{...f.config,smtpPort:s.port}),run=worker.runOnce();await data;
 await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second'");await new Worker(f.pool,f.config).runOnce();
 const recovered=await f.row(b.messageId);finish();await run;assert.equal(recovered.state,'uncertain');assert.equal((await f.row(b.messageId)).status_revision,recovered.status_revision);
});
test('a successful reply after its lease expires is uncertain even before reaping',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();let reached!:()=>void,finish!:()=>void;const data=new Promise<void>(r=>reached=r);
 const s=await smtp(t,{onData(stream,_session,done){stream.resume();stream.on('end',()=>{finish=()=>done();reached();});}});
 const run=new Worker(f.pool,{...f.config,smtpPort:s.port}).runOnce();await data;
 await f.pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second'");finish();await run;
 assert.equal((await f.row(b.messageId)).state,'uncertain');assert.equal((await f.row(b.messageId)).payload,null);
});
test('migration 033 preserves existing queue ciphertext without rewriting the table',async t=>{
 const f=await setup(t),v=await f.venue(),b=await v.submit();
 await f.pool.query('ALTER TABLE relay_messages DROP COLUMN claim_id CASCADE, DROP COLUMN lease_until CASCADE, DROP COLUMN attempts, DROP COLUMN available_at CASCADE, DROP CONSTRAINT relay_state_reason');
 await f.pool.query('DROP TABLE relay_suppressions');await f.pool.query("DELETE FROM schema_migrations WHERE name='033_relay_worker.sql'");
 const before=await f.row(b.messageId),node=(await f.pool.query("SELECT relfilenode FROM pg_class WHERE oid='relay_messages'::regclass")).rows[0].relfilenode;
 await migrate(f.pool);const after=await f.row(b.messageId);
 assert.deepEqual(after.payload,before.payload);assert.equal(after.state,'queued');assert.equal(after.binding,before.binding);
 assert.equal((await f.pool.query("SELECT relfilenode FROM pg_class WHERE oid='relay_messages'::regclass")).rows[0].relfilenode,node,'adding scheduling metadata rewrote the message table');
});
