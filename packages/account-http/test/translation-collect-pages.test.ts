import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {after,before,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {maxCollectBytes,TranslationMachine,type CollectPage,type ItemResult} from '@waitron-cloud/translation';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {connectedVenue,database,giveConsent,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='http://localhost',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,addresses=0;
const config=()=>({portalOrigin:origin,production:false,rateKey:db.rateKey,trustedProxyIps:[] as string[]});
before(async()=>{db=await database();app=createAccountApp({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:config()});});after(async()=>db?.close());
async function venue(){const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);await giveConsent(db,v);return {...v,ip:`203.0.113.${++addresses}`};}
type Venue=Awaited<ReturnType<typeof venue>>;
const proof=(v:Venue,action:string,body:unknown)=>v.proof(action,body,randomUUID(),v.lease);
const post=(v:Venue,action:string,body:unknown)=>app.request(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(proof(v,action,body))},{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
async function submit(v:Venue,items:object[],languages=['ca','es']){
 const text=JSON.stringify({version:1,country:'ES',languages:{default:languages[0],enabled:languages},items,houseStyle:[]});assert(Buffer.byteLength(text)<=1048576);
 const e=v.submit(text);return new TranslationMachine(db.pool,issuer,origin).execute('translation-submit',{payload:e.payload,signature:e.signature},text) as Promise<{jobId:string}>;
}
const item=(ref:string,missing=['ca','es'])=>({ref,kind:'product',family:ref,category:'BAR',staffName:'Café',existing:{},missing});
const result=(ref:string):ItemResult=>({ref,names:{ca:'Cafè 😀',es:'Café "\\\u0000\ud800'},placeholder:false,corrections:[{field:'internal',wrong:'CAFE',right:'CAFÉ'}]});
async function finish(jobId:string,results:ItemResult[],failed:string[]=[]){
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[jobId,JSON.stringify({0:{results,failed}})]);
 await db.pool.query("UPDATE translation_jobs SET state=$2,done=$3,failed=$4,reason=$5,finished_at=clock_timestamp() WHERE id=$1",[jobId,failed.length?'partly_done':'done',results.length,failed.length,failed.length?'provider_failed':null]);
}
const error=async(r:Response)=>[r.status,(await r.json() as {error:string}).error];
// These checks catch dropping cursors, validating them before ownership, and formatting after sizing.
test('HTTP collect preserves filtered order, arbitrary cursors, repeated pages, and ownership-first refusals',async()=>{
 const v=await venue(),w=await venue(),items=[{...item('head',[]),existing:{ca:'Cap',es:'Cabeza'}},{...item('a'),kind:'variant',family:'head'},item('b'),item('c')];
 const {jobId}=await submit(v,items);const a=result('a'),c={...result('c'),placeholder:true};await finish(jobId,[c,a],['b']);
 const first={version:1,jobId,state:'partly_done',results:[a,c],failed:['b'],nextCursor:null};
 assert.deepEqual(await (await post(v,'translation-collect',{version:1,jobId})).json(),first);
 assert.deepEqual(await (await post(v,'translation-collect',{version:1,jobId,cursor:0})).json(),first);
 assert.deepEqual(await (await post(v,'translation-collect',{version:1,jobId,cursor:1})).json(),{...first,results:[c]});
 assert.deepEqual(await (await post(v,'translation-collect',{version:1,jobId,cursor:2})).json(),{...first,results:[c],failed:[]});
 const invalid=[-1,0.5,Number.MAX_SAFE_INTEGER+1,'1',null,true,3,99,{},[]];
 for(const cursor of invalid){
  assert.deepEqual(await error(await post(v,'translation-collect',{version:1,jobId,cursor})),[400,'invalid_request']);
  assert.deepEqual(await error(await post(w,'translation-collect',{version:1,jobId,cursor})),[404,'translation_job_not_found']);
 }
 for(const action of ['translation-status','translation-release'])assert.deepEqual(await error(await post(v,action,{version:1,jobId,cursor:0})),[400,'invalid_request']);
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,1);
});
function wire(port:number,envelope:unknown){return new Promise<{status:number;body:Buffer;headers:import('node:http').IncomingHttpHeaders}>((resolve,reject)=>{
 const req=request({hostname:'127.0.0.1',port,path:'/api/installations/translation-collect',method:'POST',headers:{host:'localhost','content-type':'application/json'}},res=>{
  const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks),headers:res.headers}));
 });req.on('error',reject);req.end(JSON.stringify(envelope));
});}
test('real listener emits the exact compact sized pages, preserves all text, and retains data until release',async()=>{
 const v=await venue(),languages=['en','es','ca','fr','de','it','pt','nl','sv','da','fi','pl','cs','sk','hu','ro','el','tr','ja','zh'];
 const items=Array.from({length:400},(_,i)=>item(`ref:${i}`,languages)),{jobId}=await submit(v,items,languages);
 const results:ItemResult[]=items.map(({ref})=>({ref,names:Object.fromEntries(languages.map(tag=>[tag,'\u0000'.repeat(500)])),placeholder:false,
  corrections:Array.from({length:10},()=>({field:'internal',wrong:'\\'.repeat(500),right:'\ud800'.repeat(500)}))}));
 await finish(jobId,[...results].reverse());
 assert(Buffer.byteLength(JSON.stringify({version:1,jobId,state:'done',results,failed:[],nextCursor:null}))>16777216);
 const running=await startAccountServer({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:config(),port:0});
 try{
  const address=running.server.address();assert(address&&typeof address!=='string');
  let cursor:number|null=0,pages=0;const seen:string[]=[];
  do{
   const body={version:1,jobId,cursor},envelope=proof(v,'translation-collect',body);
   const response=await wire(address.port,envelope);assert.equal(response.status,200);assert(response.body.byteLength<=16777216);
   const page=JSON.parse(response.body.toString('utf8')) as CollectPage;
   assert.equal(response.body.toString('utf8'),JSON.stringify(page));assert.equal(response.headers['cache-control'],'no-store');
   assert.deepEqual(Object.keys(page),['version','jobId','state','results','failed','nextCursor']);
   assert.deepEqual(page.results,results.slice(cursor,cursor+page.results.length));assert.deepEqual(page.failed,[]);assert(page.results.length>0);
   const route=await post(v,'translation-collect',body);assert.equal(route.status,200);assert.equal(await route.text(),response.body.toString('utf8'));
   if(page.nextCursor!==null){
    assert.equal(page.nextCursor,cursor+page.results.length);
    const extended={...page,results:[...page.results,results[page.nextCursor]],nextCursor:page.nextCursor+1===results.length?null:page.nextCursor+1};
    assert(Buffer.byteLength(JSON.stringify(extended))>maxCollectBytes);
   }
   if(pages===0){assert.notEqual(page.nextCursor,null);const retry=await wire(address.port,envelope);assert(retry.body.equals(response.body));}
   seen.push(...page.results.map(i=>i.ref));cursor=page.nextCursor;pages++;
  }while(cursor!==null);
  assert(pages>1);assert.deepEqual(seen,items.map(i=>i.ref));
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,1);
  assert.equal((await post(v,'translation-release',{version:1,jobId})).status,200);
  const expired=await wire(address.port,proof(v,'translation-collect',{version:1,jobId,cursor:0}));
  assert.equal(expired.status,410);assert.deepEqual(JSON.parse(expired.body.toString()),{error:'translation_expired'});
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,0);
 }finally{await running.close();}
});

