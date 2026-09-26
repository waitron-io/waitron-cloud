import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {after,before,test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';

let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();await db.pool.query('UPDATE usage_reconciliation_sources SET last_attempted_at=clock_timestamp(),caught_up_at=clock_timestamp()');});
after(async()=>db?.close());
async function server(){
 const value=createServer((request,response)=>{response.setHeader('content-type','application/json');response.end(request.url?.endsWith('/live')?'{"status":"live"}':'{"status":"ready"}');});
 await new Promise<void>((resolve,reject)=>{value.once('error',reject);value.listen(0,'127.0.0.1',resolve);});const address=value.address();assert.ok(address&&typeof address!=='string');
 return {url:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>value.close(error=>error?reject(error):resolve()))};
}
function run(args:string[],overrides:NodeJS.ProcessEnv={}){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
 const child=spawn(process.execPath,[new URL('../src/cli.ts',import.meta.url).pathname,...args],{env:{PATH:process.env.PATH,DATABASE_URL:url.href,...overrides},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 return once(child,'exit').then(([code,signal])=>({code,signal,stdout,stderr}));
}

test('CLI emits JSON, readiness exit status and deterministic metrics',async()=>{
 const health=await server();try{
  const status=await run([],{CLOUD_CONTROL_API_URL:health.url});assert.equal(status.code,0,status.stderr);assert.equal(JSON.parse(status.stdout).ready,true);assert.equal(status.stderr,'');
  const ready=await run(['--ready'],{CLOUD_CONTROL_API_URL:health.url});assert.equal(ready.code,0,ready.stderr);assert.equal(JSON.parse(ready.stdout).state,'ready');
  const metrics=await run(['--metrics'],{CLOUD_CONTROL_API_URL:health.url});assert.equal(metrics.code,0,metrics.stderr);assert.match(metrics.stdout,/waitron_cloud_operations_ready 1/);
  await db.pool.query("UPDATE usage_reconciliation_sources SET caught_up_at=clock_timestamp()-interval '10 minutes'");
  const degraded=await run(['--ready'],{CLOUD_CONTROL_API_URL:health.url});assert.equal(degraded.code,2,degraded.stderr);assert.equal(JSON.parse(degraded.stdout).state,'degraded');
 }finally{await health.close();}
});

test('CLI rejects invalid invocation and configuration with one fixed secret-free diagnostic',async()=>{
 for(const [args,overrides] of [
  [['--unknown'],{CLOUD_CONTROL_API_URL:'https://private.example.test'}],
  [[],{CLOUD_CONTROL_API_URL:''}],
  [[],{CLOUD_CONTROL_API_URL:'https://operator:private-secret@example.test'}],
  [[],{DATABASE_URL:'',CLOUD_CONTROL_API_URL:'https://private.example.test'}],
 ] as const){
  const outcome=await run([...args],{...overrides});assert.equal(outcome.code,1);assert.equal(outcome.stdout,'');
  assert.equal(outcome.stderr,'Cloud operations status failed; check database, migrations and health URL\n');
  assert.equal(outcome.stderr.includes('private'),false);
 }
});
