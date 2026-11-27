import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,stat,chmod,unlink} from 'node:fs/promises';
import {request} from 'node:http';
import {request as requestHttps} from 'node:https';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createSession} from '../../packages/identity/src/index.ts';
import {BillingStore,createLeaseIssuer,EmailOutbox,InstallationStore,RelayMessages,transaction} from '../../packages/registration/src/index.ts';
import {RelayGrantStore} from '../../packages/registration/src/relay-grants.ts';
import {connectedVenue,database} from '../../packages/translation/test/fixtures.ts';
import {startGuestMenuTrial} from '../../packages/remote-access/test/fixtures/guest-menu.ts';
import {fakeVenueMailProviders} from '../../packages/remote-access/test/fixtures/venue-mail-signing.ts';
import {runVenueMailSigning} from '../../packages/remote-access/src/venue-mail-signing.ts';
import {bootstrapTestCloudIdentity} from './bootstrap.mjs';
import {bootstrapStorageIssuer} from './storage-issuer.mjs';
import {loadRuntime} from '../local-stack/runtime.mjs';

const origin='https://cloud.example.test',mode='test-venue-levels';
async function api(){
 const value=await import('./relay-runtime.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
 assert.equal(typeof value.openTestRelayRuntime,'function','test startup must compose relay admission and delivery');return value;
}
async function setup(t){
 const db=await database(),directory=await mkdtemp(join(tmpdir(),'test-cloud-relay-'));
 t.after(async()=>{await db.close();await rm(directory,{recursive:true,force:true});});
 const issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),issuer=createLeaseIssuer(issuerKey);
 return {db,context:{pool:db.pool,directory,issuer,issuerKey,origin,mode,smtpPort:Number(process.env.MAILPIT_TEST_SMTP_PORT)}};
}
async function prepareAccount(t,context){
 await bootstrapTestCloudIdentity(context.directory,origin);await bootstrapStorageIssuer(context.directory);
 const reload=createServer((_req,res)=>{res.writeHead(204);res.end();});
 await new Promise(resolve=>reload.listen(join(context.directory,'storage-authority/reload.sock'),resolve));
 t.after(()=>new Promise(resolve=>reload.close(resolve)));
 return loadRuntime(context.directory);
}
async function startAccount(db,context,environment={}){
 const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options','-c search_path='+db.schema);
 const child=spawn(process.execPath,[new URL('./account-worker.mjs',import.meta.url).pathname],{env:{PATH:process.env.PATH,
  DATABASE_URL:connection.href,LOCAL_STACK_CONFIG_DIR:context.directory,CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_RATE_KEY:db.rateKey,
  CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_INSTALLATION_ISSUER_KEY:context.issuerKey,
  CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_HTTP_PORT:'0',...environment},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 const close=async()=>{
  if(child.exitCode!==null||child.signalCode!==null)return exited;
  child.kill('SIGTERM');
  const deadline=setTimeout(()=>child.kill('SIGKILL'),12000).unref();
  try{return await exited;}finally{clearTimeout(deadline);}
 };
 try{
  const {port,guestPort,guestAuthorityPort}=await Promise.race([new Promise(resolve=>child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('\n'))resolve(JSON.parse(stdout.split('\n')[0]));})),
   exited.then(code=>{throw Error(`account exited ${code}: ${stderr}`);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('account startup deadline')),15000).unref())]);
  return {server:{address:()=>({port})},guestPort,guestAuthorityPort,close,get stderr(){return stderr;}};
 }catch(error){await close();throw error;}
}
function accountRequest(running,path,body,headers={}){
 return new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:running.server.address().port,path,method:body?'POST':'GET',headers:{host:'cloud.example.test','content-type':'application/json',...headers}},res=>{
   let text='';res.on('data',chunk=>text+=chunk);res.once('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));res.once('error',reject);
  });req.once('error',reject);req.end(body&&JSON.stringify(body));
 });
}

test('the test account worker serves menu authority on a private listener when enabled',async t=>{
 const {db,context}=await setup(t);
 await prepareAccount(t,context);
 for(const enabled of ['0','1']){
  const running=await startAccount(db,context,{TEST_CLOUD_LIVE_GUEST_MENU:enabled});
  try{
   if(enabled==='0'){assert.equal(running.guestAuthorityPort,undefined);continue;}
   assert.ok(running.guestAuthorityPort);
   assert.notEqual(running.guestAuthorityPort,running.server.address().port);
   const response=await fetch('http://127.0.0.1:'+running.guestAuthorityPort+'/guest-menu/'+randomUUID());
   assert.equal(response.status,404);
  }finally{await running.close();}
 }
});

