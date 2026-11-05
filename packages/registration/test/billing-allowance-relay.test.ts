import {databaseClock} from './fixtures/database-clock.ts';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {SMTPServer} from 'smtp-server';
import {AllowanceConfigStore,BillingStore,RelayMessages,RelayWorker,RelayControl} from '../src/index.ts';
import type {AllowanceVersion} from '../src/billing-allowance-rules.ts';
import {RelayGrantStore} from '../src/relay-grants.ts';
import {transaction} from '../src/transaction.ts';
import {fixture} from './fixtures/relay-worker.ts';
import {createAccountApp} from '../../account-http/src/app.ts';

const mode='test-venue-levels',options={mode:'test',calendar:'UTC'} as const;
const api={RelayGrantStore,RelayMessages,RelayWorker} as any;
const version:AllowanceVersion={revision:1,effectiveFrom:'2020-01-01',limits:{
 registered:{transactional_email:'2',sms:'0',address_lookup:'2',content_translation:'0',rota_solver:'0'},
 connected:{transactional_email:'4',sms:'0',address_lookup:'4',content_translation:'6',rota_solver:'4'},
 hosted:{transactional_email:'6',sms:'0',address_lookup:'6',content_translation:'8',rota_solver:'6'},
},unpaidTrial:{content_translation:'2',rota_solver:'1'}};
// Missing admission must allow the third message or leave no retained monthly debit.
async function setup(t:any,{allowances=options as unknown,configured=true,policyUnits=100,planMode=mode}={}){
 if(allowances===null)allowances=undefined;
 const f=await fixture();t.after(()=>f.close());const store=new BillingStore(f.pool);
 const grants={...f.config.grants,policy:{...f.config.grants.policy,units:policyUnits}};
 const relay={...f.relay,grants},config={...f.config,grants};
 const messages:RelayMessages=new api.RelayMessages(f.pool,f.issuer,'http://localhost',relay,undefined,planMode,allowances);
 if(configured)await new AllowanceConfigStore(f.pool).publish(version);
 async function venue(accountId?:string){
  const v=await f.venue();
  if(accountId){
   await f.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[accountId,v.organisation]);
   await f.pool.query('UPDATE relay_grants SET account_id=$1 WHERE installation_id=$2',[accountId,v.installation]);
  }
  const row=(await f.pool.query('SELECT v.* FROM venues v JOIN installations i ON i.venue_id=v.id WHERE i.id=$1',[v.installation])).rows[0];
  await store.execute({organisationId:row.organisation_id,legalBusinessId:row.legal_business_id},{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'ensure_business'});
  const body=()=>({version:1,messageId:randomUUID(),grantId:v.grant.id,grantRevision:1,class:'password_reset',recipient:`${randomUUID()}@example.test`,displayName:'Ana',locale:'es-ES',timeZone:'Europe/Madrid',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')});
  return {...v,account:accountId??v.account,venueId:row.id,body,submit:(value=body())=>messages.execute('email-submit',v.proof('email-submit',value)),status:(messageId:string,action:'email-status'|'email-cancel'='email-status')=>messages.execute(action,v.proof(action,{version:1,messageId}))};
 }
 const rows=async()=>(await f.pool.query('SELECT *,month::text FROM billing_allowance_reservations ORDER BY id')).rows;
 const total=async()=>BigInt((await f.pool.query("SELECT coalesce(sum(units),0)::text AS used FROM billing_allowance_reservations WHERE state IN ('held','spent')")).rows[0].used);
 return {...f,relay,config,messages,venue,rows,total,worker:(port=f.config.smtpPort)=>new api.RelayWorker(f.pool,{...config,smtpPort:port},planMode,allowances)};
}
async function smtp(t:any,result:'accepted'|'refused'='accepted'){
 const captured:string[]=[],server=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],logger:false,onData(stream,_session,done){let raw='';stream.on('data',b=>raw+=b);stream.on('end',()=>{captured.push(raw);if(result==='refused'){const error=Object.assign(new Error('synthetic refusal'),{responseCode:550});done(error);}else done();});}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(resolve)));
 const address=server.server.address();assert.ok(address&&typeof address!=='string');return {captured,port:address.port};
}

