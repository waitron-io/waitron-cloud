import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {request,type IncomingHttpHeaders} from 'node:http';
import {after,before,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {connectedVenue,database,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='http://localhost';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,addresses=0;
const config=()=>({portalOrigin:origin,production:false,rateKey:db.rateKey,trustedProxyIps:[] as string[]});
before(async()=>{db=await database();app=createAccountApp({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:config()});});
after(async()=>db?.close());
beforeEach(async()=>{await db.pool.query('TRUNCATE account_rate_limits');});
type Venue=Awaited<ReturnType<typeof connectedVenue>>&{ip:string};
async function venue():Promise<Venue>{const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);return {...v,ip:`198.51.100.${++addresses}`};}
const post=(v:{ip:string},action:string,body:string)=>app.request(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json'},body},{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
const error=async(response:Response)=>[response.status,((await response.json()) as {error:string}).error];
const item=(ref:string,staffName='CAFE',category:string|null='x')=>({ref,kind:'product',family:ref,category,staffName,existing:{},missing:['ca','es','en']});
const jobText=(items:object[])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},items,houseStyle:[]});
// A field of 1 + extra JSON bytes, at most 500 characters, for extra up to 997.
const pad=(extra:number)=>extra%2?'xx'+'"'.repeat((extra-1)/2):'x'+'"'.repeat(extra/2);
// A valid job of exactly `target` UTF-8 bytes, about nine tenths of them escaped quote characters.
function quoteHeavyJob(target:number){
 const full=(k:number)=>item(`product:${k}`,'"'.repeat(500)),small=(k:number,staff='x',category='x')=>item(`product:${k}`,staff,category);
 const items:object[]=[],size=(list:object[])=>Buffer.byteLength(jobText(list),'utf8');
 while(size([...items,full(items.length),small(items.length+1)])<=target)items.push(full(items.length));
 const gap=target-size([...items,small(items.length)]),first=Math.min(gap,997),second=gap-first;
 assert.ok(gap>=0&&second<=997,`gap ${gap}`);
 const text=jobText([...items,small(items.length,pad(first),pad(second))]);
 assert.equal(Buffer.byteLength(text,'utf8'),target);assert.ok(items.length<1000);
 return text;
}
type Reply={status:number;headers:IncomingHttpHeaders;body:string};
function send(port:number,path:string,body:string,from?:string,headers:Record<string,string>={}){
 return new Promise<Reply>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path,method:'POST',headers:{host:'localhost','content-type':'application/json',...(from?{'x-forwarded-for':from}:{}),...headers}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:text}));});
  req.on('error',reject);req.end(body);
 });
}
function trickle(port:number,path:string,body:string,pieces:number,pauseMs:number){
 return new Promise<Reply>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path,method:'POST',headers:{host:'localhost','content-type':'application/json','content-length':String(Buffer.byteLength(body))}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:text}));});
  req.on('error',()=>{});
  const size=Math.ceil(body.length/pieces);
  void (async()=>{for(let i=0;i<pieces;i++){if(req.destroyed)return;req.write(body.slice(i*size,(i+1)*size));if(i<pieces-1)await delay(pauseMs);}req.end();})().catch(reject);
 });
}
// An unfinished request sends one byte and keeps its body reader waiting.
function hold(port:number,from:string,path='/api/installations/translation-submit',headers:Record<string,string>={}){
 let req:ReturnType<typeof request>;
 const result=new Promise<Reply>((resolve,reject)=>{
  req=request({host:'127.0.0.1',port,path,method:'POST',
   headers:{host:'localhost','content-type':'application/json','content-length':'1000','x-forwarded-for':from,...headers}},res=>{
    let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:text}));res.on('error',reject);
   });
  req.on('error',reject);req.write('{');
 });
 void result.catch(()=>{});
 return {result,abort(){req.destroy();}};
}
function ready(port:number,from:string){
 return new Promise<Reply>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:'/api/health/ready',headers:{host:'localhost','x-forwarded-for':from}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:text}));});
  req.on('error',reject);req.end();
 });
}
async function until(check:()=>Promise<boolean>,ms=5000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('condition timed out');await delay(20);}}
async function host(trustedProxyIps:string[]=[]){
 const running=await startAccountServer({pool:db.pool,outbox:db.outbox,config:{...config(),trustedProxyIps},port:0,translation:true,leaseIssuer:issuer});
 const address=running.server.address();assert.ok(address&&typeof address!=='string');return {...running,port:address.port};
}
test('a 1 MiB job made mostly of quote characters is accepted, and one byte more is refused as too large',async()=>{
 const v=await venue(),exact=quoteHeavyJob(1048576),request=JSON.stringify(v.submit(exact));
 assert.ok(Buffer.byteLength(request)>16384*100);
 const accepted=await post(v,'translation-submit',request);
 assert.equal(accepted.status,200,await accepted.clone().text());
 const w=await venue();
 assert.deepEqual(await error(await post(w,'translation-submit',JSON.stringify(w.submit(quoteHeavyJob(1048577))))),[413,'translation_job_too_large']);
});
test('more than 1,000 items is too large',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify(v.submit(jobText(Array.from({length:1001},(_,i)=>item(`product:${i}`))))))),[413,'translation_job_too_large']);
});
test('a request over the submit limit is refused as too large, and status keeps the 16 KiB limit',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify({payload:'x',signature:'y',body:'a'.repeat(2113536)}))),[413,'translation_job_too_large']);
 assert.deepEqual(await error(await post(v,'translation-status',JSON.stringify({payload:'x'.repeat(20480),signature:'y'}))),[413,'invalid_input']);
});
test('submit may take up to 60 seconds to arrive; status still has 5',async()=>{
 const running=await host();
 try{
  const v=await venue();
  const submitted=await trickle(running.port,'/api/installations/translation-submit',JSON.stringify(v.submit(jobText([item('product:1')]))),3,3000);
  assert.equal(submitted.status,200,submitted.body);
  const status=JSON.stringify(v.proof('translation-status',{version:1,jobId:JSON.parse(submitted.body).jobId},randomUUID(),v.lease));
  assert.equal((await trickle(running.port,'/api/installations/translation-status',status,3,3000)).status,408);
 }finally{await running.close();}
});
test('stalled submits never take the eight places every other request shares, and one address holds one submit at a time',async()=>{
 // The server trusts loopback as a proxy here, so each stalled submit can come from its own forwarded address.
 const running=await host(['127.0.0.1']),addresses=Array.from({length:8},(_,i)=>`198.18.0.${i+1}`),held:{abort():void}[]=[];
 const attempts=async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n);
 try{
  const v=await venue(),body=()=>JSON.stringify(v.submit(jobText([item('product:1')])));
  held.push(hold(running.port,addresses[0]!));
  // The route's per-address rate rule is consumed before the body is read, so a counted attempt means the stalled submit is inside.
  await until(async()=>await attempts()>=2);
  const sameAddress=await send(running.port,'/api/installations/translation-submit',body(),addresses[0]);
  assert.deepEqual([sameAddress.status,sameAddress.headers['retry-after']],[503,'1']);
  for(const from of addresses.slice(1))held.push(hold(running.port,from));
  await until(async()=>await attempts()>=8);
  assert.equal((await send(running.port,'/api/installations/translation-submit',body(),'198.18.0.9')).status,503);
  const probe=await ready(running.port,'198.18.0.10');
  assert.deepEqual([probe.status,JSON.parse(probe.body)],[200,{status:'ready'}]);
  assert.equal((await send(running.port,'/api/installations/translation-status',JSON.stringify({payload:'x',signature:'y'}),'198.18.0.11')).status,401);
  held[0]!.abort();
  await until(async()=>(await send(running.port,'/api/installations/translation-submit',body(),addresses[0])).status===200);
 }finally{for(const h of held)h.abort();await running.close();}
});
test('submit admission uses the same canonical trusted proxy configuration as the routes',async()=>{
 const running=await host(['::ffff:127.0.0.1']),held=hold(running.port,'198.18.1.1');
 try{
  await until(async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n)===2);
  const v=await venue(),response=await send(running.port,'/api/installations/translation-submit',JSON.stringify(v.submit(jobText([item('product:1')]))),'198.18.1.2');
  assert.equal(response.status,200,response.body);
 }finally{held.abort();await running.close();}
});
test('the exact submit request byte limit is accepted by declared and streamed readers; one more byte is refused',async()=>{
 const running=await host(),base=JSON.stringify({payload:'x',signature:'y',body:''});
 try{
  const gap=2113536-Buffer.byteLength(base);
  const exact=JSON.stringify({payload:'x',signature:'y',body:'é'.repeat(Math.floor(gap/2))+'x'.repeat(gap%2)});
  assert.equal(Buffer.byteLength(exact),2113536);
  for(const declared of [false,true])for(const extra of ['', 'x']){
   const body=exact+extra,response=await send(running.port,'/api/installations/translation-submit',body,undefined,declared?{'content-length':String(Buffer.byteLength(body))}:{'transfer-encoding':'chunked'});
   assert.deepEqual([response.status,JSON.parse(response.body).error],extra?[413,'translation_job_too_large']:[401,'invalid_proof']);
  }
 }finally{await running.close();}
});
test('status, collect and release keep exact 16 KiB byte bounds for declared and streamed requests',async()=>{
 const v=await venue(),base=JSON.stringify({payload:'',signature:'x'}),exact=JSON.stringify({payload:'a'.repeat(16384-Buffer.byteLength(base)),signature:'x'});
 assert.equal(Buffer.byteLength(exact),16384);
 for(const action of ['translation-status','translation-collect','translation-release'])for(const declared of [false,true]){
  for(const extra of ['', ' ']){
   const body=exact+extra;
   assert.deepEqual(await error(await postRequest(action,body,v.ip,declared?{'content-length':String(Buffer.byteLength(body))}:{})),extra?[413,'invalid_input']:[401,'invalid_proof']);
  }
 }
});
function postRequest(action:string,body:string,ip:string,headers:Record<string,string>={}){
 return app.request(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json',...headers},body},{incoming:{socket:{remoteAddress:ip}}} as HttpBindings);
}
test('a fifth unfinished submit is refused before reading or charging a rate allowance',async()=>{
 const running=await host(['127.0.0.1']),held:ReturnType<typeof hold>[]=[];
 const attempts=async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n);
 try{
  for(let i=0;i<4;i++)held.push(hold(running.port,`198.18.2.${i+1}`));
  await until(async()=>await attempts()===8);
  const rejected=hold(running.port,'198.18.2.5');held.push(rejected);
  const response=await Promise.race([rejected.result,delay(2000).then(()=>assert.fail('the fifth submit waited for an unfinished body'))]);
  assert.deepEqual([response.status,response.headers['retry-after'],JSON.parse(response.body)],[503,'1',{error:'temporarily_unavailable'}]);
  assert.equal(await attempts(),8);
  assert.equal((await ready(running.port,'198.18.2.6')).status,200);
 }finally{for(const h of held)h.abort();await running.close();}
});
test('a declared oversized submit is refused before its body finishes',async()=>{
 const running=await host(),pending=hold(running.port,'198.18.6.1',undefined,{'content-length':'2113537'});
 try{
  const response=await Promise.race([pending.result,delay(2000).then(()=>assert.fail('oversized submit waited for its body'))]);
  assert.deepEqual([response.status,JSON.parse(response.body).error],[413,'translation_job_too_large']);
  assert.equal((await send(running.port,'/api/installations/translation-status','{}')).status,401);
 }finally{pending.abort();await running.close();}
});
test('admission groups IPv4 mapped addresses and IPv6 prefixes; untrusted forwarding cannot bypass it',async()=>{
 for(const [trusted,first,second] of [
  [true,'::ffff:198.18.3.1','198.18.3.1'],[true,'2001:db8:1:2::1','2001:db8:1:2::2'],[false,'198.18.3.1','198.18.3.2'],
 ] as const){
  await db.pool.query('TRUNCATE account_rate_limits');
  const running=await host(trusted?['127.0.0.1']:[]),held=hold(running.port,first);
  try{
   await until(async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n)===2);
   const response=await send(running.port,'/api/installations/translation-submit','{}',second);
   assert.deepEqual([response.status,response.headers['retry-after']],[503,'1']);
  }finally{held.abort();await running.close();}
 }
});
test('successful replies and route refusals release the submit place',async()=>{
 const running=await host();
 try{
  const v=await venue(),body=JSON.stringify(v.submit(jobText([item('product:1')])));
  for(const [text,headers,status] of [['{',{},400],['{}',{},401],[body,{origin},403],[body,{'content-type':'text/plain'},415]] as const){
   const refused=await send(running.port,'/api/installations/translation-submit',text,undefined,headers);
   assert.equal(refused.status,status,refused.body);
   assert.equal((await send(running.port,'/api/installations/translation-submit',body)).status,200);
  }
 }finally{await running.close();}
});
test('malformed forwarded addresses are refused before reading and do not spend submit places',async()=>{
 const running=await host(['127.0.0.1']);
 try{
  for(const from of ['', '198.18.4.1, 198.18.4.2', 'invalid']){
   const pending=hold(running.port,from);
   try{assert.equal((await pending.result).status,400);}finally{pending.abort();}
  }
  const v=await venue();
  assert.equal((await send(running.port,'/api/installations/translation-submit',JSON.stringify(v.submit(jobText([item('product:1')]))),'198.18.4.3')).status,200);
 }finally{await running.close();}
});
test('the submit reader accepts completion at 59,999 ms and refuses an unfinished body at 60,000 ms',async t=>{
 const v=await venue();
 t.mock.timers.enable({apis:['setTimeout']});
 for(const expired of [false,true]){
  let controller:ReadableStreamDefaultController<Uint8Array>,started!:()=>void;
  const reading=new Promise<void>(resolve=>{started=resolve;});
  const stream=new ReadableStream<Uint8Array>({start(c){controller=c;},pull(){started();}},{highWaterMark:0});
  const request=new Request(`${origin}/api/installations/translation-submit`,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit);
  const pending=app.request(request,undefined,{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
  await reading;
  t.mock.timers.tick(expired?60000:59999);
  if(!expired){controller!.enqueue(Buffer.from(JSON.stringify(v.submit(jobText([item('product:1')])))));controller!.close();}
  const response=await pending;
  assert.equal(response.status,expired?408:200,await response.text());
 }
});
test('eight stalled ordinary requests cannot spend the separate submit allowance',async()=>{
 const running=await host(['127.0.0.1']),held:ReturnType<typeof hold>[]=[];
 try{
  for(let i=0;i<8;i++)held.push(hold(running.port,`198.18.5.${i+1}`,'/api/installations/translation-status'));
  await until(async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n)===16);
  assert.equal((await send(running.port,'/api/installations/translation-status','{}','198.18.5.9')).status,503);
  const v=await venue();
  assert.equal((await send(running.port,'/api/installations/translation-submit',JSON.stringify(v.submit(jobText([item('product:1')]))),'198.18.5.10')).status,200);
 }finally{for(const h of held)h.abort();await running.close();}
});
test('status, collect and release still enforce a five-second body deadline when translation is on',async t=>{
 const v=await venue();
 t.mock.timers.enable({apis:['setTimeout']});
 for(const action of ['translation-status','translation-collect','translation-release']){
  let started!:()=>void;
  const reading=new Promise<void>(resolve=>{started=resolve;});
  const stream=new ReadableStream<Uint8Array>({pull(){started();}},{highWaterMark:0});
  const request=new Request(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit);
  const pending=app.request(request,undefined,{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
  await reading;t.mock.timers.tick(5000);
  assert.deepEqual(await error(await pending),[408,'invalid_input']);
 }
});
test('encoded submit aliases share the same address place as the literal route',async()=>{
 const running=await host(['127.0.0.1']),held=hold(running.port,'198.18.7.1','/api/installations/translation%2Dsubmit');
 try{
  await until(async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n)===2);
  for(const path of ['/api/installations/translation-submit','/api/installations/translation%2dsubmit','/%61pi/installations/%74ranslation-submit']){
   const response=await send(running.port,path,'{}','198.18.7.1');
   assert.deepEqual([response.status,response.headers['retry-after']],[503,'1'],path);
  }
 }finally{held.abort();await running.close();}
});
test('encoded submit aliases cannot bypass four places or spend ordinary admission',async()=>{
 const running=await host(['127.0.0.1']),held:ReturnType<typeof hold>[]=[];
 try{
  for(let i=0;i<4;i++)held.push(hold(running.port,`198.18.8.${i+1}`,'/api/installations/translation%2Dsubmit'));
  await until(async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n)===8);
  const fifth=hold(running.port,'198.18.8.5','/api/installations/%74ranslation-submit');held.push(fifth);
  const response=await Promise.race([fifth.result,delay(2000).then(()=>assert.fail('an encoded fifth submit waited for its body'))]);
  assert.deepEqual([response.status,response.headers['retry-after']],[503,'1']);
  assert.equal((await ready(running.port,'198.18.8.6')).status,200);
 }finally{for(const h of held)h.abort();await running.close();}
});
