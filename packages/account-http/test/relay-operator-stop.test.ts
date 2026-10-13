import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setTimeout as pace} from 'node:timers/promises';
import {promisify} from 'node:util';
import {test} from 'node:test';
import {Pool} from 'pg';
import {RelayControl} from '../../registration/src/relay-control.ts';
import {relayFixture} from './fixtures/relay.ts';

type Fixture=Awaited<ReturnType<typeof relayFixture>>;
type Venue=Awaited<ReturnType<Fixture['venue']>>;
type Api=Awaited<ReturnType<Fixture['second']>>;
const execute=promisify(execFile);
const lookup=(messageId:string)=>({version:1,messageId});
const submit=(api:Api,v:Venue,body=v.body)=>api.request('submit',v.proof('email-submit',body));
const read=(api:Api,v:Venue,action='status',messageId=v.body.messageId)=>api.request(action,v.proof('email-'+action,lookup(messageId)));

async function command(f:Fixture,mode:string){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${f.db.schema}`);
 const result=await execute(process.execPath,['../registration/src/relay-control-cli.ts',mode],{env:{...process.env,DATABASE_URL:url.href},timeout:15000});
 assert.equal(result.stderr,'');return JSON.parse(result.stdout);
}
async function snapshot(f:Fixture){
 const result:Record<string,unknown>={};
 for(const table of ['relay_messages','relay_reservations','relay_policies','relay_account_policies','relay_bounds_policy','relay_bounds_windows','relay_bounds_counters','relay_queue_bytes']){
  result[table]=(await f.db.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 }
 return result;
}
async function wait(f:Fixture,name:string,query:string,blocker:number){
 const end=Date.now()+2500;
 while(Date.now()<end){
  const rows=(await f.db.secondPool.query("SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[name,query])).rows;
  const row=rows.find(r=>r.blockers.includes(blocker));if(row)return row.pid as number;
  await pace(10);
 }
 const observed=(await f.db.secondPool.query('SELECT query,wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1',[name])).rows;
 assert.fail(`expected ${name} to wait on ${query} blocked by ${blocker}; observed ${JSON.stringify(observed)}`);
}
async function blocker(f:Fixture){
 const client=await f.db.pool.connect();await client.query('BEGIN');
 const pid=Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
 return {client,pid,async close(){await client.query('ROLLBACK');client.release();}};
}
async function live(f:Fixture,suffix:string){return f.second(f.relay,`${f.db.schema}_${suffix}`);}

test('two live APIs refuse new mail without relay spend and resume without restart',async()=>{
 const f=await relayFixture();try{
  const a=await f.venue(),b=await f.venue(),apis=await Promise.all([live(f,'one'),live(f,'two')]);
  assert.equal((await submit(apis[0]!,a)).status,202);
  assert.deepEqual(await command(f,'--stop'),{stopped:true});const before=await snapshot(f);
  for(const api of apis){const response=await submit(api,b);assert.equal(response.status,403,response.text);assert.deepEqual(response.body,{error:'relay_disabled'});}
  assert.deepEqual(await snapshot(f),before);
  assert.deepEqual(await command(f,'--resume'),{stopped:false});
  for(const api of apis)assert.equal((await submit(api,b,{...b.body,messageId:randomUUID()})).status,202);
  await command(f,'--stop');await Promise.all(apis.map(api=>api.close()));
  const restarted=await Promise.all([live(f,'restart_one'),live(f,'restart_two')]);const saved=await snapshot(f);
  for(const api of restarted)assert.equal((await submit(api,b,{...b.body,messageId:randomUUID()})).status,403);
  assert.deepEqual(await snapshot(f),saved);
  const unconfigured=await f.second(null,`${f.db.schema}_off`);
  for(const mode of ['--stop','--resume']){await command(f,mode);assert.equal((await submit(unconfigured,b)).status,404);}
 }finally{await f.close();}
});

test('stopped new submit refuses before a locked account authority or allowance',async()=>{
 const f=await relayFixture();try{
  const v=await f.venue(),name=`${f.db.schema}_authority`,api=await f.second(f.relay,name);
  await new RelayControl(f.db.pool).stop();
  for(const kind of ['authority','allowance']){
   const block=await blocker(f);let pending:ReturnType<typeof submit>|undefined;
   try{
    if(kind==='authority')await block.client.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[v.accountId]);
    else await block.client.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-account:'||$1,0))",[v.accountId]);
    pending=submit(api,v);let response:Awaited<ReturnType<typeof submit>>|undefined;pending.then(r=>{response=r;});
    const end=Date.now()+2500;
    while(!response&&Date.now()<end){
     const rows=(await f.db.secondPool.query("SELECT pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[name])).rows;
     assert.equal(rows.some(r=>r.blockers.includes(block.pid)),false,'stopped submit must not reach reservation locks');await pace(10);
    }
    assert.ok(response,'stopped submit must answer while authority stays locked');assert.equal(response.status,403);assert.deepEqual(response.body,{error:'relay_disabled'});
   }finally{await block.close();await pending;}
  }
  assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'0');
 }finally{await f.close();}
});

test('stopped status cancel and exact replay retain queued sending and terminal state',async()=>{
 const f=await relayFixture();try{
  const v=await f.venue(),api=await live(f,'replay');await f.discardReply(v.proof('email-submit'));
  const sending=await f.venue(),expired=await f.venue();for(const a of [sending,expired])assert.equal((await submit(api,a)).status,202);
  await f.db.pool.query("UPDATE relay_messages SET state='sending',status_revision=2,claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds' WHERE message_id=$1",[sending.body.messageId]);
  await f.db.pool.query("UPDATE relay_messages SET expires_at=clock_timestamp()-interval '1 second' WHERE message_id=$1",[expired.body.messageId]);
  await command(f,'--stop');const n=(await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count;
  const replay=await submit(api,v);assert.equal(replay.status,200);assert.equal(replay.body.state,'queued');assert.deepEqual((await read(api,v)).body,replay.body);
  assert.equal((await submit(api,v,{...v.body,recipient:'different@example.test'})).status,409);
  const beforeSending=await snapshot(f);assert.equal((await read(api,sending,'cancel')).body.state,'sending');assert.equal((await submit(api,sending)).body.state,'sending');assert.deepEqual(await snapshot(f),beforeSending);
  const bytes=Number((await f.db.pool.query('SELECT bytes FROM relay_queue_bytes')).rows[0].bytes),length=Number((await f.db.pool.query('SELECT octet_length(payload) AS bytes FROM relay_messages WHERE message_id=$1',[expired.body.messageId])).rows[0].bytes);
  const expiry=await read(api,expired);assert.equal(expiry.body.state,'expired');assert.equal(expiry.body.statusRevision,2);
  assert.deepEqual((await submit(api,expired)).body,expiry.body);assert.deepEqual((await read(api,expired,'cancel')).body,expiry.body);
  assert.equal(Number((await f.db.pool.query('SELECT bytes FROM relay_queue_bytes')).rows[0].bytes),bytes-length);
  const cancelled=await read(api,v,'cancel');assert.equal(cancelled.body.state,'cancelled');assert.deepEqual((await submit(api,v)).body,cancelled.body);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,n);
  await f.db.pool.query('DELETE FROM relay_control');
  for(const a of [v,sending]){const r=await submit(api,a);assert.equal(r.status,503);assert.deepEqual(r.body,{error:'relay_unavailable'});}
  const r=await submit(api,sending,{...sending.body,messageId:randomUUID()});assert.equal(r.status,503);assert.deepEqual(r.body,{error:'relay_unavailable'});
  assert.equal((await read(api,sending)).body.state,'sending');assert.equal((await read(api,sending,'cancel')).body.state,'sending');assert.deepEqual((await read(api,v)).body,cancelled.body);
 }finally{await f.close();}
});

for(const [name,sql,status] of [
 ['revoked grant','UPDATE relay_grants SET enabled=false WHERE installation_id=$1',403],
 ['stale revision','UPDATE relay_grants SET revision=revision+1 WHERE installation_id=$1',403],
 ['disabled account','UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=(SELECT account_id FROM relay_grants WHERE installation_id=$1)',403],
 ['removed owner','DELETE FROM organisation_memberships WHERE organisation_id=(SELECT organisation_id FROM relay_grants WHERE installation_id=$1)',403],
 ['removed owner privilege','UPDATE organisation_memberships SET is_owner=false WHERE organisation_id=(SELECT organisation_id FROM relay_grants WHERE installation_id=$1)',403],
 ['revoked installation','UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',403],
 ['expired installation lease',"UPDATE installations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",403],
 ['replaced key','UPDATE installations SET public_key=$2 WHERE id=$1',401],
] as const)test(`stopped replay keeps ${name} refusal without new spend`,async()=>{
 const f=await relayFixture();try{
  const v=await f.venue(),api=await live(f,'revoked');assert.equal((await submit(api,v)).status,202);await command(f,'--stop');
  const params=sql.includes('$2')?[v.installationId,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]:[v.installationId];
  await f.db.pool.query(sql,params);const saved=await snapshot(f);
  assert.equal((await submit(api,v)).status,status);for(const action of ['status','cancel'])assert.equal((await read(api,v,action)).status,status);
  assert.deepEqual(await snapshot(f),saved);
 }finally{await f.close();}
});

test('stopped replay preserves foreign missing stale-lease and forged-proof refusals',async()=>{
 const f=await relayFixture();try{
  const v=await f.venue(),other=await f.venue(),api=await live(f,'proofs');assert.equal((await submit(api,v)).status,202);await command(f,'--stop');const before=await snapshot(f);
  for(const action of ['status','cancel']){
   const foreign=await read(api,other,action,v.body.messageId),missing=await read(api,other,action,randomUUID());assert.equal(foreign.status,403);assert.deepEqual(foreign.body,missing.body);
  }
  const expired=f.issuer.issue({...v.leaseInput,issuedAt:Date.now()-3600000,expiresAt:Date.now()-1});
  for(const proof of [v.proof('email-submit',v.body,{lease:JSON.stringify(expired)}),v.proof('email-submit',v.body,{installationId:other.installationId}),v.proof('email-submit',v.body,{origin:'https://wrong.example.test'}),v.proof('email-submit',v.body,{issuedAt:Date.now()-120000})])assert.equal((await api.request('submit',proof)).status,401);
  assert.equal((await submit(api,v,{...v.body,grantId:other.grant.id})).status,403);assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});

test('stop first blocks admission SHARE and refuses after stop commits',async()=>{
 const f=await relayFixture();try{
  const v=await f.venue(),name=`${f.db.schema}_stop_first`,api=await f.second(f.relay,name),block=await blocker(f);let pending:ReturnType<typeof submit>|undefined;
  try{
   await block.client.query('UPDATE relay_control SET stopped=true');const before=await snapshot(f);pending=submit(api,v);
   await wait(f,name,'SELECT stopped FROM relay_control%FOR SHARE',block.pid);await block.client.query('COMMIT');
   const r=await pending;assert.equal(r.status,403);assert.deepEqual(r.body,{error:'relay_disabled'});assert.deepEqual(await snapshot(f),before);
  }finally{await block.close();await pending;}
 }finally{await f.close();}
});

test('admission control SHARE precedes the message identity lock',async()=>{
 const f=await relayFixture();let operator:Pool|undefined;try{
  const v=await f.venue(),name=`${f.db.schema}_identity`,api=await f.second(f.relay,name),operatorName=`${f.db.schema}_operator`;
  operator=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${f.db.schema} -c statement_timeout=10000`,application_name:operatorName});
  const block=await blocker(f);let admission:ReturnType<typeof submit>|undefined,stop:ReturnType<RelayControl['stop']>|undefined;
  try{
   await block.client.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-message:'||$1||':'||$2,0))",[v.installationId,v.body.messageId]);
   admission=submit(api,v);const pid=await wait(f,name,'%relay-message:%',block.pid);
   stop=new RelayControl(operator).stop();await wait(f,operatorName,'SELECT stopped FROM relay_control%FOR UPDATE',pid);
   await block.client.query('COMMIT');assert.equal((await admission).status,202);assert.deepEqual(await stop,{stopped:true});
  }finally{await block.close();await Promise.allSettled([admission,stop].filter(Boolean));}
 }finally{await operator?.end();await f.close();}
});