test('monthly relay keeps account debit through handoff across two venues',async t=>{
 const f=await setup(t),a=await f.venue(),b=await f.venue(a.account),s=await smtp(t),body=a.body();
 assert.equal((await a.submit(body)).created,true);assert.equal((await b.submit()).created,true);
 await assert.rejects(a.submit(),{code:'allowance_exhausted'});assert.equal(await f.total(),2n);
 assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'2');
 const saved=await f.rows();assert.deepEqual(saved.map(r=>[r.account_id,r.service,r.units,r.state]),[[a.account,'transactional_email','1','spent'],[a.account,'transactional_email','1','spent']]);
 assert.equal((await a.submit(body)).created,false);assert.equal(await f.worker(s.port).runOnce(),true);assert.equal(await f.worker(s.port).runOnce(),true);
 assert.deepEqual([s.captured.length,(await f.row(body.messageId)).state],[2,'accepted']);
 assert.equal((await a.status(body.messageId)).status.state,'accepted');assert.deepEqual(await f.rows(),saved);
});

test('concurrent relay last-unit admissions commit exactly one message and debit',async t=>{
 const f=await setup(t),v=await f.venue();await v.submit();
 const results=await Promise.allSettled([v.submit(),v.submit()]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.code),['allowance_exhausted']);
 assert.equal(await f.total(),2n);assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'2');
});

for(const table of ['billing_allowance_reservations','relay_reservations','relay_messages'])test('relay monthly debit and queue roll back together on '+table+' refusal',async t=>{
 const f=await setup(t),v=await f.venue();
 await f.pool.query("CREATE FUNCTION refuse_relay_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-admission-refusal'; END $$");
 await f.pool.query(`CREATE TRIGGER refuse_relay_admission BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION refuse_relay_admission()`);
 await assert.rejects(v.submit(),/synthetic-admission-refusal/);
 for(const name of ['billing_allowance_reservations','relay_reservations','relay_messages'])assert.equal((await f.pool.query('SELECT count(*) FROM '+name)).rows[0].count,'0',name);
});

test('relay missing monthly configuration refuses without a queue row',async t=>{
 const f=await setup(t,{configured:false}),v=await f.venue();
 await assert.rejects(v.submit(),{code:'allowance_unavailable'});assert.deepEqual(await f.rows(),[]);assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'0');
});

test('relay legacy policy remains an independent admission ceiling',async t=>{
 const f=await setup(t,{policyUnits:1}),v=await f.venue();await v.submit();
 await assert.rejects(v.submit(),{code:'allowance_exhausted'});assert.equal(await f.total(),1n);
 assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'1');
});

for(const ending of ['cancelled','expired','refused','uncertain'] as const)test('relay '+ending+' retains spent monthly allowance',async t=>{
 const f=await setup(t),v=await f.venue(),body=v.body();await v.submit(body);const saved=await f.rows();assert.equal(saved.length,1);assert.equal(saved[0].state,'spent');
 if(ending==='cancelled')await v.status(body.messageId,'email-cancel');
 else if(ending==='expired'){await f.pool.query("UPDATE relay_messages SET expires_at=clock_timestamp()-interval '1 second' WHERE message_id=$1",[body.messageId]);await v.status(body.messageId);}
 else if(ending==='uncertain'){await f.pool.query("UPDATE relay_messages SET state='sending',claim_id=$2,lease_until=clock_timestamp()-interval '1 second',attempts=1 WHERE message_id=$1",[body.messageId,randomUUID()]);assert.equal(await f.worker().runOnce(),true);}
 else {const s=await smtp(t,'refused');assert.equal(await f.worker(s.port).runOnce(),true);assert.equal(s.captured.length,1);}
 assert.equal((await f.row(body.messageId)).state,ending==='refused'?'failed':ending);assert.deepEqual(await f.rows(),saved);assert.equal(await f.total(),1n);
});

for(const mode of ['existing','test-free-paid','test-venue-levels'])test('absent relay allowances retain '+mode+' behavior without monthly rows',async t=>{
 // Explicit undefined bypasses the helper default.
 const f=await setup(t,{allowances:null,planMode:mode}),v=await f.venue();
 await v.submit();assert.deepEqual(await f.rows(),[]);
});

