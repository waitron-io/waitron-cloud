import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {request} from 'node:http';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {TranslationMachine} from '@waitron-cloud/translation';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from '../../translation/test/fake-openai.ts';
import {AllowanceConfigStore,BillingStore,createLeaseIssuer} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {connectedVenue,database,giveConsent,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='http://localhost',allowances={mode:'test',calendar:'UTC'} as const;
const config={portalOrigin:origin,production:false,rateKey:'ab'.repeat(32),trustedProxyIps:[]};
// Dropped option propagation would admit three items despite the two-item monthly ceiling.
async function fixture(t:any){
 const db=await database();t.after(()=>db.close());const issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),issuer=createLeaseIssuer(issuerKey);
 const v=await connectedVenue(db,issuer,origin),store=new BillingStore(db.pool),scope={organisationId:v.organisationId,legalBusinessId:v.legalBusinessId};
 const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
 await store.execute(scope,event(),{type:'ensure_business'});
 await store.transition(scope,event(),{type:'set_venue',venueId:v.venueId,expectedRevision:0,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
 await readyForTranslation(db,v);await giveConsent(db,v);
 const limit={transactional_email:'2',sms:'0',address_lookup:'2',content_translation:'2',rota_solver:'1'};
 await new AllowanceConfigStore(db.pool).publish({revision:1,effectiveFrom:'2020-01-01',limits:{registered:limit,connected:limit,hosted:limit},unpaidTrial:{content_translation:'1',rota_solver:'1'}});
 const text=(n:number)=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items:Array.from({length:n},(_,i)=>({ref:'product:'+i,kind:'product',family:'product:'+i,category:'BAR',staffName:'Cafe',existing:{},missing:['ca','es']})),houseStyle:[]});
 return {db,v,issuer,issuerKey,text,options:{pool:db.pool,outbox:db.outbox,config:{...config,rateKey:db.rateKey},translation:true,leaseIssuer:issuer,planMode:'test-venue-levels',allowances}};
}

for(const entry of ['app','server'])test('account '+entry+' rejects invalid allowance mode before database or listeners',async()=>{
 const base={pool:{} as any,outbox:{} as any,config,port:0};
 for(const planMode of ['existing','test-free-paid','test-venue-levels'])for(const value of [null,{mode:'production',calendar:'UTC'},{mode:'test',calendar:'Europe/Rome'},...(planMode==='test-venue-levels'?[]:[allowances])]){
  const options={...base,planMode,allowances:value};
  if(entry==='app')assert.throws(()=>createAccountApp(options as any),{code:'invalid_allowance_input'});
  else {let running:Awaited<ReturnType<typeof startAccountServer>>|undefined;try{await assert.rejects(async()=>{running=await startAccountServer(options as any);},{code:'invalid_allowance_input'});}finally{await running?.close();}}
 }
});

test('account app passes explicit allowances to authenticated translation admission and replay',async t=>{
 const f=await fixture(t),app=createAccountApp(f.options as any);
 const post=(envelope:unknown)=>app.request(origin+'/api/installations/translation-submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)},{incoming:{socket:{remoteAddress:'203.0.113.1'}}} as any);
 const refused=await post(f.v.submit(f.text(3)));assert.deepEqual([refused.status,await refused.json()],[409,{error:'translation_limit_reached',fits:2}]);
 assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');
 const envelope=f.v.submit(f.text(2)),first=await post(envelope);assert.equal(first.status,200);const reply=await first.json();
 const replay=await post(envelope);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),reply);
 const saved=(await f.db.pool.query('SELECT account_id,units::text,state FROM billing_allowance_reservations')).rows;assert.deepEqual(saved,[{account_id:f.v.accountId,units:'2',state:'held'}]);
});

test('account listener forwards test allowances before accepting real HTTP requests',async t=>{
 const f=await fixture(t),running=await startAccountServer({...f.options,port:0} as any);t.after(()=>running.close());
 const address=running.server.address();assert.ok(address&&typeof address!=='string');
 const response=await post(address.port,f.v.submit(f.text(3)));
 assert.deepEqual([response.status,response.body],[409,{error:'translation_limit_reached',fits:2}]);assert.equal((await f.db.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'0');
});

function post(port:number,envelope:unknown){
 return new Promise<{status:number;body:unknown}>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:'/api/installations/translation-submit',method:'POST',headers:{host:'localhost','content-type':'application/json'}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>{try{resolve({status:res.statusCode!,body:JSON.parse(text)});}catch(error){reject(error);}});
  });req.setTimeout(5000,()=>req.destroy(new Error('fixture HTTP deadline')));req.on('error',reject);req.end(JSON.stringify(envelope));
 });
}
function environment(f:Awaited<ReturnType<typeof fixture>>){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+f.db.schema);
 return {...process.env,DATABASE_URL:url.href,NODE_ENV:'test',CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TEST_ALLOWANCES:'1',CLOUD_ALLOWANCE_CALENDAR:'UTC'};
}

test('translation worker command spends the original monthly admission before loopback calls',async t=>{
 const f=await fixture(t),fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));t.after(()=>fake.close());
 const machine=new TranslationMachine(f.db.pool,f.issuer,origin,undefined,undefined,'test-venue-levels',allowances),envelope=f.v.submit(f.text(2));
 const reply=await machine.execute('translation-submit',{payload:envelope.payload,signature:envelope.signature},envelope.body) as {jobId:string};
 const output=await promisify(execFile)(process.execPath,[new URL('../../translation/src/worker-cli.ts',import.meta.url).pathname,'--once'],{env:{...environment(f),CLOUD_OPENAI_API_KEY:'local-only',CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_BASE_URL:fake.baseUrl},timeout:15000});
 assert.deepEqual(output,{stdout:'',stderr:''});assert.equal(fake.requests.length,2);
 const saved=(await f.db.pool.query('SELECT units::text,state,attempted_at FROM billing_allowance_reservations')).rows[0];
 assert.equal(saved.units,'2');assert.equal(saved.state,'spent');assert.ok(saved.attempted_at instanceof Date);
 assert.deepEqual((await f.db.pool.query('SELECT state,done,failed,allowance_open_calls FROM translation_jobs WHERE id=$1',[reply.jobId])).rows,[{state:'done',done:2,failed:0,allowance_open_calls:0}]);
});

test('account server command forwards explicit test allowance settings to real HTTP admission',async t=>{
 const f=await fixture(t),child=spawn(process.execPath,[new URL('../src/server-cli.ts',import.meta.url).pathname],{env:{...environment(f),CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(f.db.keys),CLOUD_HTTP_RATE_KEY:f.db.rateKey,CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_PORT:'0',CLOUD_HTTP_HOST:'127.0.0.1',CLOUD_HTTP_TRUSTED_PROXY_IPS:'',CLOUD_INSTALLATION_ISSUER_KEY:f.issuerKey,CLOUD_TRANSLATION:'1'},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exited=once(child,'close');const deadline=setTimeout(()=>child.kill('SIGKILL'),15000);
 try{
  const until=performance.now()+10000;while(!stdout.includes('\n')&&child.exitCode===null&&performance.now()<until)await delay(10);
  assert.equal(child.exitCode,null,stderr);assert.ok(stdout.includes('\n'),'server must announce its bound port');
  const port=JSON.parse(stdout.trim()).port,response=await post(port,f.v.submit(f.text(3)));
  assert.deepEqual(response,{status:409,body:{error:'translation_limit_reached',fits:2}});
  assert.equal((await f.db.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'0');
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const [code,signal]=await exited;clearTimeout(deadline);assert.deepEqual([code,signal,stderr],[0,null,'']);}
});
