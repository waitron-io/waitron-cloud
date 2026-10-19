import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {test,type TestContext} from 'node:test';
import {transaction} from '@waitron-cloud/registration';
import {TranslationMachine,type ItemResult} from '../../../packages/translation/src/index.ts';
import {connectedVenue,giveConsent,readyForTranslation} from '../../../packages/translation/test/fixtures.ts';
import {startPortalFixture} from './fixtures.ts';

async function fixture(t:TestContext,options?:{pageBytes?:number}){
 const f=await startPortalFixture(undefined,undefined,undefined,undefined,options);
 let closed=false;const close=async()=>{if(!closed){closed=true;await f.close();}};t.after(close);
 return {...f,close};
}
async function job(f:Awaited<ReturnType<typeof fixture>>){
 const v=await connectedVenue(f.db,f.issuer,f.origin);await readyForTranslation(f.db,v);await giveConsent(f.db,v);
 const items=['a','b','c'].map(ref=>({ref,kind:'product',family:ref,category:null,staffName:'Proof coffee',existing:{},missing:['en']}));
 const text=JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es','en']},houseStyle:[],items});
 const signed=v.submit(text),machine=new TranslationMachine(f.db.pool,f.issuer,f.origin);
 const {jobId}=await machine.execute('translation-submit',{payload:signed.payload,signature:signed.signature},text) as {jobId:string};
 const results:ItemResult[]=items.map(({ref})=>({ref,names:{en:'x'.repeat(180)},placeholder:false,corrections:[]}));
 await f.db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[jobId,JSON.stringify({0:{results,failed:[]}})]);
 await f.db.pool.query("UPDATE translation_jobs SET state='done',done=3,finished_at=clock_timestamp() WHERE id=$1",[jobId]);
 const send=(action:string,cursor?:number)=>wire(f.origin,action,v.proof(action,{version:1,jobId,...(cursor===undefined?{}:{cursor})},randomUUID(),v.lease));
 const bodyCount=async()=>(await f.db.pool.query('SELECT count(*)::int AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n as number;
 return {v,jobId,results,send,bodyCount};
}
function wire(origin:string,action:string,envelope:unknown){
 return new Promise<{status:number;body:string}>((resolve,reject)=>{
  let bytes=0,wireBytes=0;const req=request(new URL(`/api/installations/${action}`,origin),{method:'POST',agent:false,headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000)},res=>{
   const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;chunks.push(chunk);});res.on('error',error=>reject(Object.assign(error,{bytes,wireBytes})));
   res.on('end',()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString('utf8')}));
  });req.on('socket',socket=>socket.on('data',(chunk:Buffer)=>{wireBytes+=chunk.length;}));req.on('error',error=>reject(Object.assign(error,{bytes,wireBytes})));req.end(JSON.stringify(envelope));
 });
}
const lost=(error:unknown)=>{const fault=error as {bytes:number;wireBytes:number;code:string};assert.equal(fault.bytes,0);assert.equal(fault.wireBytes,0);assert.equal(fault.code,'ECONNRESET');return true;};