test('monthly relay refuses a grant that expires during its allowance bucket wait',async t=>{
 const f=await setup(t),v=await f.venue(),holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const grant=(await f.pool.query("UPDATE relay_grants SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1 RETURNING expires_at",[v.grant.id])).rows[0];
  const month=(await f.pool.query("SELECT date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date::text AS month")).rows[0].month;
  await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',['allowance-account:'+v.account+':transactional_email:'+month]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let done=false;
  const grants=new api.RelayGrantStore(f.pool,f.config.grants,mode,options);
  const publicKey=(await f.pool.query('SELECT public_key FROM installations WHERE id=$1',[v.installation])).rows[0].public_key;
  pending=transaction(f.pool,c=>grants.reserve(c,{installationId:v.installation,publicKey},{grantId:v.grant.id,grantRevision:1,messageId:randomUUID(),binding:'fixed-binding'}));
  // Authentication uses the stored current key, independently of the grant selector.
  void pending.then(()=>{done=true;},()=>{done=true;});
  let waiting=false;const until=performance.now()+5000;
  while(!done&&performance.now()<until){waiting=!!(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount;if(waiting)break;await setImmediate();}
  assert.equal(waiting,true,'admission must reach its monthly account lock');
  while(Date.now()<=grant.expires_at.getTime())await new Promise(resolve=>setTimeout(resolve,10));
  await holder.query('COMMIT');await assert.rejects(pending,{code:'grant_unavailable'});assert.deepEqual(await f.rows(),[]);
  assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'0');
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();}
});

test('a retained held monthly reservation cannot create replacement relay work',async t=>{
 const f=await setup(t),v=await f.venue(),body=v.body();
 const binding=(await import('../src/relay-payload.ts')).RelayKeys;
 const hash=new binding(f.relay.replayKeys).fingerprint(f.relay.replayKeys.activeKeyId,v.installation,body.messageId,JSON.stringify(body));
 await transaction(f.pool,async c=>{await (await import('../src/billing-allowances.ts')).reserveAllowance(c,{accountId:v.account,venueId:v.venueId,installationId:v.installation,operationId:body.messageId,service:'transactional_email',binding:hash,units:1n});});
 const saved=await f.rows();await assert.rejects(v.submit(body),{code:'allowance_conflict'});assert.deepEqual(await f.rows(),saved);
 assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'0');
});

test('relay replays an older monthly debit without selecting the current month',async t=>{
 const f=await setup(t),v=await f.venue(),body=v.body();
 await f.messages.authenticate('email-submit',v.proof('email-submit',body));
 await new RelayMessages(f.pool,f.issuer,'http://localhost',f.relay,undefined,mode).execute('email-submit',v.proof('email-submit',body));
 const saved=(await f.pool.query('SELECT v.organisation_id,v.legal_business_id,r.binding FROM venues v JOIN installations i ON i.venue_id=v.id JOIN relay_reservations r ON r.installation_id=i.id WHERE r.message_id=$1',[body.messageId])).rows[0];
 await f.pool.query(`INSERT INTO billing_allowance_reservations(id,account_id,organisation_id,legal_business_id,venue_id,installation_id,service,operation_id,binding,units,month,revision,state)
  VALUES($1,$2,$3,$4,$5,$6,'transactional_email',$7,$8,1,'2020-01-01',1,'spent')`,[randomUUID(),v.account,saved.organisation_id,saved.legal_business_id,v.venueId,v.installation,body.messageId,saved.binding]);
 const before=await f.rows();assert.equal((await v.submit(body)).created,false);await v.status(body.messageId,'email-cancel');assert.deepEqual(await f.rows(),before);
 assert.equal(before[0].month,'2020-01-01');assert.equal(await f.total(),1n);
});

for(const revoked of ['owner','account','credential','grant','origin','installation','lease','operator'] as const)test('relay monthly admission preserves '+revoked+' refusal with no debit',async t=>{
 const f=await setup(t),v=await f.venue();
 if(revoked==='owner')await f.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[v.account]);
 if(revoked==='account')await f.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[v.account]);
 if(revoked==='credential')await f.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[v.account]);
 if(revoked==='grant')await f.pool.query('UPDATE relay_grants SET enabled=false WHERE id=$1',[v.grant.id]);
 if(revoked==='origin')await f.pool.query("UPDATE relay_grants SET created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second',origin_verified_until=clock_timestamp()-interval '1 second' WHERE id=$1",[v.grant.id]);
 if(revoked==='installation')await f.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installation]);
 if(revoked==='lease')await f.pool.query("UPDATE installations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[v.installation]);
 if(revoked==='operator')await new RelayControl(f.pool).stop();
 await assert.rejects(v.submit());assert.deepEqual(await f.rows(),[]);assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'0');
});

