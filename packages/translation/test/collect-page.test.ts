import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPage,maxCollectBytes,type ItemResult} from '../src/collect-page.ts';
const jobId='00000000-0000-4000-8000-000000000001';
const result=(ref:string,text='Cafè'):ItemResult=>({ref,names:{ca:text},placeholder:false,corrections:[]});
const item=(ref:string,missing=['ca'])=>({ref,missing});
const page=(items:{ref:string;missing:string[]}[],batches:Record<string,{results:ItemResult[];failed:string[]}>,cursor?:unknown)=>collectPage(jobId,'partly_done',items,batches,cursor);
const code=(error:unknown)=>{assert.equal((error as {code?:string}).code,'invalid_request');return true;};
test('explicit small limit pages unchanged items and defaults still use 16MiB',()=>{
 const items=['a','b','c'].map(ref=>item(ref,['en'])),results=items.map(({ref})=>({...result(ref),names:{en:'x'.repeat(180)}}));
 const batches={0:{results,failed:[]}};
 const whole={version:1,jobId,state:'done' as const,results,failed:[],nextCursor:null};
 assert.deepEqual(collectPage(jobId,'done',items,batches),whole);
 assert.deepEqual(collectPage(jobId,'done',items,batches,0,16777216),whole);
 for(const cursor of [0,1,2]){
  const actual=collectPage(jobId,'done',items,batches,cursor,512);
  assert.deepEqual(actual,{...whole,results:[results[cursor]],nextCursor:cursor===2?null:cursor+1});
  assert(Buffer.byteLength(JSON.stringify(actual))<=512);
  if(cursor<2)assert(Buffer.byteLength(JSON.stringify({...actual,results:results.slice(cursor,cursor+2),nextCursor:cursor===1?null:2}))>512);
 }
 assert.throws(()=>collectPage(jobId,'done',items,batches,0,100),/translation_outcome_too_large/);
});
test('invalid internal limits cannot enlarge or disable the bound',()=>{
 for(const limit of [0,-1,0.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,16777217]){
  assert.throws(()=>collectPage(jobId,'done',[item('a')],{0:{results:[result('a')],failed:[]}},0,limit),/^Error: translation_collect_limit_invalid$/);
 }
});
test('collect restores filtered submit order across reverse batches and keeps all outcome text',()=>{
 const first={...result('p1','😀"\\\u0000\ud800'),placeholder:true,corrections:[{field:'internal',wrong:'Cafe',right:'Café'}]};
 const items=[item('context',[]),item('p1'),item('p2'),item('p3')];
 const batches={1:{results:[result('p3')],failed:['p2']},0:{results:[first],failed:[]}};
 assert.deepEqual(page(items,batches),{version:1,jobId,state:'partly_done',results:[first,result('p3')],failed:['p2'],nextCursor:null});
 assert.deepEqual(page(items,batches,0),page(items,batches));
 assert.deepEqual(page(items,batches,1),{version:1,jobId,state:'partly_done',results:[result('p3')],failed:['p2'],nextCursor:null});
 assert.deepEqual(page(items,batches,2).results,[result('p3')]);
 for(const cursor of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'0',null,true,3,4])assert.throws(()=>page(items,batches,cursor),code);
});
test('missing, duplicate, foreign and context outcomes cannot silently disappear',()=>{
 const items=[item('context',[]),item('p1'),item('p2')];
 for(const batches of [
  {0:{results:[result('p1')],failed:[]}},
  {0:{results:[result('p1'),result('p1')],failed:['p2']}},
  {0:{results:[result('p1')],failed:['p1','p2']}},
  {0:{results:[result('p1'),result('foreign')],failed:['p2']}},
  {0:{results:[result('p1'),result('foreign')],failed:[]}},
  {0:{results:[result('p1'),result('context')],failed:[]}},
  {0:{results:[result('p1'),result('context')],failed:['p2']}},
 ])assert.throws(()=>page(items,batches),/translation_outcomes_invalid/);
 assert.throws(()=>page([item('p1'),item('p1')],{0:{results:[result('p1')],failed:[]}}),/translation_outcomes_invalid/);
});
test('the conservative singleton allowance with long fields, 20 names and ten corrections fits unchanged',()=>{
 // The bound deliberately allows more tag text than Intl may recognize.
 const tag='en-'+('v0000-'.repeat(74999))+'v0000',names=Object.fromEntries([tag,'en',...Array.from({length:18},(_,i)=>`l${i}`)].map(key=>[key,'\u0000'.repeat(500)]));
 const value={ref:'p1',names,placeholder:false,corrections:Array.from({length:10},()=>({field:tag,wrong:'\ud800'.repeat(500),right:'😀'.repeat(250)}))};
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'en',enabled:Object.keys(names)},houseStyle:[],items:[{...item('p1',Object.keys(names)),kind:'product',family:'p1',category:null,staffName:'Coffee',existing:{}}]});
 assert(Buffer.byteLength(body)<=1048576);
 const actual=page([item('p1')],{0:{results:[value],failed:[]}});
 assert(Buffer.byteLength(JSON.stringify(actual))<=16777216);assert.deepEqual(actual.results,[value]);
 // Assign a whole submit budget to each repeated field to exercise the conservative proof itself.
 const upperTag='a'.repeat(1048576),upper={...value,
  names:Object.fromEntries([upperTag,...Object.keys(names).slice(1)].map(key=>[key,'\u0000'.repeat(500)])),
  corrections:Array.from({length:10},()=>({field:upperTag,wrong:'\ud800'.repeat(500),right:'😀'.repeat(250)}))};
 const upperPage=page([item('p1')],{0:{results:[upper],failed:[]}});
 assert(Buffer.byteLength(JSON.stringify(upperPage))<=11720640);assert.deepEqual(upperPage.results,[upper]);
});
test('a legal sub-MiB job produces maximal bounded pages with no lost or repeated refs',()=>{
 const languages=['en','es','ca','fr','de','it','pt','nl','sv','da','fi','pl','cs','sk','hu','ro','el','tr','ja','zh'],items=Array.from({length:1000},(_,i)=>item(`p${i}`,languages));
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'en',enabled:languages},houseStyle:[],items:items.map(i=>({...i,kind:'product',family:i.ref,category:null,staffName:'Coffee',existing:{}}))});
 assert(Buffer.byteLength(body)<=1048576);
 const results=items.filter((_,i)=>i%3!==1).map(i=>({...result(i.ref),names:Number(i.ref.slice(1))%3===0?{}:Object.fromEntries(languages.map(l=>[l,'\u0000'.repeat(500)])),placeholder:Number(i.ref.slice(1))%3===0}));
 const failed=items.filter((_,i)=>i%3===1).map(i=>i.ref);
 const batches={3:{results:[...results].reverse(),failed:[...failed].reverse()}};
 assert(Buffer.byteLength(JSON.stringify({results,failed}))>16777216);
 let cursor=0;const seen:string[]=[];let pages=0;
 do{
  const actual=page(items,batches,cursor),end=actual.nextCursor??items.length;
  assert(Buffer.byteLength(JSON.stringify(actual))<=16777216);
  assert.deepEqual(actual,page(items,batches,cursor));
  const refs=new Set([...actual.results.map(r=>r.ref),...actual.failed]);
  assert.deepEqual(items.slice(cursor,end).map(i=>i.ref),items.slice(cursor,end).filter(i=>refs.has(i.ref)).map(i=>i.ref));
  assert.equal(refs.size,end-cursor);seen.push(...items.slice(cursor,end).map(i=>i.ref));
  assert.deepEqual(actual.results,results.filter(r=>refs.has(r.ref))); // expected results start in submit order
  if(actual.nextCursor!==null){
   const next=items[end]!.ref,nextResult=results.find(r=>r.ref===next);
   const larger={...actual,results:nextResult?[...actual.results,nextResult]:actual.results,failed:nextResult?actual.failed:[...actual.failed,next],nextCursor:end+1===items.length?null:end+1};
   assert(Buffer.byteLength(JSON.stringify(larger))>16777216);
  }
  pages++;cursor=end;
 }while(cursor<items.length);
 assert(pages>1);assert.deepEqual(seen,items.map(i=>i.ref));assert.equal(new Set(seen).size,1000);
});
test('the full envelope, UTF-8 text and actual continuation fit at the byte boundary',()=>{
 const first=result('p1','é😀"\\\u0000\ud800'),second=result('p2');
 const items=[item('p1'),item('p2')];
 const single={version:1,jobId,state:'partly_done',results:[first],failed:[],nextCursor:1};
 // Fill the first outcome to the wire limit; this isolates serialization from input validation.
 first.names.padding='a'.repeat(16777216-Buffer.byteLength(JSON.stringify(single))-13);
 assert.equal(Buffer.byteLength(JSON.stringify(single)),16777216);
 const batches={0:{results:[first,second],failed:[]}};
 const exact=page(items,batches);assert.equal(Buffer.byteLength(JSON.stringify(exact)),16777216);assert.equal(exact.nextCursor,1);
 first.names.padding+='a';assert.throws(()=>page(items,batches),/translation_outcome_too_large/);
 const last=page(items,batches,1);assert.equal(last.nextCursor,null);assert.deepEqual(last.results,[second]);
 assert.equal(maxCollectBytes,16777216);
});
for(const kind of ['results','failed'] as const)test(`comma bytes between ${kind} stay inside the full page limit`,()=>{
 const first=result('p1'),results=kind==='results'?[first,result('p2'),result('p3')]:[first];
 const failed=kind==='failed'?['p2','p3','p4']:[];
 const items=(kind==='results'?['p1','p2','p3']:['p1','p2','p3','p4']).map(ref=>item(ref));
 const prefix={version:1,jobId,state:'partly_done',results:kind==='results'?results.slice(0,2):results,failed:failed.slice(0,2),nextCursor:kind==='results'?2:3};
 // Synthetic padding isolates punctuation accounting from the separate accepted-item bounds.
 first.names.padding='a'.repeat(16777216-Buffer.byteLength(JSON.stringify(prefix))-13);
 assert.equal(Buffer.byteLength(JSON.stringify(prefix)),16777216);
 const batches={0:{results,failed}},exact=page(items,batches);
 assert.equal(Buffer.byteLength(JSON.stringify(exact)),16777216);assert.equal(exact.nextCursor,kind==='results'?2:3);
 first.names.padding+='a';
 const over=page(items,batches);assert(Buffer.byteLength(JSON.stringify(over))<=16777216);
 assert.equal(over.nextCursor,kind==='results'?1:2);
});
test('the final null continuation is included in an exact-limit singleton',()=>{
 const value=result('p1'),wire={version:1,jobId,state:'partly_done',results:[value],failed:[],nextCursor:null};
 value.names.padding='a'.repeat(16777216-Buffer.byteLength(JSON.stringify(wire))-13);
 assert.equal(Buffer.byteLength(JSON.stringify(wire)),16777216);
 const items=[item('p1')],batches={0:{results:[value],failed:[]}};
 assert.equal(Buffer.byteLength(JSON.stringify(page(items,batches))),16777216);
 assert.equal(page(items,batches).nextCursor,null);
 value.names.padding+='a';assert.throws(()=>page(items,batches),/translation_outcome_too_large/);
});
