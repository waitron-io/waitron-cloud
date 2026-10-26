import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request} from 'node:http';
import {randomBytes,webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createPublicGate} from '../src/public-gate.ts';

async function fixture(){
 const gate=createPublicGate({key:randomBytes(32),difficulty:8,routes:()=>[{publicHostname:'sol.example.test',staffHostname:'staff.sol.example.test',address:'127.0.0.1',port:1}]});
 const server=createServer(gate.handle);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const bound=server.address();assert.ok(bound&&typeof bound!=='string');
 const send=(path:string,headers:Record<string,string>={},method='GET',body?:string)=>new Promise<{status:number;headers:Record<string,unknown>;body:string}>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:bound.port,path,method,headers:{host:'sol.example.test','x-waitron-sni':'sol.example.test','x-waitron-client-ip':'192.0.2.2',...headers}},res=>{
   let body='';res.on('data',chunk=>body+=chunk);res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body}));
  });req.on('error',reject);req.end(body);
 });
 return {send,gate,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

const refusals:{status:number;path:string;headers?:Record<string,string>;method?:string;body?:string;en:RegExp;es:RegExp}[]=[
 {status:421,path:'/public/availability',headers:{'x-waitron-sni':'unknown.example.test'},en:/venue link/i,es:/enlace del local/i},
 {status:413,path:'/public/availability',headers:{upgrade:'websocket'},en:/request is too large/i,es:/solicitud es demasiado grande/i},
 {status:404,path:'/private',en:/page was not found/i,es:/página no existe/i},
 {status:405,path:'/public/availability',method:'POST',en:/open the venue/i,es:/abre la página/i},
 {status:400,path:'/_cloud/solve',method:'POST',body:'{',en:/browser check/i,es:/comprobación del navegador/i},
 {status:403,path:'/_cloud/solve',method:'POST',body:'{"challenge":"forged","nonce":0}',en:/browser check/i,es:/comprobación del navegador/i},
];
for(const item of refusals)test(`direct navigation gives bilingual recovery guidance for ${item.status}`,async()=>{
 const f=await fixture();try{
  const reply=await f.send(item.path,{accept:'text/html','sec-fetch-mode':'navigate',...item.headers},item.method,item.body);
  assert.equal(reply.status,item.status);assert.match(String(reply.headers['content-type']),/^text\/html/);
  assert.match(reply.body,item.en);assert.match(reply.body,item.es);assert.match(reply.body,/<span lang="es">/);
  assert.equal(reply.headers['cache-control'],'no-store');assert.equal(reply.headers['x-content-type-options'],'nosniff');
  assert.doesNotMatch(reply.body,/unknown\.example|staff\.sol|192\.0\.2|forged/);
  assert.equal(reply.headers['set-cookie'],undefined);assert.equal(f.gate.stats().forwarded,0);
  if(item.status===421){assert.doesNotMatch(reply.body,/<a /,'untrusted hosts must not receive a retry link');}
  else assert.match(reply.body,/<a href="\/public\/availability">/);
 }finally{await f.close();}
});

test('rate refusal guides a visitor to wait without changing the shared request quota',async()=>{
 const f=await fixture();try{
  for(let i=0;i<120;i++)assert.equal((await f.send('/_cloud/challenge')).status,200);
  const reply=await f.send('/public/availability',{accept:'text/html','sec-fetch-mode':'navigate'});
  assert.equal(reply.status,429);assert.match(reply.body,/wait a minute/i);assert.match(reply.body,/espera un minuto/i);
  assert.equal(f.gate.stats().forwarded,0);
 }finally{await f.close();}
});

for(const item of refusals)test(`background rejection ${item.status} stays empty`,async()=>{
 const f=await fixture();try{
  const reply=await f.send(item.path,{accept:'*/*','sec-fetch-mode':'cors',...item.headers},item.method,item.body);
  assert.equal(reply.status,item.status);assert.equal(reply.body,'');assert.equal(reply.headers['set-cookie'],undefined);
 }finally{await f.close();}
});

test('HTML fallback handles older browsers while background HTML requests stay empty',async()=>{
 const f=await fixture();try{
  const navigation=await f.send('/missing',{accept:'text/html'});
  assert.equal(navigation.status,404);assert.match(navigation.body,/Open the venue/);
  const backgrounds:Record<string,string>[]=[{accept:'text/html','sec-fetch-mode':'cors'},{accept:'application/json'}];
  for(const headers of backgrounds){
   const background=await f.send('/missing',headers);
   assert.equal(background.status,404);assert.equal(background.body,'');
  }
  const large=await f.send('/_cloud/solve',{accept:'text/html','sec-fetch-mode':'navigate'},'POST','x'.repeat(2049));
  assert.equal(large.status,413);assert.match(large.body,/request is too large/);
 }finally{await f.close();}
});

test('exhausted worker time budget reports a terminal failure instead of searching indefinitely',async()=>{
 const f=await fixture();try{
  const {body}=await f.send('/_cloud/worker.js');const messages:unknown[]=[];let ticks=0,hashes=0;
  const context={TextEncoder,DataView,performance:{now:()=>ticks++*10000},crypto:{subtle:{digest:async()=>{hashes++;return new Uint8Array([255,255,255,255]).buffer;}}},postMessage:(value:unknown)=>messages.push(value),onmessage:undefined as undefined|((event:{data:unknown})=>Promise<void>)};
  runInNewContext(body,context);
  // A second digest stalls, so only a worker that stops at its own budget can finish.
  context.crypto.subtle.digest=async()=>{hashes++;if(hashes>2)return new Promise<ArrayBuffer>(()=>{});return new Uint8Array([255,255,255,255]).buffer;};
  await Promise.race([context.onmessage!({data:{challenge:'clock-bound',difficulty:22}}),new Promise<void>(resolve=>setTimeout(resolve,50))]);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{error:'exhausted'}]);assert.ok(hashes<=2);
 }finally{await f.close();}
});