test('account HTTP passes relay allowances and returns the retained exhaustion refusal',async t=>{
 const f=await setup(t),v=await f.venue();
 const app=createAccountApp({pool:f.pool,outbox:{} as any,config:{portalOrigin:'http://localhost',production:false,rateKey:'ab'.repeat(32),trustedProxyIps:[]},relay:f.relay,leaseIssuer:f.issuer,planMode:mode,allowances:options} as any);
 const post=(body:unknown)=>app.request('http://localhost/v1/installations/email/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v.proof('email-submit',body))},{incoming:{socket:{remoteAddress:'203.0.113.1'}}} as any);
 assert.equal((await post(v.body())).status,202);assert.equal((await post(v.body())).status,202);
 const response=await post(v.body());assert.deepEqual([response.status,await response.json()],[429,{error:'allowance_exhausted'}]);
 assert.equal(await f.total(),2n);assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'2');
});

for(const mismatch of ['missing','account','binding','held','released'] as const)test('relay replay and SMTP handoff refuse '+mismatch+' original allowance binding',async t=>{
 const f=await setup(t),v=await f.venue(),other=await f.venue(),body=v.body(),s=await smtp(t);
 await new RelayMessages(f.pool,f.issuer,'http://localhost',f.relay,undefined,mode).execute('email-submit',v.proof('email-submit',body));
 if(mismatch!=='missing'){
  const original=(await f.pool.query('SELECT v.organisation_id,v.legal_business_id,r.binding FROM venues v JOIN installations i ON i.venue_id=v.id JOIN relay_reservations r ON r.installation_id=i.id WHERE r.message_id=$1',[body.messageId])).rows[0];
  await f.pool.query(`INSERT INTO billing_allowance_reservations(id,account_id,organisation_id,legal_business_id,venue_id,installation_id,service,operation_id,binding,units,month,revision,state)
   VALUES($1,$2,$3,$4,$5,$6,'transactional_email',$7,$8,1,'2020-01-01',1,$9)`,[randomUUID(),mismatch==='account'?other.account:v.account,original.organisation_id,original.legal_business_id,v.venueId,v.installation,body.messageId,mismatch==='binding'?'foreign-binding':original.binding,mismatch==='held'||mismatch==='released'?mismatch:'spent']);
 }
 const saved=await f.rows(),code=mismatch==='missing'?'allowance_unavailable':'allowance_conflict';
 await assert.rejects(v.submit(body),{code});await assert.rejects(v.status(body.messageId),{code});await assert.rejects(v.status(body.messageId,'email-cancel'),{code});
 await assert.rejects(f.worker(s.port).runOnce(),{code});assert.equal(s.captured.length,0);assert.equal((await f.row(body.messageId)).state,'queued');assert.deepEqual(await f.rows(),saved);
});

