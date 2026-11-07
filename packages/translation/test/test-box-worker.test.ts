import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test,type TestContext} from 'node:test';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import * as provider from '../src/openai-client.ts';
import {Pool} from 'pg';
import {TranslationMachine,TranslationWorker} from '../src/index.ts';
import {connectedVenue,database,giveConsent} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,type FakeRequest} from './fake-openai.ts';

let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{await db.pool.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE state IN ('queued','running')");});
async function queued(){
 const venue=await connectedVenue(db,issuer,origin);await giveConsent(db,venue);
 const machine=new TranslationMachine(db.pool,issuer,origin);
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es','en']},houseStyle:[],
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'TAPAS',staffName:'GILDAS',existing:{},missing:['es','en']}]});
 const signed=venue.submit(body),reply=await machine.execute('translation-submit',{payload:signed.payload,signature:signed.signature},body);
 return {...venue,machine,jobId:reply.jobId as string};
}
type Queued=Awaited<ReturnType<typeof queued>>;
const row=async(id:string)=>(await db.pool.query('SELECT * FROM translation_jobs WHERE id=$1',[id])).rows[0];
const worker=(v:Queued)=>provider.createTestBoxTranslationWorker(db.pool,{installationId:v.installationId,venueId:v.venueId,apiKey:'synthetic-private-trial-key'});
function fake(t:TestContext,afterFirst?:()=>Promise<void>,firstStatus=200){
 const calls:FakeRequest[]=[];
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.redirect,'manual');
  assert.equal((init.headers as Record<string,string>).authorization,'Bearer synthetic-private-trial-key');
  const r:FakeRequest={path:'/v1/responses',headers:{},body:JSON.parse(init.body as string)};
  calls.push(r);assert.equal(r.body.store,false);assert.equal(r.body.model,'gpt-6-luna');
  if(calls.length===1)await afterFirst?.();
  if(calls.length===1&&firstStatus!==200)return new Response('',{status:firstStatus,headers:{'retry-after':'0'}});
  return new Response(JSON.stringify((isReview(r)?emptyReview():echoFirstPass(r)).json),{status:200});
 });return calls;
}

test('the explicit one-box worker translates its signed job and preserves usage and collection',async t=>{
 const v=await queued(),calls=fake(t);assert.equal(await worker(v).runOnce(new AbortController().signal),true);
 assert.deepEqual(calls.map(c=>c.body.reasoning.effort),['low','medium']);
 const ended=await row(v.jobId);assert.deepEqual([ended.state,ended.done,ended.input_tokens,ended.output_tokens,ended.cost_micro_usd],['done',1,'200','100','70']);
 const result=await v.machine.execute('translation-collect',v.proof('translation-collect',{version:1,jobId:v.jobId},randomUUID(),v.lease));
 assert.deepEqual(result.results,[{ref:'product:1',names:{es:'GILDAS [es]',en:'GILDAS [en]'},placeholder:false,corrections:[]}]);
});

for(const state of ['queued','running'] as const)test(`the trial leaves another installation's older ${state} job untouched`,async t=>{
 const outside=await queued(),v=await queued();
 await db.pool.query(`UPDATE translation_jobs SET state=$2,created_at=clock_timestamp()-interval '1 hour',
  lease_id=CASE WHEN $2='running' THEN gen_random_uuid() ELSE NULL END,
  lease_until=CASE WHEN $2='running' THEN clock_timestamp()-interval '1 second' ELSE NULL END WHERE id=$1`,[outside.jobId,state]);
 const before=await row(outside.jobId),calls=fake(t);
 assert.equal(await worker(v).runOnce(new AbortController().signal),true);
 assert.equal((await row(v.jobId)).state,'done');assert.deepEqual(await row(outside.jobId),before);assert.equal(calls.length,2);
});

