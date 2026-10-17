import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {connectedVenue,database,giveConsent,readyForTranslation} from './fixtures.ts';
import {emptyReview,isReview,responsesBody,startFakeOpenAi,type FakeRequest} from './fake-openai.ts';
const origin='http://localhost',apiKey='sk-private-test-key';
const issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),issuer=createLeaseIssuer(issuerKey);
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
function child(script:URL,env:NodeJS.ProcessEnv){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
 const proc=spawn(process.execPath,[script.pathname],{env:{...process.env,DATABASE_URL:url.href,...env},stdio:['ignore','pipe','pipe']});
 const output={stdout:'',stderr:''};proc.stdout.on('data',chunk=>{output.stdout+=chunk;});proc.stderr.on('data',chunk=>{output.stderr+=chunk;});
 const deadline=setTimeout(()=>proc.kill('SIGKILL'),25000);
 const exited=once(proc,'close').then(result=>{clearTimeout(deadline);return result;});
 return {output,async stop(){if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGTERM');const [code,signal]=await exited;return {...output,code,signal};}};
}
function post(port:number,action:string,body:unknown){
 return new Promise<{status:number;body:string}>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:`/api/installations/${action}`,method:'POST',headers:{host:'localhost','content-type':'application/json'}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,body:text}));});
  req.setTimeout(5000,()=>req.destroy(new Error('HTTP deadline')));req.on('error',reject);req.end(JSON.stringify(body));
 });
}
const rows=(r:FakeRequest)=>JSON.parse(r.body.input.slice(r.body.input.indexOf('Products:\n')+'Products:\n'.length)) as {id:string}[];
test('neither the account server nor the worker writes a name, the key or an authorisation header to its output',async()=>{
 const fake=await startFakeOpenAi(r=>{
  if(isReview(r))return emptyReview();
  if(r.body.input.includes('SENTINEL-STAFF-FAIL'))return {status:500,headers:{'retry-after':'0'},raw:r.body.input};
  const products=rows(r).map(p=>({id:p.id,ca:`SENTINEL-NAME-${p.id}-ca`,es:`SENTINEL-NAME-${p.id}-es`,placeholder:false,corrections:[]}));
  return {json:responsesBody(JSON.stringify({products}))};
 });
 const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);await giveConsent(db,v);
 const server=child(new URL('../../account-http/src/server-cli.ts',import.meta.url),{CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),
  CLOUD_HTTP_RATE_KEY:db.rateKey,CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_PORT:'0',CLOUD_HTTP_HOST:'127.0.0.1',NODE_ENV:'test',CLOUD_HTTP_TRUSTED_PROXY_IPS:'',
  CLOUD_INSTALLATION_ISSUER_KEY:issuerKey,CLOUD_TRANSLATION:'1'});
 const worker=child(new URL('../src/worker-cli.ts',import.meta.url),{CLOUD_OPENAI_API_KEY:apiKey,CLOUD_OPENAI_BASE_URL:fake.baseUrl});
 const durable=await mkdtemp(join(tmpdir(),'translation-pages-'));
 let failure:unknown;
 try{
  for(let n=0;n<500&&!server.output.stdout.includes('\n');n++)await delay(20);
  const port=JSON.parse(server.output.stdout.trim().split('\n')[0]!).port as number;
  const item=(ref:string,category:string,staffName:string)=>({ref,kind:'product',family:ref,category,staffName,existing:{en:`SENTINEL-EXISTING-${ref}`},missing:['ca','es']});
  const items=[...Array.from({length:60},(_,i)=>item(`ok:${i}`,'A',`SENTINEL-STAFF-OK-${i}`)),...Array.from({length:60},(_,i)=>item(`bad:${i}`,'B',`SENTINEL-STAFF-FAIL-${i}`))];
  const job=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},items,
   houseStyle:[{kind:'product',staffName:'SENTINEL-HOUSE',names:{ca:'SENTINEL-HOUSE-CA'}}]});
  const submitted=await post(port,'translation-submit',v.submit(job));assert.equal(submitted.status,200,submitted.body);
  const {jobId}=JSON.parse(submitted.body) as {jobId:string},reference=(action:string)=>v.proof(action,{version:1,jobId},randomUUID(),v.lease);
  let state='queued';
  for(let n=0;n<25&&(state==='queued'||state==='running');n++){await delay(1000);state=JSON.parse((await post(port,'translation-status',reference('translation-status'))).body).state;}
  assert.equal(state,'partly_done');
  let cursor:number|null=0,pageIndex=0;const refs=new Set<string>();
  do{
   const reply=await post(port,'translation-collect',v.proof('translation-collect',{version:1,jobId,cursor},randomUUID(),v.lease));
   assert.equal(reply.status,200,reply.body);assert(Buffer.byteLength(reply.body)<=16777216);
   const filename=join(durable,`${pageIndex++}.json`);await writeFile(filename,reply.body);
   const page=JSON.parse(await readFile(filename,'utf8')) as {results:{ref:string;names:Record<string,string>}[];failed:string[];nextCursor:number|null};
   for(const ref of [...page.results.map(r=>r.ref),...page.failed]){assert.equal(refs.has(ref),false);refs.add(ref);}
   assert(page.results.every(r=>Object.values(r.names).every(name=>name.startsWith('SENTINEL-NAME-'))));
   cursor=page.nextCursor;
  }while(cursor!==null);
  assert.equal(refs.size,120);assert(items.every(item=>refs.has(item.ref)));
  assert.equal((await post(port,'translation-release',reference('translation-release'))).status,200);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,0);
 }catch(error){failure=error;}
 const outputs=[await worker.stop(),await server.stop()];await fake.close();await rm(durable,{recursive:true,force:true});
 for(const output of outputs){assert.equal(output.code,0);assert.equal(output.signal,null);}
 if(failure)throw failure;
 const text=outputs.map(o=>o.stdout+o.stderr).join('\n');
 for(const secret of ['SENTINEL',apiKey,'Bearer'])assert.equal(text.includes(secret),false,secret);
});
