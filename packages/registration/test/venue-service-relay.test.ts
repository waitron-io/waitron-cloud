import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {SMTPServer} from 'smtp-server';
import {BillingStore,RelayMessages,RelayWorker,RelayControl,type BillingLevel} from '../src/index.ts';
import {RelayGrantStore} from '../src/relay-grants.ts';
import {createAccountApp} from '../../account-http/src/app.ts';
import {fixture} from './fixtures/relay-worker.ts';
import {transaction} from '../src/transaction.ts';
const mode='test-venue-levels';
const api={RelayGrantStore,RelayMessages,RelayWorker} as any;
async function setup(t:any){
 const f=await fixture();t.after(()=>f.close());const v=await f.venue();
 const row=(await f.pool.query('SELECT venue_id FROM installations WHERE id=$1',[v.installation])).rows[0];
 const scope={organisationId:v.organisation,legalBusinessId:(await f.pool.query('SELECT legal_business_id FROM venues WHERE id=$1',[row.venue_id])).rows[0].legal_business_id};
 const billing=new BillingStore(f.pool),event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
 await billing.execute(scope,event(),{type:'ensure_business'});
 const set=async(level:BillingLevel)=>{const old=await billing.venue(scope,row.venue_id);await billing.transition(scope,event(),{type:'set_venue',venueId:row.venue_id,expectedRevision:old.revision,value:{level,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});};
 const messages:RelayMessages=new api.RelayMessages(f.pool,f.issuer,'http://localhost',f.relay,undefined,mode);
 const grants:RelayGrantStore=new api.RelayGrantStore(f.pool,f.config.grants,mode);
 const input=()=>({installationId:v.installation,expectedRevision:1,consent:true as const,consentVersion:'local-v1',managementOrigin:'https://manage.example.test',expiresAt:new Date(Date.now()+1800000).toISOString()});
 return {...f,v,venueId:row.venue_id,set,messages,grants,input};
}
async function smtp(t:any){
 const captured:string[]=[],server=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],logger:false,onData(stream,_session,done){let raw='';stream.on('data',b=>raw+=b);stream.on('end',()=>{captured.push(raw);done();});}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(resolve)));
 const address=server.server.address();assert.ok(address&&typeof address!=='string');return {captured,port:address.port};
}
for(const level of ['registered','connected','hosted'] as const)test(`venue relay stays basic at ${level} with one grant reservation and SMTP handoff`,async t=>{
 const f=await setup(t),s=await smtp(t);await f.set(level);
 const before=(await f.pool.query('SELECT * FROM relay_grants')).rows;await f.set(level==='registered'?'hosted':'registered');await f.set(level);
 assert.deepEqual((await f.pool.query('SELECT * FROM relay_grants')).rows,before,'billing transitions cannot grant mail authority');
 const grant=await f.grants.approve(f.v.session.token,f.v.session.csrfToken,f.input());assert.equal(grant.revision,2);
 const body={version:1,messageId:randomUUID(),grantId:grant.id,grantRevision:grant.revision,class:'password_reset',recipient:`${randomUUID()}@example.test`,displayName:'Ana',locale:'es-ES',timeZone:'Europe/Madrid',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')},envelope=f.v.proof('email-submit',body);
 assert.equal((await f.messages.execute('email-submit',envelope)).created,true);
 assert.equal((await f.messages.execute('email-submit',envelope)).created,false);
 const worker=new api.RelayWorker(f.pool,{...f.config,smtpPort:s.port},mode);assert.equal(await worker.runOnce(),true);
 assert.deepEqual([(await f.row(body.messageId)).state,(await f.row(body.messageId)).attempts,s.captured.length],['accepted',1,1]);
 assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
 assert.equal((await f.pool.query('SELECT count(*) FROM installation_services')).rows[0].count,'0');
});
// Omitting the policy read would acquire installation locks and complete while a transition owns authority.
for(const operation of ['approval','reserve','messages','HTTP','handoff'] as const)test(`venue relay ${operation} takes policy authority before installation locks`,async t=>{
 const f=await setup(t),s=await smtp(t);await f.set('registered');
 const body=operation==='approval'?undefined:await f.v.submit();
 let verified!:()=>void,releaseVerifier!:()=>void;
 const verifierEntered=new Promise<void>(resolve=>{verified=resolve;}),verifierWait=new Promise<void>(resolve=>{releaseVerifier=resolve;});
 const grants:RelayGrantStore=operation==='approval'?new api.RelayGrantStore(f.pool,{...f.config.grants,verifyOrigin:async(r:any)=>{verified();await verifierWait;return {...r,domainControl:true,httpsEndpoint:true,expiresAt:new Date(Date.now()+3600000).toISOString()};}},mode):f.grants;
 const blocker=await f.pool.connect();
 let done=false,pending:Promise<unknown>|undefined;
 try{
  if(operation==='approval'){
   pending=grants.approve(f.v.session.token,f.v.session.csrfToken,f.input());void pending!.catch(()=>{});await verifierEntered;
  }
  await blocker.query('BEGIN');await blocker.query('SELECT * FROM billing_service_authority WHERE venue_id=$1 FOR UPDATE',[f.venueId]);
  const blockerPid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  if(operation==='approval')releaseVerifier();
  else if(operation==='reserve')pending=transaction(f.pool,async c=>grants.reserve(c,{installationId:f.v.installation,publicKey:(await c.query('SELECT public_key FROM installations WHERE id=$1',[f.v.installation])).rows[0].public_key},{grantId:f.v.grant.id,grantRevision:1,messageId:body!.messageId,binding:(await c.query('SELECT binding FROM relay_messages WHERE message_id=$1',[body!.messageId])).rows[0].binding}));
  else if(operation==='messages')pending=f.messages.execute('email-submit',f.v.proof('email-submit',body));
  else if(operation==='HTTP'){
   const app=createAccountApp({pool:f.pool,outbox:{} as any,config:{portalOrigin:'http://localhost',production:false,rateKey:'ab'.repeat(32),trustedProxyIps:[]},relay:f.relay,leaseIssuer:f.issuer,planMode:mode});
   pending=Promise.resolve(app.request('http://localhost/v1/installations/email/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.v.proof('email-submit',body))},{incoming:{socket:{remoteAddress:'203.0.113.1'}}} as any)).then(response=>{assert.equal(response.status,200);});
  }
  else pending=new api.RelayWorker(f.pool,{...f.config,smtpPort:s.port},mode).runOnce();
  void pending!.then(()=>{done=true;},()=>{done=true;});
  let blocked=false;
  for(let n=0;n<100&&!done;n++){
   blocked=!!(await f.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[blockerPid])).rowCount;
   if(blocked)break;await delay(10);
  }
  assert.equal(blocked,true,'relay must wait for the venue policy transition');assert.equal(done,false);
  await transaction(f.pool,async c=>{assert.equal((await c.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE NOWAIT',[f.v.installation])).rowCount,1);});
  await blocker.query('COMMIT');await pending;
  assert.equal(s.captured.length,operation==='handoff'?1:0);
 }finally{releaseVerifier();try{await blocker.query('ROLLBACK');await pending;}finally{blocker.release();}}
});
for(const change of ['revoked grant','owner removed','expired grant','changed origin','stale revision','changed allowance policy','stop'] as const)test(`venue relay preserves ${change} refusal after level transition`,async t=>{
 const f=await setup(t),s=await smtp(t);await f.set('hosted');const body=await f.v.submit();await f.set('registered');
 if(change==='stop')await new RelayControl(f.pool).stop();
 else await f.pool.query(change==='revoked grant'?'UPDATE relay_grants SET enabled=false':change==='owner removed'?'DELETE FROM organisation_memberships':change==='expired grant'?"UPDATE relay_grants SET created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second'":change==='changed origin'?"UPDATE relay_grants SET management_origin='https://changed.example.test',revision=revision+1":change==='stale revision'?'UPDATE relay_grants SET revision=revision+1':"UPDATE relay_policies SET definition=jsonb_set(definition,'{units}','1')");
 const worker=new api.RelayWorker(f.pool,{...f.config,smtpPort:s.port},mode);
 if(change==='changed allowance policy')await assert.rejects(worker.runOnce(),/policy_conflict/);
 else {assert.equal(await worker.runOnce(),change!=='stop');assert.equal((await f.row(body.messageId)).state,change==='stop'?'queued':'cancelled');}
 assert.equal(s.captured.length,0);assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
});
for(const change of [{consent:false},{consentVersion:'outdated'},{managementOrigin:'https://elsewhere.example.test/path'}])test(`venue relay keeps explicit consent and canonical origin validation for ${Object.keys(change)[0]}`,async t=>{
 const f=await setup(t);await f.set('registered');
 await assert.rejects(f.grants.approve(f.v.session.token,f.v.session.csrfToken,{...f.input(),...change} as any),(error:any)=>error.code==='invalid_input');
 assert.equal((await f.pool.query('SELECT revision FROM relay_grants')).rows[0].revision,1);
 assert.equal((await f.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
});
test('venue relay new mode preserves its account allowance at registered level',async t=>{
 const f=await setup(t);await f.set('registered');
 const config={...f.relay,grants:{...f.config.grants,policy:{...f.config.grants.policy,version:'one-local-v1',units:1}}};
 const messages:RelayMessages=new api.RelayMessages(f.pool,f.issuer,'http://localhost',config,undefined,mode);
 const body={version:1,messageId:randomUUID(),grantId:f.v.grant.id,grantRevision:1,class:'password_reset',recipient:`${randomUUID()}@example.test`,displayName:'Ana',locale:'es-ES',timeZone:'Europe/Madrid',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')};
 assert.equal((await messages.execute('email-submit',f.v.proof('email-submit',body))).created,true);
 const next={...body,messageId:randomUUID()};
 await assert.rejects(messages.execute('email-submit',f.v.proof('email-submit',next)),(error:any)=>error.code==='allowance_exhausted');
 assert.equal((await f.pool.query('SELECT count(*) FROM relay_messages')).rows[0].count,'1');
 assert.equal((await f.pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'1');
});