test('worker returns real SHA-256 proof unchanged on success',async()=>{
 const f=await fixture();try{
  const {body}=await f.send('/_cloud/worker.js');const messages:{challenge:string;nonce:number}[]=[];
  const context={TextEncoder,DataView,performance,crypto:webcrypto,postMessage:(value:{challenge:string;nonce:number})=>messages.push(value),onmessage:undefined as undefined|((event:{data:unknown})=>Promise<void>)};
  runInNewContext(body,context);await context.onmessage!({data:{challenge:'real-proof',difficulty:8}});
  assert.equal(messages.length,1);assert.equal(messages[0]!.challenge,'real-proof');
  const digest=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(`real-proof:${messages[0]!.nonce}`));
  assert.ok(new DataView(digest).getUint32(0)<2**24);
 }finally{await f.close();}
});

test('unsupported worker hashing reports failure rather than silently rejecting its event',async()=>{
 const f=await fixture();try{
  const {body}=await f.send('/_cloud/worker.js');const messages:unknown[]=[];
  const context={TextEncoder,DataView,performance,crypto:{subtle:{digest:async()=>{throw new Error('not supported');}}},postMessage:(value:unknown)=>messages.push(value),onmessage:undefined as undefined|((event:{data:unknown})=>Promise<void>)};
  runInNewContext(body,context);await context.onmessage!({data:{challenge:'unsupported',difficulty:8}});
  assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{error:'unsupported'}]);
 }finally{await f.close();}
});

test('a browser that cannot create a worker gets browser guidance and no proof submission',async()=>{
 const f=await fixture();try{
  const {body}=await f.send('/_cloud/challenge.js');const paragraph={innerHTML:''},requests:string[]=[];
  await runInNewContext(body,{
   document:{querySelector:()=>paragraph},AbortController,setTimeout:()=>1,clearTimeout:()=>{},
   Worker:class {constructor(){throw new Error('worker blocked');}},
   fetch:async(path:string)=>{requests.push(path);return Response.json({challenge:'blocked-worker',difficulty:8});},
  });
  assert.match(paragraph.innerHTML,/another browser/i);assert.match(paragraph.innerHTML,/otro navegador/i);
  assert.deepEqual(requests,['/_cloud/challenge']);
 }finally{await f.close();}
});