test('real listener accepts an exact 16 MiB page and splits the same legal outcomes one byte over',async()=>{
 const v=await venue(),languages=['en','es','ca','fr','de','it','pt','nl','sv','da','fi','pl','cs','sk','hu','ro','el','tr','ja','zh'];
 const items=Array.from({length:300},(_,i)=>item(`boundary:${i}`,languages)),{jobId}=await submit(v,items,languages);
 const results:ItemResult[]=items.map(({ref})=>({ref,names:Object.fromEntries(languages.map(tag=>[tag,'A'])),placeholder:false,corrections:[]}));
 const whole={version:1,jobId,state:'done',results,failed:[],nextCursor:null};
 let left=16777216-Buffer.byteLength(JSON.stringify(whole));
 for(const entry of results)for(const tag of languages){
  if(!left)break;
  const add=Math.min(left,2999),nuls=Math.floor((add+1)/6),ascii=add+1-nuls*6;
  entry.names[tag]='\u0000'.repeat(nuls)+'A'.repeat(ascii);assert(entry.names[tag]!.length<=500);left-=add;
 }
 assert.equal(left,0);assert.equal(Buffer.byteLength(JSON.stringify(whole)),16777216);await finish(jobId,results);
 const running=await startAccountServer({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:config(),port:0});
 try{
  const address=running.server.address();assert(address&&typeof address!=='string');
  const envelope=proof(v,'translation-collect',{version:1,jobId}),exact=await wire(address.port,envelope);
  assert.equal(exact.status,200);assert.equal(exact.body.byteLength,16777216);assert.equal(exact.body.toString('utf8'),JSON.stringify(whole));
  const last=results.at(-1)!;assert.equal(last.names.zh,'A');last.names.zh='AA';
  assert.equal(Buffer.byteLength(JSON.stringify(whole)),16777217);await finish(jobId,results);
  const split=await wire(address.port,envelope);assert.equal(split.status,200);assert(split.body.byteLength<=16777216);
  const page=JSON.parse(split.body.toString('utf8')) as CollectPage;
  assert.equal(page.nextCursor,299);assert.deepEqual(page.results,results.slice(0,299));
  const tail=await wire(address.port,proof(v,'translation-collect',{version:1,jobId,cursor:299}));assert.equal(tail.status,200);
  assert.deepEqual(JSON.parse(tail.body.toString('utf8')),{version:1,jobId,state:'done',results:[last],failed:[],nextCursor:null});
 }finally{await running.close();}
});
