import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectPage,maxCollectBytes,type ItemResult} from '../src/collect-page.ts';
const jobId='00000000-0000-4000-8000-000000000001';
const result=(ref:string,text='Cafè'):ItemResult=>({ref,names:{ca:text},placeholder:false,corrections:[]});
const item=(ref:string,missing=['ca'])=>({ref,missing});
const page=(items:{ref:string;missing:string[]}[],batches:Record<string,{results:ItemResult[];failed:string[]}>,cursor?:unknown)=>collectPage(jobId,'partly_done',items,batches,cursor);
const code=(error:unknown)=>{assert.equal((error as {code?:string}).code,'invalid_request');return true;};
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
test('a legal singleton with long language fields, 20 names and ten corrections fits unchanged',()=>{
 const tag='a'.repeat(450000),names=Object.fromEntries([tag,...Array.from({length:19},(_,i)=>`l${i}`)].map(key=>[key,'\u0000'.repeat(500)]));
 const value={ref:'p1',names,placeholder:false,corrections:Array.from({length:10},()=>({field:tag,wrong:'\ud800'.repeat(500),right:'😀'.repeat(250)}))};
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'en',enabled:['en',...Object.keys(names)]},houseStyle:[],items:[{...item('p1',Object.keys(names)),kind:'product',family:'p1',category:null,staffName:'Coffee',existing:{}}]});
 assert(Buffer.byteLength(body)<=1048576);
 const actual=page([item('p1')],{0:{results:[value],failed:[]}});
 assert(Buffer.byteLength(JSON.stringify(actual))<=16777216);assert.deepEqual(actual.results,[value]);
});
test('a legal sub-MiB job produces maximal bounded pages with no lost or repeated refs',()=>{
 const languages=Array.from({length:20},(_,i)=>`l${i}`),items=Array.from({length:1000},(_,i)=>item(`p${i}`,languages));
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'en',enabled:['en',...languages]},houseStyle:[],items:items.map(i=>({...i,kind:'product',family:i.ref,category:null,staffName:'Coffee',existing:{}}))});
 assert(Buffer.byteLength(body)<=1048576);
 const results=items.filter((_,i)=>i%3!==1).map(i=>({...result(i.ref),names:Object.fromEntries(languages.map(l=>[l,'\u0000'.repeat(500)])),placeholder:Number(i.ref.slice(1))%3===0}));
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
