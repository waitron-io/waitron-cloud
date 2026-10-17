import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
const issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),issuer=createLeaseIssuer(issuerKey);
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
function server(overrides:NodeJS.ProcessEnv,nodeArgs:string[]=[]){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);url.searchParams.set('application_name',db.schema+'-sweep-server');
 const child=spawn(process.execPath,[...nodeArgs,new URL('../src/server-cli.ts',import.meta.url).pathname],{env:{...process.env,
  DATABASE_URL:url.href,CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_HTTP_RATE_KEY:db.rateKey,CLOUD_PORTAL_ORIGIN:'http://localhost',
  CLOUD_HTTP_PORT:'0',CLOUD_HTTP_HOST:'127.0.0.1',NODE_ENV:'test',CLOUD_HTTP_TRUSTED_PROXY_IPS:'',CLOUD_INSTALLATION_ISSUER_KEY:issuerKey,...overrides},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exited=once(child,'close');const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);void exited.finally(()=>clearTimeout(deadline));
 return {output:()=>({stdout,stderr}),async listening(){const end=Date.now()+10000;while(!stdout.includes('\n')){assert.equal(child.exitCode,null,stderr);if(Date.now()>end)throw new Error('no listening line');await delay(20);}},
  async stop(){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const [code,signal]=await exited;return {code,signal,stdout,stderr};}};
}
async function finished(v:{installationId:string;venueId:string},age:string){
 const id=randomUUID();
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,done,provider,model,prompt_version,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,10,'done',1,1,'openai','gpt-6-luna','translate-all-v1',clock_timestamp()-$6::interval,clock_timestamp()-$6::interval)`,[id,v.installationId,v.venueId,randomUUID(),'a'.repeat(64),age]);
 await db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'{}')",[id]);
 return id;
}
const look=async(id:string)=>(await db.pool.query('SELECT j.state,(SELECT count(*)::integer FROM translation_job_bodies b WHERE b.job_id=j.id) AS bodies FROM translation_jobs j WHERE j.id=$1',[id])).rows[0];
test('with translation on, the account server deletes an expired menu before it listens, with no worker running',async()=>{
 const v=await connectedVenue(db,issuer,'http://localhost'),stale=await finished(v,'25 hours'),recent=await finished(v,'1 hour');
 const off=server({CLOUD_TRANSLATION:'0'});await off.listening();await off.stop();
 assert.deepEqual(await look(stale),{state:'done',bodies:1});
 const on=server({CLOUD_TRANSLATION:'1'});
 try{
  await on.listening();
  assert.deepEqual(await look(stale),{state:'expired',bodies:0});
  assert.deepEqual(await look(recent),{state:'done',bodies:1});
 }finally{const out=await on.stop();assert.equal(out.stderr,'');}
});

const fastIntervals=['--import','data:text/javascript;base64,'+Buffer.from(`const original=globalThis.setInterval;globalThis.setInterval=(fn,ms,...args)=>original(fn,ms===60000?20:ms,...args);`).toString('base64')];
async function until(check:()=>Promise<boolean>,ms=5000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('condition timed out');await delay(20);}}
test('an enabled account server sweeps newly aged jobs every minute, survives failure with fixed output, and stops cleanly',async()=>{
 const v=await connectedVenue(db,issuer,'http://localhost'),run=server({CLOUD_TRANSLATION:'1'},fastIntervals);
 let renamed=false;let output:Awaited<ReturnType<typeof run.stop>>|undefined;
 try{
  await run.listening();const stale=await finished(v,'25 hours');
  await until(async()=>(await look(stale)).state==='expired');
  await db.pool.query('ALTER TABLE translation_job_bodies RENAME TO private_sweep_failure');renamed=true;
  await finishedWithoutBody(v);
  await until(async()=>run.output().stderr.includes('Account server translation cleanup failed\n'));
  await db.pool.query('ALTER TABLE private_sweep_failure RENAME TO translation_job_bodies');renamed=false;
  await until(async()=>(await db.pool.query("SELECT count(*)::int AS n FROM translation_jobs WHERE state='done' AND finished_at<clock_timestamp()-interval '24 hours'")).rows[0].n===0);
 }finally{
  if(renamed)await db.pool.query('ALTER TABLE private_sweep_failure RENAME TO translation_job_bodies');
  output=await run.stop();
 }
 assert.equal(output.code,0);assert.equal(output.signal,null);
 assert(output.stderr.length>0);assert(output.stderr.split('\n').filter(Boolean).every(line=>line==='Account server translation cleanup failed'),output.stderr);
});
async function finishedWithoutBody(v:{installationId:string;venueId:string}){
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,done,provider,model,prompt_version,finished_at)
  VALUES($1,$2,$3,$4,$5,10,'done',1,1,'openai','gpt-6-luna','translate-all-v1',clock_timestamp()-interval '25 hours')`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'a'.repeat(64)]);
}
test('translation off leaves newly aged jobs untouched through repeated timer passes',async()=>{
 const v=await connectedVenue(db,issuer,'http://localhost'),run=server({CLOUD_TRANSLATION:'0'},fastIntervals);
 try{await run.listening();const stale=await finished(v,'25 hours');await delay(200);assert.deepEqual(await look(stale),{state:'done',bodies:1});}
 finally{const out=await run.stop();assert.equal(out.code,0);assert.equal(out.stderr,'');}
});

test('a slow scheduled sweep has only one database pass in flight and shutdown drains that pass',async()=>{
 const run=server({CLOUD_TRANSLATION:'1'},fastIntervals),lock=await db.pool.connect();let stopping:ReturnType<typeof run.stop>|undefined;
 const passes=async()=>(await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND query LIKE 'SELECT id FROM translation_jobs%'",[db.schema+'-sweep-server'])).rows[0].n as number;
 try{
  await run.listening();await lock.query('BEGIN');await lock.query('LOCK translation_jobs IN ACCESS EXCLUSIVE MODE');
  await until(async()=>await passes()>0);await delay(150);
  assert.equal(await passes(),1,'a slow pass must not overlap later timer firings');
  stopping=run.stop();await delay(50);assert.equal(await passes(),1);
 }finally{
  await lock.query('ROLLBACK');lock.release();const out=await (stopping??run.stop());assert.equal(out.code,0);assert.equal(out.stderr,'');
 }
 assert.equal(await passes(),0);
});
