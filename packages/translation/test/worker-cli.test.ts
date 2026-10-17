import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,afterEach,before,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createJob,jobFingerprint,lockVenue,parseJob,writtenItems} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const failed='Translation worker failed; check database, migrations and provider configuration\n';
before(async()=>{db=await database();});after(async()=>db?.close());
const children=new Set<()=>Promise<void>>();
afterEach(async()=>{await Promise.all([...children].map(dispose=>dispose()));children.clear();});
beforeEach(async()=>{await db.pool.query('DELETE FROM translation_job_bodies');await db.pool.query('DELETE FROM translation_jobs');});
function command(args:string[],overrides:NodeJS.ProcessEnv={}){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);const applicationName=randomUUID();url.searchParams.set('application_name',applicationName);
 const child=spawn(process.execPath,[new URL('../src/worker-cli.ts',import.meta.url).pathname,...args],{env:{...process.env,
  DATABASE_URL:url.href,CLOUD_OPENAI_API_KEY:'sk-private-cli-key',CLOUD_OPENAI_BASE_URL:'',...overrides},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);
 const exited=once(child,'close').then(([code,signal])=>{clearTimeout(deadline);return {code,signal,stdout,stderr};});
 const dispose=async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;};
 children.add(dispose);
 return {child,exited,dispose,applicationName};
}
async function queue(){
 const v=await connectedVenue(db,issuer,origin);
 const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']}],houseStyle:[]});
 return transaction(db.pool,async c=>{await lockVenue(c,v.venueId);
  return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:writtenItems(parseJob(text)).length});});
}
async function until(check:()=>boolean|Promise<boolean>,ms=10000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('condition timed out');await delay(20);}}
test('bad settings exit 1 with one fixed line and no private value',async()=>{
 const cases:[string[],NodeJS.ProcessEnv][]=[[['--once'],{CLOUD_OPENAI_API_KEY:''}],[['--once'],{CLOUD_OPENAI_BASE_URL:'http://private-host.example/v1'}],
  [['--private-flag'],{}],[['--once','--once'],{}],[['--once'],{DATABASE_URL:''}]];
 for(const [args,env] of cases){
  const out=await command(args,env).exited;
  assert.equal(out.code,1,JSON.stringify(args));assert.equal(out.stdout,'');assert.equal(out.stderr,failed);
  for(const secret of ['sk-private-cli-key','private-host','private-flag'])assert.equal((out.stdout+out.stderr).includes(secret),false,secret);
 }
});
test('a schema missing a migration exits 1 with the fixed line',async()=>{
 const saved=(await db.pool.query("DELETE FROM schema_migrations WHERE name='040_translation_result_json.sql' RETURNING *")).rows[0];
 try{const out=await command(['--once']).exited;assert.equal(out.code,1);assert.equal(out.stderr,failed);}
 finally{await db.pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)',[saved.name,saved.digest,saved.applied_at]);}
});
test('--once runs a queued job to the end and prints nothing',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const job=await queue(),out=await command(['--once'],{CLOUD_OPENAI_BASE_URL:fake.baseUrl}).exited;
  assert.deepEqual([out.code,out.stdout,out.stderr],[0,'','']);
  assert.equal((await db.pool.query('SELECT state FROM translation_jobs WHERE id=$1',[job.id])).rows[0].state,'done');
 }finally{await fake.close();}
});
test('SIGTERM during a provider call exits 0, saves nothing and hands the lease back',async()=>{
 const fake=await startFakeOpenAi(()=>new Promise(()=>{}));
 try{
  const job=await queue(),run=command([],{CLOUD_OPENAI_BASE_URL:fake.baseUrl});
  await until(()=>fake.requests.length===1);
  run.child.kill('SIGTERM');
  const out=await run.exited;
  assert.deepEqual([out.code,out.stdout,out.stderr],[0,'','']);
  assert.deepEqual((await db.pool.query(`SELECT j.state,j.lease_count,j.lease_until<=clock_timestamp() AS free,b.batch_results
   FROM translation_jobs j JOIN translation_job_bodies b ON b.job_id=j.id WHERE j.id=$1`,[job.id])).rows,[{state:'running',lease_count:0,free:true,batch_results:{}}]);
 }finally{await fake.close();}
});

for(const [name,key] of [['newline','sk-private\nkey'],['carriage return','sk-private\rkey'],['non-header Unicode','sk-🔑'],['blank','   ']])
test(`an invalid provider key (${name}) is refused before an idle run`,async()=>{
 const out=await command(['--once'],{CLOUD_OPENAI_API_KEY:key}).exited;
 assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[1,null,'',failed]);
});