test('only the test Cloud action demo opens the venue console API',async t=>{
 const {db,context}=await setup(t),box=await connectedVenue(db,context.issuer,origin);
 const session=await transaction(db.pool,c=>createSession(c,box.accountId));
 await prepareAccount(t,context);
 for(const [enabled,amazon,expected] of [['0',undefined,404],['1',undefined,200],['1','1',404]]){
  const running=await startAccount(db,context,{CLOUD_ACTION_DEMO:enabled,TEST_CLOUD_AMAZON:amazon,CLOUD_OPERATOR_ACCOUNT_ID:box.accountId,
   CLOUD_ACTION_DEMO_DIR:join(context.directory,'operator-demo')});
  try{
   const reply=await accountRequest(running,'/api/account/operator/venues/read',{venueId:box.venueId},
    {origin,cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken});
   assert.equal(reply.status,expected,JSON.stringify(reply.body));
   if(expected===200)assert.deepEqual(reply.body,{venues:[{id:box.venueId,name:null,stopped:false}]});
  }finally{await running.close();}
 }
});

test('the test Cloud account worker serves signed address availability only with settings and key',async t=>{
 const {db,context}=await setup(t),box=await connectedVenue(db,context.issuer,origin);
 await prepareAccount(t,context);
 const cap={freeSuggestions:500,freeValidations:100,limitMicros:1000000};
 const CLOUD_ADDRESS_LOOKUP_SETTINGS=JSON.stringify({environment:'test',suggestionMicros:3113,validationMicros:18700,
  paidVenueMonth:{suggestions:500,validations:100},freeAccountMonth:{suggestions:100,validations:20},
  cloudDay:cap,cloudMonth:cap,freeDay:cap,freeMonth:cap});
 const GOOGLE_MAPS_SERVER_KEY='synthetic-google-key';
 for(const [settings,expected] of [[{CLOUD_ADDRESS_LOOKUP_SETTINGS},503],[{GOOGLE_MAPS_SERVER_KEY},503],
  [{CLOUD_ADDRESS_LOOKUP_SETTINGS,GOOGLE_MAPS_SERVER_KEY},200]]){
  const running=await startAccount(db,context,settings);
  try{
   const proof=box.proof('address-lookup',{version:1,kind:'available'},randomUUID(),box.lease);
   const reply=await accountRequest(running,'/api/installations/address-lookup',proof);
   assert.equal(reply.status,expected,JSON.stringify(reply.body));
   assert.deepEqual(reply.body,expected===200?{available:true}:{error:'temporarily_unavailable'});
  }finally{await running.close();}
 }
 assert.equal((await db.pool.query('SELECT count(*)::int AS calls FROM address_lookup_calls')).rows[0].calls,0);
});