for(const kind of ['wrong payload','missing payload','missing replay'])test(`stopped replay keeps ${kind} key refusal and cancellation authority`,async()=>{
 const f=await relayFixture();try{
  const v=await f.venue();await f.discardReply(v.proof('email-submit'));
  assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_messages WHERE message_id=$1',[v.body.messageId])).rows[0].count,'1','lost reply must follow a committed admission');
  await command(f,'--stop');
  const config={...f.relay,...(kind==='missing replay'?{replayKeys:{activeKeyId:'r2',keys:{r2:'a'.repeat(64)}}}:{payloadKeys:kind==='wrong payload'?{activeKeyId:'p1',keys:{p1:'a'.repeat(64)}}:{activeKeyId:'p2',keys:{p2:'a'.repeat(64)}}})};
  const api=await f.second(config,`${f.db.schema}_keys`),before=await snapshot(f);
  const r=await submit(api,v);assert.equal(r.status,503);assert.deepEqual(r.body,{error:'relay_unavailable'});
  const status=await read(api,v);assert.equal(status.status,kind==='missing replay'?200:503);assert.deepEqual(await snapshot(f),before);
  const cancelled=await read(api,v,'cancel');assert.equal(cancelled.status,200);assert.equal(cancelled.body.state,'cancelled');assert.equal((await f.db.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,'0');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
 }finally{await f.close();}
});

for(const abort of [false,true])test(`admission SHARE holds stop through ${abort?'rollback':'commit'} including a queued writer and reader`,async()=>{
 const f=await relayFixture();let operator:Pool|undefined;try{
  const v=await f.venue(),name=`${f.db.schema}_admit_first`,api=await f.second(f.relay,name),otherName=`${f.db.schema}_reader`,other=await f.second(f.relay,otherName);
  const operatorName=`${f.db.schema}_operator`;operator=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${f.db.schema} -c statement_timeout=10000`,application_name:operatorName});
  const block=await blocker(f);let admission:ReturnType<typeof submit>|undefined,stop:ReturnType<RelayControl['stop']>|undefined,reader:ReturnType<typeof submit>|undefined;
  const events:string[]=[];
  try{
   await block.client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('relay-admission-bounds'))");
   admission=submit(api,v);const admissionPid=await wait(f,name,'%relay-admission-bounds%',block.pid);
   stop=new RelayControl(operator).stop();stop.then(()=>events.push('stop'));
   const stopPid=await wait(f,operatorName,'SELECT stopped FROM relay_control%FOR UPDATE',admissionPid);
   const readerBody={...v.body,messageId:randomUUID()};reader=submit(other,v,readerBody);
   const readerPid=await wait(f,otherName,"%relay-account:%",admissionPid);
   assert.ok((await f.db.secondPool.query('SELECT $1=ANY(pg_blocking_pids($2)) AS blocked',[admissionPid,stopPid])).rows[0].blocked);
   assert.equal(events.length,0,'stop must stay blocked until admission finishes');
   if(abort){
    await f.db.secondPool.query('SELECT pg_cancel_backend($1)',[admissionPid]);
    await wait(f,otherName,'%relay-admission-bounds%',block.pid);
    await wait(f,operatorName,'SELECT stopped FROM relay_control%FOR UPDATE',readerPid);
   }
   else{
    const held=(await f.db.secondPool.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND relation=$2::regclass AND mode='RowShareLock' AND granted",[admissionPid,`${f.db.schema}.relay_control`])).rowCount;
    assert.equal(held,1,'admission keeps its control lock while working');
   }
   await block.client.query('COMMIT');const result=await admission;
   assert.equal(result.status,abort?503:202,result.text);events.push('admission');await stop;
   const after=await reader;assert.equal(after.status,202,after.text);
   assert.equal((await f.db.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,abort?'1':'2');
   assert.equal((await submit(api,v,{...v.body,messageId:randomUUID()})).status,403);assert.equal((await submit(other,v,{...v.body,messageId:randomUUID()})).status,403);
   if(abort)for(const table of ['relay_messages','relay_reservations'])assert.equal((await f.db.pool.query(`SELECT count(*) FROM ${table} WHERE message_id=$1`,[v.body.messageId])).rows[0].count,'0');
   assert.equal((await f.db.pool.query('SELECT bytes::text FROM relay_queue_bytes')).rows[0].bytes,(await f.db.pool.query('SELECT sum(octet_length(payload))::text AS bytes FROM relay_messages')).rows[0].bytes);
  }finally{await block.close();await Promise.allSettled([admission,stop,reader].filter(Boolean));}
 }finally{await operator?.end();await f.close();}
});

test('failed admission commit rolls back spend and releases control for stop',async()=>{
 const f=await relayFixture();try{
  const v=await f.venue(),api=await live(f,'commit_fail');
  await f.db.pool.query("CREATE FUNCTION reject_relay_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private commit detail'; END $$; CREATE CONSTRAINT TRIGGER reject_relay_commit AFTER INSERT ON relay_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_relay_commit()");
  const before=await snapshot(f),r=await submit(api,v);assert.equal(r.status,503);assert.equal(r.text.includes('private commit detail'),false);assert.deepEqual(await snapshot(f),before);
  assert.deepEqual(await command(f,'--stop'),{stopped:true});assert.equal((await submit(api,v)).status,403);
 }finally{await f.close();}
});
