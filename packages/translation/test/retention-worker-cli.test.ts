import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createJob,jobFingerprint,lockVenue} from '../src/index.ts';
import {connectedVenue,database,giveConsent} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';
let db:Awaited<ReturnType<typeof database>>;
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
async function stale(){
 const v=await connectedVenue(db,issuer,'https://cloud.example.test'),id=randomUUID();
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,done,provider,model,prompt_version,finished_at)
  VALUES($1,$2,$3,$4,$5,10,'done',1,1,'openai','gpt-6-luna','translate-all-v1',clock_timestamp()-interval '25 hours')`,[id,v.installationId,v.venueId,randomUUID(),'a'.repeat(64)]);
 await db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'private worker sweep menu')",[id]);return id;
}
const look=async(id:string)=>(await db.pool.query('SELECT j.state,(SELECT count(*)::int FROM translation_job_bodies b WHERE b.job_id=j.id) AS bodies FROM translation_jobs j WHERE j.id=$1',[id])).rows[0];
function worker(args:string[],baseUrl:string,nodeArgs:string[]=[]){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
 const child=spawn(process.execPath,[...nodeArgs,new URL('../src/worker-cli.ts',import.meta.url).pathname,...args],{env:{...process.env,DATABASE_URL:url.href,CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'sk-private-retention-key',CLOUD_OPENAI_BASE_URL:baseUrl},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});
 const deadline=setTimeout(()=>child.kill('SIGKILL'),15000);
 const exited=once(child,'close').then(([code,signal])=>{clearTimeout(deadline);return {code,signal,stdout,stderr};});
 return {exited,output:()=>({stdout,stderr}),async stop(){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');return exited;}};
}
async function until(check:()=>Promise<boolean>){const end=Date.now()+5000;while(!await check()){if(Date.now()>end)throw new Error('expiry timed out');await delay(20);}}
test('--once sweeps retained text even when no queued job needs the provider',async()=>{
 const fake=await startFakeOpenAi(()=>{throw new Error('no job');});
 try{const id=await stale(),out=await worker(['--once'],fake.baseUrl).exited;
  assert.deepEqual(out,{code:0,signal:null,stdout:'',stderr:''});assert.deepEqual(await look(id),{state:'expired',bodies:0});assert.equal(fake.requests.length,0);
 }finally{await fake.close();}
});
test('the worker loop sweeps at startup and after an hour while idle',async()=>{
 const fake=await startFakeOpenAi(()=>{throw new Error('no job');});
 const preload=`const original=performance.now.bind(performance);const start=original();Object.defineProperty(performance,'now',{configurable:true,value:()=>start+(original()-start)*6000});`;
 const id=await stale(),run=worker([],fake.baseUrl,['--import','data:text/javascript;base64,'+Buffer.from(preload).toString('base64')]);
 try{
  await until(async()=>(await look(id)).state==='expired');
  const later=await stale();await until(async()=>(await look(later)).state==='expired');
  assert.deepEqual(await look(later),{state:'expired',bodies:0});assert.equal(fake.requests.length,0);
 }finally{const out=await run.stop();await fake.close();assert.deepEqual(out,{code:0,signal:null,stdout:'',stderr:''});}
});

async function queue(){
 const v=await connectedVenue(db,issuer,'https://cloud.example.test');await giveConsent(db,v);
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},houseStyle:[],items:[{ref:'p1',kind:'product',family:'p1',category:null,staffName:'CAFE',existing:{},missing:['ca','es']}]});
 return transaction(db.pool,async client=>{await lockVenue(client,v.venueId);return createJob(client,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(body),body,total:1});});
}
test('--once expires an old queued job before any provider request',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const job=await queue();await db.pool.query("UPDATE translation_jobs SET created_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[job.id]);
  const out=await worker(['--once'],fake.baseUrl).exited;
  assert.deepEqual(out,{code:0,signal:null,stdout:'',stderr:''});assert.equal(fake.requests.length,0);
  assert.deepEqual(await look(job.id),{state:'expired',bodies:0});
 }finally{await fake.close();}
});
const fastWaits=(recover:boolean)=>['--import','data:text/javascript;base64,'+Buffer.from(`import timers from 'node:timers/promises';import {syncBuiltinESMExports} from 'node:module';const original=timers.setTimeout;timers.setTimeout=(ms,...args)=>original(${recover?'ms===60000?600:':''}ms===1000?10:ms,...args);syncBuiltinESMExports();`).toString('base64')];
for(const action of ['recover','stop'])test(`cleanup failure pauses new jobs, retries once a minute, and can ${action}`,async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 await stale();const job=await queue();
 await db.pool.query(`CREATE FUNCTION fail_worker_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SENTINEL private cleanup failure'; END $$`);
 await db.pool.query("CREATE TRIGGER fail_worker_expiry BEFORE UPDATE ON translation_jobs FOR EACH ROW WHEN (NEW.state='expired') EXECUTE FUNCTION fail_worker_expiry()");
 const run=worker([],fake.baseUrl,fastWaits(action==='recover'));let output:Awaited<ReturnType<typeof run.stop>>|undefined;
 try{
  await until(async()=>run.output().stderr.includes('\n'));await delay(100);
  assert.equal(run.output().stderr.trim().split('\n').length,1,'cleanup retries wait a minute');
  assert.equal(run.output().stderr,'Translation worker cleanup failed; retrying\n');
  assert.equal(fake.requests.length,0);assert.deepEqual(await look(job.id),{state:'queued',bodies:1});
  if(action==='recover'){
   await db.pool.query('DROP TRIGGER fail_worker_expiry ON translation_jobs');
   await until(async()=>(await look(job.id)).state==='done');
   assert.equal(fake.requests.length,2);assert.deepEqual(await look(job.id),{state:'done',bodies:1});
  }
 }finally{
  output=await run.stop();await db.pool.query('DROP TRIGGER IF EXISTS fail_worker_expiry ON translation_jobs');await db.pool.query('DROP FUNCTION fail_worker_expiry()');await fake.close();
 }
 assert.deepEqual(output,{code:0,signal:null,stdout:'',stderr:'Translation worker cleanup failed; retrying\n'});
});