test('the test Cloud account worker lets an allowlisted owner start Connected before automatic setup',async t=>{
 const {db,context}=await setup(t);
 const box=await connectedVenue(db,context.issuer,origin),session=await transaction(db.pool,c=>createSession(c,box.accountId));
 const config=await prepareAccount(t,context);
 const {RemoteAccessStore}=await import('../../packages/remote-access/src/placement.ts');
 await new RemoteAccessStore(db.pool,mode).createCell({id:config.gateway.cellId,country:'ES',provider:'aws',environment:'test',suffix:'gateway.example.test',subnet:19,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
 const running=await startAccount(db,context,{CLOUD_BILLING_ACCOUNT_TEST_IDS:box.accountId,TEST_CLOUD_TUNNEL_CELL_ID:config.gateway.cellId});
 try{
  const trial=await accountRequest(running,'/api/account/billing/start-trial',{venueId:box.venueId},{origin,cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken});
  assert.equal(trial.status,200,JSON.stringify(trial.body));
  assert.equal(trial.body.venues.find(venue=>venue.venueId===box.venueId).level,'connected');
  const response=await accountRequest(running,'/api/installations/tunnel-provision',
   box.proof('tunnel-provision',{peerPublicKey:randomBytes(32).toString('base64')},randomUUID(),box.lease));
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal(response.body.services.find(service=>service.service==='remote_access').configuration.cellId,config.gateway.cellId);
 }finally{await running.close();}
});

test('the test Cloud account worker presents enabled payment methods',async t=>{
 const {db,context}=await setup(t);
 const box=await connectedVenue(db,context.issuer,origin),session=await transaction(db.pool,c=>createSession(c,box.accountId));
 await prepareAccount(t,context);
 const settings={CLOUD_BILLING_ACCOUNT_TEST_IDS:box.accountId,CLOUD_BILLING_METHODS_MODE:'test',
  CLOUD_BILLING_STRIPE_TEST_ACCOUNT:'acct_synthetic',CLOUD_BILLING_STRIPE_TEST_KEY:'rk_test_synthetic',
  CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT:'MSYNTHETIC',CLOUD_BILLING_SUMUP_SANDBOX_KEY:'synthetic-sandbox-key'};
 for(const [mode,expected] of [['test',{selected:null,setup:null}],['off',undefined]]){
  const running=await startAccount(db,context,{...settings,CLOUD_BILLING_METHODS_MODE:mode});
  try{
   const view=await accountRequest(running,'/api/account/billing/read',{},{origin,cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken});
   assert.equal(view.status,200,JSON.stringify(view.body));
   assert.deepEqual(view.body.venues.find(venue=>venue.venueId===box.venueId).paymentMethods,expected,mode);
  }finally{await running.close();}
 }
});

test('the test Cloud account worker refuses a live Stripe key before listening',async t=>{
 const {db,context}=await setup(t);
 await prepareAccount(t,context);
 await assert.rejects(async()=>{
  const running=await startAccount(db,context,{CLOUD_BILLING_ACCOUNT_TEST_IDS:randomUUID(),CLOUD_BILLING_METHODS_MODE:'test',
   CLOUD_BILLING_STRIPE_TEST_ACCOUNT:'acct_synthetic',CLOUD_BILLING_STRIPE_TEST_KEY:'sk_live_synthetic',
   CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT:'MSYNTHETIC',CLOUD_BILLING_SUMUP_SANDBOX_KEY:'synthetic-sandbox-key'});
  await running.close();
 },/account exited 1: Account server refused test payment configuration/);
});

test('the Amazon test account accepts a signed publication and closes its private guest listener on shutdown',async t=>{
 const {db,context}=await setup(t),box=await connectedVenue(db,context.issuer,origin);
 await prepareAccount(t,context);
 const host='menus.cloud.example.test',path='/m/'+box.venueId,html='<h1>Juniper test menu</h1>';
 const body=JSON.stringify({defaultLanguage:'en',pages:{en:html}});
 const signed=box.proof('guest-menu-publish',{version:1,expectedRevision:1,bodySha256:createHash('sha256').update(body).digest('hex'),bodyBytes:Buffer.byteLength(body)},randomUUID(),box.lease);
 const publish=running=>accountRequest(running,'/api/installations/guest-menu-publish',{...signed,body});
 const existing=await startAccount(db,context,{CLOUD_VENUE_SERVICE_LEVELS:'0'});
 assert.equal(await existing.close(),0);
 await assert.rejects(async()=>{
  const refused=await startAccount(db,context,{CLOUD_VENUE_SERVICE_LEVELS:'0',GUEST_ORIGIN:'https://'+host,
   GUEST_HTTP_HOST:'127.0.0.1',GUEST_HTTP_PORT:'0'});
  await refused.close();
 },/account exited 1: Account server failed/);
 const off=await startAccount(db,context);
 try{assert.equal(off.guestPort,undefined);assert.equal((await publish(off)).status,503);}
 finally{await off.close();}
 const running=await startAccount(db,context,{GUEST_ORIGIN:'https://'+host,GUEST_HTTP_HOST:'127.0.0.1',GUEST_HTTP_PORT:'0'});
 try{
  const ca=await readFile(join(context.directory,'lan/ca.pem'));
  const read=()=>new Promise((resolve,reject)=>{
   const req=requestHttps({host:'127.0.0.1',port:running.guestPort,servername:'waitron.local',ca,path,headers:{host}},res=>{
    let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body}));});
   req.on('error',reject);req.end();
  });
  assert.ok(running.guestPort>0);
  await db.pool.query(`INSERT INTO guest_menus(venue_id,revision,state,source_installation_id,body_sha256,default_language,received_at,pages)
   VALUES($1,1,'current',$2,$3,'en',clock_timestamp(),$4)`,[box.venueId,box.installationId,'a'.repeat(64),{en:'<h1>Saved menu</h1>'}]);
  assert.equal((await read()).status,404);
  await startGuestMenuTrial(db.pool,box);
  const result=await publish(running);
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.url,'https://'+host+path);
  assert.deepEqual(await read(),{status:200,body:html});
  await running.close();
  await assert.rejects(read(),{code:'ECONNREFUSED'});
 }finally{await running.close();}
});