test('without JavaScript the challenge page provides a way forward',async()=>{
 const f=await fixture();try{
  const {status,body}=await f.send('/public/availability',{accept:'text/html'});
  assert.equal(status,403);assert.match(body,/<noscript>.*JavaScript.*<span lang="es">.*JavaScript.*<\/span>.*<\/noscript>/);
 }finally{await f.close();}
});

test('missing request-cancellation support gives browser guidance without starting a request',async()=>{
 const f=await fixture();try{
  const {body}=await f.send('/_cloud/challenge.js');const paragraph={innerHTML:''},requests:string[]=[];
  await runInNewContext(body,{
   document:{querySelector:()=>paragraph},setTimeout:()=>1,clearTimeout:()=>{},
   Worker:class {},fetch:async(path:string)=>{requests.push(path);return Response.json({});},
  });
  assert.match(paragraph.innerHTML,/another browser/i);assert.match(paragraph.innerHTML,/otro navegador/i);assert.deepEqual(requests,[]);
 }finally{await f.close();}
});

for(const stall of ['challenge','worker','solve','worker-error','exhausted','unsupported'])test(`browser check ends ${stall} without accepting a late proof`,async()=>{
 const f=await fixture();try{
  const {body}=await f.send('/_cloud/challenge.js');
  const paragraph={innerHTML:'Please wait a moment.'},redirects:string[]=[],requests:string[]=[],timers=new Map<number,()=>void>();
  let worker:{onmessage?:({data}:{data:unknown})=>Promise<void>;onerror?:()=>void;terminate:()=>void}|undefined,terminated=false;
  let finishChallenge:undefined|((value:Response)=>void),finishSolve:undefined|((value:Response)=>void);
  const pending=runInNewContext(body,{
   document:{querySelector:()=>paragraph},location:{replace:(path:string)=>redirects.push(path)},AbortController,
   setTimeout:(callback:()=>void,ms:number)=>{assert.ok(ms>0&&ms<=30000);timers.set(1,callback);return 1;},clearTimeout:(id:number)=>timers.delete(id),
   Worker:class {constructor(){worker=this;}postMessage(){}terminate(){terminated=true;}},
   fetch:async(path:string)=>{requests.push(path);if(path==='/_cloud/challenge'){
    if(stall==='challenge')return new Promise<Response>(resolve=>{finishChallenge=resolve;});
    return Response.json({challenge:'late-proof',difficulty:8});
   }return new Promise<Response>(resolve=>{finishSolve=resolve;});},
  });
  if(stall!=='challenge')await pending;
  let solve:Promise<void>|undefined;
  if(stall==='solve')solve=worker!.onmessage!({data:{challenge:'late-proof',nonce:1}});
  if(stall==='worker-error')worker!.onerror!();
  else if(stall==='exhausted'||stall==='unsupported'){void worker!.onmessage!({data:{error:stall}});await Promise.resolve();}
  else for(const callback of [...timers.values()])callback();
  assert.match(paragraph.innerHTML,/another browser/i);assert.match(paragraph.innerHTML,/otro navegador/i);
  assert.doesNotMatch(paragraph.innerHTML,/Please wait a moment/);assert.deepEqual(redirects,[]);assert.equal(timers.size,0);
  if(worker)assert.equal(terminated,true);
  if(finishChallenge){finishChallenge(Response.json({challenge:'late-proof',difficulty:8}));await pending;assert.equal(worker,undefined);}
  if(finishSolve){finishSolve(new Response(null,{status:204}));await solve;}
  if(worker){void worker.onmessage!({data:{challenge:'late-proof',nonce:1}});await Promise.resolve();}
  assert.deepEqual(redirects,[]);assert.equal(requests.length,stall==='solve'?2:1,'late messages cannot submit another proof');
 }finally{await f.close();}
});