test('wrong venue, production and revoked scope never lease or send the queued menu',async t=>{
 const calls=fake(t);
 for(const refusal of ['venue','production','revoked']){
  const v=await queued();
  if(refusal==='venue')v.venueId=randomUUID();
  if(refusal==='production')await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[v.venueId]);
  if(refusal==='revoked')await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installationId]);
  const before=await row(v.jobId);assert.equal(await worker(v).runOnce(new AbortController().signal),false,refusal);
  assert.deepEqual(await row(v.jobId),before,refusal);
 }assert.equal(calls.length,0);
});
test('a mismatched installation and venue leaves both installations jobs untouched',async t=>{
 const outside=await queued(),v=await queued(),before=await Promise.all([row(v.jobId),row(outside.jobId)]),calls=fake(t);
 assert.equal(await worker({...v,installationId:outside.installationId}).runOnce(new AbortController().signal),false);
 assert.deepEqual(await Promise.all([row(v.jobId),row(outside.jobId)]),before);assert.equal(calls.length,0);
});
test('a lost lease identity cannot retry an unbilled provider refusal under the replacement pass',async t=>{
 const v=await queued(),replacement=randomUUID(),calls=fake(t,async()=>{
  await db.pool.query("UPDATE translation_jobs SET lease_id=$2,lease_count=lease_count+1,lease_until=clock_timestamp()+interval '10 minutes' WHERE id=$1",[v.jobId,replacement]);
 },429);
 await worker(v).runOnce(new AbortController().signal);assert.equal(calls.length,1);
 const current=await row(v.jobId);assert.deepEqual([current.state,current.lease_id,current.cost_micro_usd],['running',replacement,'0']);
});
test('a trial scope cannot override another plan modes permission hook',async()=>{
 const pool=new Pool();try{
  for(const planMode of ['test-free-paid','test-venue-levels'] as const)assert.throws(()=>new TranslationWorker(pool,provider.createOpenAiClient({apiKey:'synthetic'}),
   {planMode,scope:{installationId:randomUUID(),venueId:randomUUID()}}),/translation_worker_options_invalid/);
  assert.equal(pool.totalCount,0);
 }finally{await pool.end();}
});

test('authority lost during the first provider wait keeps paid names and stops all later calls',async t=>{
 for(const refusal of ['consent','revoked','production','lease']){
  const v=await queued();const calls=fake(t,async()=>{
   if(refusal==='consent')await db.pool.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1',[v.venueId]);
   if(refusal==='revoked')await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installationId]);
   if(refusal==='production')await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[v.venueId]);
   if(refusal==='lease')await db.pool.query("UPDATE translation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[v.jobId]);
  });
  await worker(v).runOnce(new AbortController().signal);assert.equal(calls.length,1,refusal);
  const ended=await row(v.jobId);assert.deepEqual([ended.state,ended.done,ended.cost_micro_usd],['done',1,'35'],refusal);
  t.mock.restoreAll();
 }
});