test('the guest listener closes when the account listener reports a shutdown failure',{timeout:20000},async t=>{
 const {db,context}=await setup(t);
 await prepareAccount(t,context);
 const preload=`import {Server} from 'node:http';
  const close=Server.prototype.close;
  Server.prototype.close=function(callback){return close.call(this,()=>callback(new Error('account close failed')));};`;
 const running=await startAccount(db,context,{GUEST_ORIGIN:'https://menus.cloud.example.test',
  GUEST_HTTP_HOST:'127.0.0.1',GUEST_HTTP_PORT:'0',NODE_OPTIONS:'--import=data:text/javascript,'+encodeURIComponent(preload)});
 assert.ok(running.guestPort>0);
 assert.equal(await running.close(),1,'worker must exit with the original shutdown failure');
 assert.doesNotMatch(running.stderr,/shutdown deadline exceeded/);
});

test('relay startup retains distinct private keys and refuses an insecure saved file',async t=>{
 const {openTestRelayRuntime}=await api(),{context}=await setup(t);
 await openTestRelayRuntime(context);
 const path=join(context.directory,'relay-keys.json'),before=await readFile(path,'utf8');
 assert.equal((await stat(path)).mode&0o777,0o600);
 const rings=JSON.parse(before),material=['payload','replay','suppression','bounds'].map(name=>rings[name].keys[rings[name].activeKeyId]);
 for(const value of material)assert.match(value,/^[a-f0-9]{64}$/);
 assert.equal(new Set(material).size,4);
 await openTestRelayRuntime(context);assert.equal(await readFile(path,'utf8'),before);
 await chmod(path,0o644);await assert.rejects(openTestRelayRuntime(context),/test_cloud.relay_keys/);
 assert.equal(await readFile(path,'utf8'),before,'bad permissions must not silently replace keys');
});

test('ordinary startup modes expose no relay capability or create private state',async t=>{
 const {openTestRelayRuntime}=await api(),{context}=await setup(t);
 for(const value of ['existing','test-free-paid','production-venue-levels'])assert.equal(await openTestRelayRuntime({...context,mode:value}),undefined);
 await assert.rejects(readFile(join(context.directory,'relay-keys.json')),error=>error.code==='ENOENT');
});