test('translation remains off by default',async t=>{
 const f=await fixture(t),j=await job(f);assert.equal(f.translation,undefined);
 for(const action of ['translation-submit','translation-status','translation-collect','translation-release'])assert.deepEqual(await j.send(action),{status:503,body:'{"error":"temporarily_unavailable"}'});
 const enabled=await fixture(t,{});assert(enabled.translation,'explicit fixture opt-in creates translation controls');
});
test('two fixture budgets are independent',async t=>{
 const small=await fixture(t,{pageBytes:512}),normal=await fixture(t,{});assert(small.translation);assert(normal.translation);
 const a=await job(small),b=await job(normal);
 for(const cursor of [0,1,2]){
  const reply=await a.send('translation-collect',cursor);assert.equal(reply.status,200);assert(Buffer.byteLength(reply.body)<=512);
  assert.deepEqual(JSON.parse(reply.body),{version:1,jobId:a.jobId,state:'done',results:[a.results[cursor]],failed:[],nextCursor:cursor===2?null:cursor+1});
 }
 const whole=await b.send('translation-collect',0);assert.equal(whole.status,200);assert(Buffer.byteLength(whole.body)>512);
 assert.deepEqual(JSON.parse(whole.body).results,b.results);assert.equal(JSON.parse(whole.body).nextCursor,null);
 assert.deepEqual(small.translation.events.filter(e=>e.kind==='request').map(e=>e.cursor),[0,1,2]);
});
test('lost reply follows real execution and sends no complete body',async t=>{
 const f=await fixture(t,{pageBytes:512});assert(f.translation);const control=f.translation,j=await job(f);
 // Split the genuine handler's response to exercise both write and end on an actual socket.
 control.server!.on('request',(req,res)=>{
  if(req.url!=='/api/installations/translation-collect')return;
  const end=res.end;res.end=function(chunk?:unknown){const text=String(chunk??''),half=Math.floor(text.length/2);res.write(text.slice(0,half));setTimeout(()=>Reflect.apply(end,res,[text.slice(half)]),20);return res;} as typeof res.end;
 });
 const loss=control.loseReply('translation-collect',1);
 const first=await j.send('translation-collect',0);assert.equal(first.status,200);assert.equal(JSON.parse(first.body).nextCursor,1);
 await assert.rejects(j.send('translation-collect',1),lost);const dropped=await loss;
 assert.equal(dropped.status,200);assert.deepEqual(JSON.parse(dropped.body).results,[j.results[1]]);assert.equal(await j.bodyCount(),1);
 const retry=await j.send('translation-collect',1);assert.deepEqual(retry,dropped);
 assert.deepEqual(control.events.map(e=>[e.kind,e.cursor]),[['request',0],['reply',0],['request',1],['lost',1],['request',1],['reply',1]]);
 for(const event of control.events){assert.equal(event.jobId,j.jobId);assert(!('payload' in event));assert(!('signature' in event));}
});
test('pause holds no transaction and cancellation prevents execution',async t=>{
 const f=await fixture(t,{pageBytes:512});assert(f.translation);const j=await job(f),gate=f.translation.pauseCollect(1);
 const pending=j.send('translation-collect',1);assert.deepEqual(await gate.entered,{jobId:j.jobId,cursor:1});
 await transaction(f.db.pool,async c=>{
  await c.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE NOWAIT',[j.v.installationId]);
  await c.query('SELECT id FROM translation_jobs WHERE id=$1 FOR UPDATE NOWAIT',[j.jobId]);
 });
 gate.cancel();gate.resume();assert.deepEqual(await pending,{status:503,body:'{"error":"temporarily_unavailable"}'});
 assert.equal(await j.bodyCount(),1);assert.equal((await j.send('translation-collect',1)).status,200);
 const next=f.translation.pauseCollect(2),held=j.send('translation-collect',2);await next.entered;
 next.resume();assert.equal(JSON.parse((await held).body).nextCursor,null);
});
test('release check precedes commit and runs again on retry',async t=>{
 const f=await fixture(t,{pageBytes:512});assert(f.translation);const control=f.translation,j=await job(f),counts:number[]=[];
 let enter!:()=>void,resume!:()=>void;const entered=new Promise<void>(r=>enter=r),hold=new Promise<void>(r=>resume=r);
 const remove=control.beforeRelease(async id=>{assert.equal(id,j.jobId);counts.push(await j.bodyCount());enter();await hold;});
 const loss=control.loseReply('translation-release'),pending=j.send('translation-release');const rejected=assert.rejects(pending,lost);
 await entered;assert.deepEqual(counts,[1]);assert.equal(await j.bodyCount(),1);resume();await rejected;
 assert.equal((await loss).status,200);assert.equal(await j.bodyCount(),0);
 const repeated=await j.send('translation-release');assert.equal(repeated.status,200);assert.deepEqual(JSON.parse(repeated.body),{version:1,jobId:j.jobId,state:'collected'});assert.deepEqual(counts,[1,0]);remove();
 control.beforeRelease(async()=>{throw new Error('controlled_release_check_failed');});
 const failure=assert.rejects(control.failure,/controlled_release_check_failed/);assert.equal((await j.send('translation-release')).status,503);await failure;
});
test('close cancels pending interceptors',async t=>{
 const f=await fixture(t,{pageBytes:512});assert(f.translation);const control=f.translation,j=await job(f);
 const gate=control.pauseCollect(1),unused=control.pauseCollect(9),loss=control.loseReply('translation-release');
 const pending=j.send('translation-collect',1);const cancelled=assert.rejects(pending);await gate.entered;
 const rejectedLoss=assert.rejects(loss,/translation_fixture_closed/),rejectedGate=assert.rejects(unused.entered,/translation_fixture_cancelled/);
 await f.close();await Promise.all([cancelled,rejectedLoss,rejectedGate]);gate.resume();
 assert.equal(control.events.filter(e=>e.kind==='reply'&&e.status===200).length,0);
 assert.throws(()=>control.pauseCollect(0),/translation_fixture_closed/);
});