test('--once with no job exits quietly without a provider call',async()=>{
 const fake=await startFakeOpenAi(()=>{throw new Error('no job should call');});
 try{
  const out=await command(['--once'],{CLOUD_OPENAI_BASE_URL:fake.baseUrl}).exited;
  assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[0,null,'','']);
  assert.equal(fake.requests.length,0);
 }finally{await fake.close();}
});
test('--once completes just one of two queued jobs with stored names and usage',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const first=await queue(),second=await queue();
  const out=await command(['--once'],{CLOUD_OPENAI_BASE_URL:fake.baseUrl}).exited;
  assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[0,null,'','']);
  assert.deepEqual((await db.pool.query('SELECT state,done,failed,input_tokens,output_tokens FROM translation_jobs WHERE id=$1',[first.id])).rows,
   [{state:'done',done:1,failed:0,input_tokens:'200',output_tokens:'100'}]);
  assert.deepEqual((await db.pool.query('SELECT batch_results FROM translation_job_bodies WHERE job_id=$1',[first.id])).rows[0].batch_results,
   {'0':{results:[{ref:'product:1',names:{ca:'CAFE [ca]',es:'CAFE [es]'},placeholder:false,corrections:[]}],failed:[]}});
  assert.equal((await db.pool.query('SELECT state FROM translation_jobs WHERE id=$1',[second.id])).rows[0].state,'queued');
  assert.equal(fake.requests.length,2);
  assert.deepEqual((await db.pool.query('SELECT event_type AS type,quantity::text FROM usage_events WHERE source_reference=$1 ORDER BY event_type',[first.id])).rows,
   [{type:'translation.cost_micro_usd',quantity:'70'},{type:'translation.input_tokens',quantity:'200'},
    {type:'translation.items_completed',quantity:'1'},{type:'translation.output_tokens',quantity:'100'}]);
 }finally{await fake.close();}
});
test('SIGINT during review saves no partial batch and hands its lease back',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?new Promise(()=>{}):echoFirstPass(r));
 const job=await queue(),run=command([],{CLOUD_OPENAI_BASE_URL:fake.baseUrl});
 try{
  await until(()=>fake.requests.length===2);run.child.kill('SIGINT');
  const out=await run.exited;assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[0,null,'','']);
  assert.deepEqual((await db.pool.query(`SELECT j.state,j.lease_count,j.lease_until<=clock_timestamp() AS free,b.batch_results
   FROM translation_jobs j JOIN translation_job_bodies b ON b.job_id=j.id WHERE j.id=$1`,[job.id])).rows,
   [{state:'running',lease_count:0,free:true,batch_results:{}}]);
 }finally{await run.dispose();await fake.close();}
});
for(const signal of ['SIGINT','SIGTERM'] as const)
test(`${signal} while idle stops polling quietly`,async()=>{
 const run=command([]);
 try{
  await until(async()=>Number((await db.pool.query('SELECT count(*) AS n FROM pg_stat_activity WHERE application_name=$1',[run.applicationName])).rows[0].n)>0);
  run.child.kill(signal);
  const out=await run.exited;assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[0,null,'','']);
 }finally{await run.dispose();}
});
test('continuous work leases two jobs, leaves a third queued and releases both on stop',async()=>{
 const fake=await startFakeOpenAi(()=>new Promise(()=>{}));
 const jobs=[await queue(),await queue(),await queue()],run=command([],{CLOUD_OPENAI_BASE_URL:fake.baseUrl});
 try{
  await until(()=>fake.requests.length>=2);
  assert.equal(fake.requests.length,2);
  const rows=(await db.pool.query(`SELECT state,lease_count,extract(epoch FROM lease_until-clock_timestamp())::float8 AS remaining
   FROM translation_jobs WHERE id=ANY($1::uuid[]) ORDER BY created_at,id`,[jobs.map(j=>j.id)])).rows;
  assert.deepEqual(rows.map(r=>[r.state,r.lease_count]),[['running',1],['running',1],['queued',0]]);
  for(const row of rows.slice(0,2))assert.ok(row.remaining>590&&row.remaining<=600,'live lease must outlast the 120-second provider attempt');
  run.child.kill('SIGTERM');const out=await run.exited;
  assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[0,null,'','']);
  assert.deepEqual((await db.pool.query(`SELECT state,lease_count,lease_until<=clock_timestamp() AS free
   FROM translation_jobs ORDER BY created_at,id`)).rows,
   [{state:'running',lease_count:0,free:true},{state:'running',lease_count:0,free:true},{state:'queued',lease_count:0,free:null}]);
  assert.equal(fake.requests.length,2);
 }finally{await run.dispose();await fake.close();}
});
test('a database connection failure has fixed output without its URL or password',async()=>{
 const out=await command(['--once'],{DATABASE_URL:'postgres://private-user:private-password@127.0.0.1:1/private-db'}).exited;
 assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[1,null,'',failed]);
});
test('an unknown migration cannot replace a missing expected migration',async()=>{
 const saved=(await db.pool.query("DELETE FROM schema_migrations WHERE name='040_translation_result_json.sql' RETURNING *")).rows[0];
 try{
  await db.pool.query('INSERT INTO schema_migrations(name,digest) VALUES($1,$2)',['999_unknown.sql',saved.digest]);
  const out=await command(['--once']).exited;
  assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[1,null,'',failed]);
 }finally{
  await db.pool.query("DELETE FROM schema_migrations WHERE name='999_unknown.sql'");
  await db.pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)',[saved.name,saved.digest,saved.applied_at]);
 }
});

test('DATABASE_URL is required even when PostgreSQL fallback settings can connect',async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);
 const out=await command(['--once'],{DATABASE_URL:'',PGHOST:url.hostname,PGPORT:url.port,
  PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1),
  PGOPTIONS:`-c search_path=${db.schema}`}).exited;
 assert.deepEqual([out.code,out.signal,out.stdout,out.stderr],[1,null,'',failed]);
});