test('composed signed account submission survives worker restart and reaches Mailpit once',async t=>{
 const {openTestRelayRuntime}=await api(),{db,context}=await setup(t),runtime=await openTestRelayRuntime(context);
 const box=await connectedVenue(db,context.issuer,origin),session=await transaction(db.pool,c=>createSession(c,box.accountId));
 const statement=box.proof('configuration',{servicesVersion:2,managementOrigin:'https://waitron.local:3000'},randomUUID(),box.lease);
 await new InstallationStore(db.pool,context.issuer,origin).execute('configuration',statement);
 const grant=await new RelayGrantStore(db.pool,runtime.admission.grants,mode).approve(session.token,session.csrfToken,
  {installationId:box.installationId,expectedRevision:0,consent:true,consentVersion:'local-v1',managementOrigin:'https://waitron.local:3000',expiresAt:new Date(Date.now()+1800000).toISOString()},statement);
 const body={version:1,messageId:randomUUID(),grantId:grant.id,grantRevision:grant.revision,class:'invitation',recipient:`${randomUUID()}@example.test`,displayName:'Cafe Sol',locale:'en',timeZone:'Europe/Madrid',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')};
 await prepareAccount(t,context);
 const running=await startAccount(db,context);
 try{
  const response=await accountRequest(running,'/v1/installations/email/submit',box.proof('email-submit',body,body.messageId,box.lease));
  assert.equal(response.status,202,JSON.stringify(response.body));
  assert.equal((await db.pool.query('SELECT state FROM relay_messages WHERE message_id=$1',[body.messageId])).rows[0].state,'queued');
  const restarted=await openTestRelayRuntime(context);
  assert.equal(await restarted.worker.runOnce(),true);assert.equal(await restarted.worker.runOnce(),false);
  assert.equal((await db.pool.query('SELECT state FROM relay_messages WHERE message_id=$1',[body.messageId])).rows[0].state,'accepted');
  const inbox=await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`);assert.equal(inbox.status,200);
  assert.equal((await inbox.json()).messages.filter(mail=>mail.To.some(to=>to.Address===body.recipient)).length,1);
  await unlink(join(context.directory,'relay-keys.json'));
  await assert.rejects(openTestRelayRuntime(context),/test_cloud.relay_keys/);
  await assert.rejects(readFile(join(context.directory,'relay-keys.json')),error=>error.code==='ENOENT');
  await running.close();
  const degraded=await startAccount(db,context);
  try{
   const health=await accountRequest(degraded,'/api/health/ready');
   assert.equal(health.status,200,'missing relay keys must not stop account access');
   const refused=await accountRequest(degraded,'/v1/installations/email/submit',box.proof('email-submit',body,body.messageId,box.lease));
   assert.equal(refused.status,404,'missing keys must leave relay capability unavailable');
  }finally{await degraded.close();}
 }finally{await running.close();}
});

// Breaking only the relay table must not prevent the independent account queue from draining.
test('one-shot drains account capture before reporting a relay failure and watching keeps account mail running',async t=>{
 const {openTestRelayRuntime}=await api(),workerApi=await import('./email-worker.mjs');
 assert.equal(typeof workerApi.runTestEmailQueues,'function','account and relay queues need independent draining');
 const {EmailWorker}=await import('../../packages/registration/src/email-outbox.ts');
 const {createTestCaptureMailer}=await import('./capture-mailer.mjs');
 const {db,context}=await setup(t),runtime=await openTestRelayRuntime(context);
 const account=new EmailWorker(db.pool,db.outbox,createTestCaptureMailer({origin,port:context.smtpPort},origin));
 const recipient=`${randomUUID()}@example.test`;
 const enqueue=()=>transaction(db.pool,c=>db.outbox.enqueue(c,'password_changed',{email:recipient,locale:'en'}));
 await db.pool.query('ALTER TABLE relay_messages RENAME TO unavailable_relay_messages');
 const first=await enqueue();
 await assert.rejects(workerApi.runTestEmailQueues({account,relay:runtime.worker,signal:new AbortController().signal,once:true}));
 assert.equal((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[first])).rows[0].status,'sent');
 const second=await enqueue(),stop=new AbortController(),diagnostics=[];
 t.mock.method(console,'error',(...parts)=>diagnostics.push(parts));
 const running=workerApi.runTestEmailQueues({account,relay:runtime.worker,signal:stop.signal});
 let failure;void running.catch(error=>{failure=error;});
 try{
  for(let n=0;n<200;n++){
   if(failure)throw failure;
   if((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[second])).rows[0].status==='sent')break;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[second])).rows[0].status,'sent');
 }finally{stop.abort();await running;}
 assert.deepEqual(diagnostics,[['Test relay worker failed; check private configuration and schema']]);
 const inbox=await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`);
 assert.equal((await inbox.json()).messages.filter(mail=>mail.To.some(to=>to.Address===recipient)).length,2);
});

async function runEmailEntrypoint(t,db,context){
 const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options','-c search_path='+db.schema);
 const url=relative=>JSON.stringify(new URL(relative,import.meta.url).href);
 const script=`import{mock}from'node:test';const local=await import(${url('../local-stack/runtime.mjs')});
  mock.module(${url('../local-stack/runtime.mjs')},{namedExports:{...local,runtimeEnvironment:(...args)=>({...local.runtimeEnvironment(...args),DATABASE_URL:process.env.TEST_RELAY_DATABASE})}});
  const capture=await import(${url('./capture-mailer.mjs')});mock.module(${url('./capture-mailer.mjs')},{namedExports:{...capture,createTestCaptureMailer:(options,origin)=>capture.createTestCaptureMailer({...options,port:Number(process.env.TEST_RELAY_SMTP_PORT)},origin)}});
  const relay=await import(${url('./relay-runtime.mjs')});mock.module(${url('./relay-runtime.mjs')},{namedExports:{...relay,openTestRelayRuntime:options=>relay.openTestRelayRuntime({...options,smtpPort:Number(process.env.TEST_RELAY_SMTP_PORT)})}});
  const{runTestEmailWorker}=await import(${url('./email-worker.mjs')});try{await runTestEmailWorker({directory:process.env.LOCAL_STACK_CONFIG_DIR,root:process.cwd(),once:true});console.log('completed');}catch{console.log('refused');}`;
 const child=spawn(process.execPath,['--experimental-test-module-mocks','--input-type=module'],{cwd:new URL('../../',import.meta.url),env:{PATH:process.env.PATH,LOCAL_STACK_CONFIG_DIR:context.directory,TEST_CLOUD_ORIGIN:origin,CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0',TEST_RELAY_DATABASE:connection.href,TEST_RELAY_SMTP_PORT:String(context.smtpPort)},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exited;});child.stdin.end(script);
 assert.equal(await exited,0,stderr);return stdout.trim();
}

test('actual email entrypoint drains account mail before reporting lost relay keys',async t=>{
 const {openTestRelayRuntime}=await api(),{db,context}=await setup(t);
 await bootstrapTestCloudIdentity(context.directory,origin);await openTestRelayRuntime(context);
 await db.pool.query("INSERT INTO relay_suppressions(key_id,digest) VALUES('lost',$1)",['f'.repeat(64)]);
 await unlink(join(context.directory,'relay-keys.json'));
 const outbox=new EmailOutbox((await loadRuntime(context.directory)).email);
 const recipient=`${randomUUID()}@example.test`,id=await transaction(db.pool,c=>outbox.enqueue(c,'password_changed',{email:recipient,locale:'en'}));
 assert.equal(await runEmailEntrypoint(t,db,context),'refused');
 assert.equal((await db.pool.query('SELECT status FROM email_outbox WHERE id=$1',[id])).rows[0].status,'sent');
 const inbox=await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`);
 assert.equal((await inbox.json()).messages.filter(mail=>mail.To.some(to=>to.Address===recipient)).length,1);
});

test('box-signed staff mail uses verified venue From and falls back after confirmed loss',async t=>{
 const {openTestRelayRuntime}=await api(),{db,context}=await setup(t);
 await bootstrapTestCloudIdentity(context.directory,origin);
 const config=await loadRuntime(context.directory),outbox=new EmailOutbox(config.email);
 const box=await connectedVenue(db,context.issuer,origin),session=await transaction(db.pool,c=>createSession(c,box.accountId));
 const scope={organisationId:box.organisationId,legalBusinessId:box.legalBusinessId},billing=new BillingStore(db.pool);
 await billing.execute(scope,{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'ensure_business'});
 await billing.transition(scope,{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},
  {type:'set_venue',venueId:box.venueId,expectedRevision:(await billing.venue(scope,box.venueId)).revision,
   value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
 const domain='cafe.example.test',from='office@'+domain,reply='reply@'+domain;
 const owner=(await db.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[box.accountId])).rows[0].email;
 await db.pool.query("INSERT INTO account_alert_preferences(account_id,locale) VALUES($1,'es')",[box.accountId]);
 await db.pool.query("UPDATE venues SET waitron_mail_from=$2,waitron_mail_reply_to=$3,waitron_mail_dns_token=$4,display_name='Cafe Sol' WHERE id=$1",
  [box.venueId,from,reply,randomUUID()]);
 const runtime=await openTestRelayRuntime(context),managementOrigin='https://waitron.local:3000';
 const statement=box.proof('configuration',{servicesVersion:2,managementOrigin},randomUUID(),box.lease);
 await new InstallationStore(db.pool,context.issuer,origin).execute('configuration',statement);
 const expiresAt=new Date(Date.now()+1800000).toISOString();
 const grant=await new RelayGrantStore(db.pool,runtime.admission.grants,mode).approve(session.token,session.csrfToken,
  {installationId:box.installationId,expectedRevision:0,consent:true,consentVersion:'local-v1',managementOrigin,expiresAt},statement);
 const messages=new RelayMessages(db.pool,context.issuer,origin,runtime.admission,undefined,mode);
 const inbox=async()=>(await (await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/messages?limit=1000`)).json()).messages;
 async function send(expectedFrom){
  const messageId=randomUUID(),recipient=`${randomUUID()}@example.test`;
  const body={version:1,messageId,grantId:grant.id,grantRevision:grant.revision,class:'invitation',recipient,displayName:'Cafe Sol',locale:'en',timeZone:'Europe/Madrid',expiresAt,token:randomBytes(32).toString('base64url')};
  await messages.execute('email-submit',box.proof('email-submit',body,messageId,box.lease));
  assert.equal(await runEmailEntrypoint(t,db,context),'completed');
  const [mail]= (await inbox()).filter(item=>item.To.some(to=>to.Address===recipient));
  assert.deepEqual(mail?.From,{Name:'Cafe Sol',Address:expectedFrom});
  const detail=await (await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/message/${mail.ID}`)).json();
  assert.deepEqual(detail.ReplyTo,[{Name:'',Address:reply}]);
 }
 const fake=fakeVenueMailProviders('cloud.example.test',[domain]);
 const check=()=>runVenueMailSigning(db.pool,box.venueId,{...fake.options,outbox});
 await send('relay@example.test');
 assert.equal(await check(),'verified');
 await send(from);
 fake.alias(false);
 assert.equal(await check(),'awaiting_dns');
 assert.equal(await check(),'awaiting_dns');
 const queuedNotices=async()=>(await db.pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE kind='venue_signing_lost' AND status='pending'")).rows[0].n;
 assert.equal(await queuedNotices(),1);
 await send('relay@example.test');
 const notices=async()=>(await inbox()).filter(mail=>mail.To.some(to=>to.Address===owner)&&mail.Subject==='Tu dominio de correo dejó de verificarse');
 const delivered=await notices();assert.equal(delivered.length,1);
 const notice=await (await fetch(`${process.env.MAILPIT_TEST_URL}/api/v1/message/${delivered[0].ID}`)).json();
 assert.match(notice.Text,/cafe\.example\.test/);

 fake.alias(true);
 assert.equal(await check(),'verified');
 fake.alias(false);
 assert.equal(await check(),'awaiting_dns');
 await db.pool.query('UPDATE cloud_credentials SET email=$2 WHERE account_id=$1',[box.accountId,`${randomUUID()}@example.test`]);
 assert.equal(await runEmailEntrypoint(t,db,context),'completed');
 assert.equal(await queuedNotices(),0);
 assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE kind='venue_signing_lost' AND status='cancelled'")).rows[0].n,1);
 assert.equal((await notices()).length,1);
});

// Restoring an older database beside a newly generated file must retain unknown-key refusal.
test('regenerated keys cannot silently accept restored suppression history',async t=>{
 const {openTestRelayRuntime}=await api(),{db,context}=await setup(t),original=await openTestRelayRuntime(context);
 await original.worker.suppress('blocked@example.test');
 const blocked=(await db.pool.query('SELECT key_id,digest FROM relay_suppressions')).rows[0];
 await db.pool.query('DELETE FROM relay_suppressions');await unlink(join(context.directory,'relay-keys.json'));
 const regenerated=await openTestRelayRuntime(context);
 await db.pool.query('INSERT INTO relay_suppressions(key_id,digest) VALUES($1,$2)',[blocked.key_id,blocked.digest]);
 await assert.rejects(regenerated.worker.suppress('another@example.test'),/relay_unavailable/);
 assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_suppressions')).rows[0].n,1);
});

test('test relay setup accepts only a canonical UTC pilot end date',async()=>{
 const {testRelayGrantConfig}=await import('./relay-runtime.mjs');
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const input={origin,issuer},setupExpiresAt='2030-01-01T00:00:00.000Z';
 assert.equal(testRelayGrantConfig(input).setupExpiresAt,undefined);
 assert.equal(testRelayGrantConfig({...input,setupExpiresAt}).setupExpiresAt,setupExpiresAt);
 assert.throws(()=>testRelayGrantConfig({...input,setupExpiresAt:'2030-01-01'}),/test_cloud.relay_setup_expiry/);
});

test('the account worker identifies a malformed setup relay date by its setting name',async t=>{
 const {db,context}=await setup(t);
 await prepareAccount(t,context);
 const running=await startAccount(db,context,{CLOUD_TEST_RELAY_SETUP_EXPIRES_AT:'2030-01-01'});
 assert.equal(await running.close(),0);
 assert.match(running.stderr,/CLOUD_TEST_RELAY_SETUP_EXPIRES_AT/);
 await assert.rejects(stat(join(context.directory,'relay-keys.json')),{code:'ENOENT'});
});