async function command(args:string[],env:NodeJS.ProcessEnv={},nodeArgs:string[]=[]){
 const databaseUrl=new URL(process.env.TEST_DATABASE_URL!);databaseUrl.searchParams.set('options',`-c search_path=${db.schema}`);
 const child=spawn('/bin/sh',['-c','printf "CLOUD_OPENAI_API_KEY=synthetic-private-trial-key\\n" | exec "$@"','trial-pipe','env','-u','CLOUD_OPENAI_API_KEY',process.execPath,...nodeArgs,
  '--env-file=/dev/stdin',new URL('../src/test-box-worker-cli.ts',import.meta.url).pathname,...args],
  {env:{...process.env,DATABASE_URL:databaseUrl.href,CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:undefined,CLOUD_TEST_ALLOWANCES:'0',CLOUD_ALLOWANCE_CALENDAR:undefined,...env},detached:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const timeout=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)process.kill(-child.pid!,'SIGKILL');},15000);
 try{const [code,signal]=await once(child,'close');return {code,signal,stdout,stderr};}finally{clearTimeout(timeout);}
}
test('one-pass launcher takes the piped key over an inherited key and reports an empty queue',async()=>{
 const preload="if(process.env.CLOUD_OPENAI_API_KEY!=='synthetic-private-trial-key')throw Error('wrong synthetic key source');globalThis.fetch=()=>{throw Error('idle worker attempted a provider request');};";
 assert.deepEqual(await command([randomUUID(),randomUUID(),'--once'],{CLOUD_OPENAI_API_KEY:'synthetic-parent-key'},['--import','data:text/javascript,'+encodeURIComponent(preload)]),
  {code:0,signal:null,stdout:'No matching translation job\n',stderr:''});
});
test('the one-pass command reports its actual signed jobs done or failed state',async()=>{
 for(const outcome of ['done','failed']){
  const v=await queued(),preload=`import {echoFirstPass,emptyReview,isReview} from ${JSON.stringify(new URL('./fake-openai.ts',import.meta.url).href)};
  globalThis.fetch=async(url,init)=>{if(url!=='https://api.openai.com/v1/responses')throw Error('wrong provider destination');
   if(${outcome==='failed'})return new Response('',{status:401});const r={path:'/v1/responses',headers:{},body:JSON.parse(init.body)};
   return new Response(JSON.stringify((isReview(r)?emptyReview():echoFirstPass(r)).json),{status:200});};`;
  assert.deepEqual(await command([v.installationId,v.venueId,'--once'],{},['--import','data:text/javascript,'+encodeURIComponent(preload)]),
   {code:outcome==='done'?0:1,signal:null,stdout:`Translation job: ${outcome}\n`,stderr:''});
  assert.equal((await row(v.jobId)).state,outcome);
 }
});
test('a missing migration refuses the one-pass command before it can select a job',async()=>{
 const saved=(await db.pool.query("DELETE FROM schema_migrations WHERE name='040_translation_result_json.sql' RETURNING *")).rows[0];
 try{assert.deepEqual(await command([randomUUID(),randomUUID(),'--once']),
  {code:1,signal:null,stdout:'',stderr:'Test-box translation worker failed; check trial scope, database and provider configuration\n'});}
 finally{await db.pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)',[saved.name,saved.digest,saved.applied_at]);}
});
test('a fatal idle database event refuses the one-pass launcher instead of reporting success',async()=>{
 const preload=`import {createRequire} from 'node:module';const {Pool}=createRequire(${JSON.stringify(new URL('../package.json',import.meta.url).href)})('pg');
 const query=Pool.prototype.query;Pool.prototype.query=async function(...args){const result=await query.apply(this,args);
 if(String(args[0]).includes('FROM schema_migrations')){this.emit('error',new Error('synthetic-private-database'));this.emit('error',new Error('synthetic-private-database'));}return result;};`;
 assert.deepEqual(await command([randomUUID(),randomUUID(),'--once'],{},['--import','data:text/javascript,'+encodeURIComponent(preload)]),
  {code:1,signal:null,stdout:'',stderr:'Test-box translation worker failed; check trial scope, database and provider configuration\n'});
});
test('one-pass launcher refuses malformed scope and billing modes without printing private configuration',async()=>{
 for(const [args,env] of [
  [['bad-scope',randomUUID(),'--once'],{}],[[randomUUID(),randomUUID()],{}],
  [[randomUUID(),randomUUID(),'--once'],{CLOUD_TEST_SERVICE_PLANS:'1'}],
  [[randomUUID(),randomUUID(),'--once'],{CLOUD_VENUE_SERVICE_LEVELS:'test'}],
  [[randomUUID(),randomUUID(),'--once'],{CLOUD_TEST_ALLOWANCES:'1',CLOUD_ALLOWANCE_CALENDAR:'UTC'}],
 ] as [string[],NodeJS.ProcessEnv][]){
  assert.deepEqual(await command(args,env),{code:1,signal:null,stdout:'',stderr:'Test-box translation worker failed; check trial scope, database and provider configuration\n'});
 }
});