test('relay monthly authority waits for its billing parent before taking venue locks',async t=>{
 const f=await setup(t),v=await f.venue(),holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const business=(await f.pool.query('SELECT legal_business_id FROM venues WHERE id=$1',[v.venueId])).rows[0].legal_business_id;
  await holder.query('BEGIN');await holder.query('SELECT legal_business_id FROM billing_businesses WHERE legal_business_id=$1 FOR UPDATE',[business]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let done=false;
  pending=v.submit();void pending.then(()=>{done=true;},()=>{done=true;});
  let waiting=false;const until=performance.now()+5000;
  while(!done&&performance.now()<until){waiting=!!(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount;if(waiting)break;await setImmediate();}
  assert.equal(waiting,true,'monthly admission must wait for the current payment-method parent');
  await assert.doesNotReject(holder.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE NOWAIT',[v.venueId]),'the business wait must leave the venue available to its current writer');
  await holder.query('COMMIT');await pending;assert.equal(await f.total(),1n);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();}
});

test('grant approval never spends a monthly relay unit even without published allowances',async t=>{
 const f=await setup(t,{configured:false}),v=await f.venue();
 const grants=new api.RelayGrantStore(f.pool,f.config.grants,mode,options);
 const grant=await grants.approve(v.session.token,v.session.csrfToken,{installationId:v.installation,expectedRevision:1,consent:true,consentVersion:'local-v1',managementOrigin:'https://manage.example.test',expiresAt:new Date(Date.now()+1800000).toISOString()});
 assert.equal(grant.revision,2);assert.deepEqual(await f.rows(),[]);assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'0');
});

test('monthly relay uses the legacy policy period after its new bucket wait',async t=>{
 const f=await setup(t),v=await f.venue(),holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const month=(await f.pool.query("SELECT date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date::text AS month")).rows[0].month;
  await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',['allowance-account:'+v.account+':transactional_email:'+month]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,publicKey=(await f.pool.query('SELECT public_key FROM installations WHERE id=$1',[v.installation])).rows[0].public_key;
  const grants=new api.RelayGrantStore(f.pool,{...f.config.grants,policy:{...f.config.grants.policy,periodSeconds:1}},mode,options);let done=false;
  pending=transaction(f.pool,c=>grants.reserve(c,{installationId:v.installation,publicKey},{grantId:v.grant.id,grantRevision:1,messageId:randomUUID(),binding:'fixed-binding'}));void pending.then(()=>{done=true;},()=>{done=true;});
  let waiting=false;const until=performance.now()+5000;
  while(!done&&performance.now()<until){waiting=!!(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount;if(waiting)break;await setImmediate();}
  assert.equal(waiting,true);await new Promise(resolve=>setTimeout(resolve,1100));
  const released=(await f.pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
  await holder.query('COMMIT');await pending;
  const saved=(await f.pool.query('SELECT period_start,period_end,created_at FROM relay_reservations')).rows[0];
  assert.ok(saved.period_start<=saved.created_at&&saved.created_at<saved.period_end,'legacy debit must use the period containing actual admission');assert.ok(saved.period_end>released,'legacy period must be chosen after the monthly bucket wait');assert.equal(await f.total(),1n);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();}
});

for(const setupPause of [0,600])test('monthly relay replay rechecks grant expiry after its retained debit lock wait'+(setupPause?' after a setup pause':''),async t=>{
 const f=await setup(t),v=await f.venue(),body=v.body();await v.submit(body);const saved=await f.rows(),holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  let time=(await f.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
  const clock=databaseClock(f.pool,()=>time);
  const grant=(await f.pool.query('UPDATE relay_grants SET expires_at=$2 WHERE id=$1 RETURNING expires_at',[v.grant.id,new Date(time+300)])).rows[0];
  if(setupPause)await new Promise(resolve=>setTimeout(resolve,setupPause));
  const publicKey=(await f.pool.query('SELECT public_key FROM installations WHERE id=$1',[v.installation])).rows[0].public_key;
  await holder.query('BEGIN');await holder.query('SELECT id FROM billing_allowance_reservations WHERE id=$1 FOR UPDATE',[saved[0].id]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,grants=new api.RelayGrantStore(clock,f.config.grants,mode,options);let done=false;
  pending=transaction(clock,c=>grants.reserve(c,{installationId:v.installation,publicKey},{grantId:v.grant.id,grantRevision:1,messageId:body.messageId,binding:saved[0].binding}));void pending.then(()=>{done=true;},()=>{done=true;});
  let waiting=false;const until=performance.now()+5000;
  while(!done&&performance.now()<until){waiting=!!(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount;if(waiting)break;await setImmediate();}
  assert.equal(waiting,true);time=grant.expires_at.getTime();
  await holder.query('COMMIT');await assert.rejects(pending,{code:'grant_unavailable'});assert.deepEqual(await f.rows(),saved);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();}
});

for(const monthly of [false,true])test('relay admission records its checked period despite a delayed counter read '+(monthly?'with monthly allowance':'without monthly allowance'),async t=>{
 const f=await setup(t),v=await f.venue(),publicKey=(await f.pool.query('SELECT public_key FROM installations WHERE id=$1',[v.installation])).rows[0].public_key;
 const grants=new RelayGrantStore(f.pool,{...f.config.grants,policy:{...f.config.grants.policy,periodSeconds:1}},mode,monthly?options:undefined);
 let checkedAt:Date|undefined;
 await transaction(f.pool,async client=>{
  const delayed=new Proxy(client,{get(target,key){
   if(key==='query')return async(sql:string,values?:unknown[])=>{
    const result=await target.query(sql,values);
    if(sql==='SELECT clock_timestamp() AS now')checkedAt=result.rows[0].now;
    if(sql==='SELECT count(*) FROM relay_reservations WHERE account_id=$1 AND period_start=$2')await target.query('SELECT pg_sleep(1.1)');
    return result;
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  await grants.reserve(delayed,{installationId:v.installation,publicKey},{grantId:v.grant.id,grantRevision:1,messageId:randomUUID(),binding:'delayed-counter'});
 });
 const saved=(await f.pool.query('SELECT period_start,period_end,created_at FROM relay_reservations')).rows[0];
 assert.ok(saved.period_start<=saved.created_at&&saved.created_at<saved.period_end,'recorded admission must belong to the checked legacy period');
 assert.deepEqual(saved.created_at,checkedAt,'reservation must retain the database time used for admission checks');
 assert.ok((await f.pool.query('SELECT clock_timestamp() AS now')).rows[0].now>=saved.period_end,'the counter delay must cross the checked period boundary');
 assert.equal(await f.total(),monthly?1n:0n);
});
