import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkFirstPass,extractJson,firstPassInput,mergeReview,parseJob,ReplyError,reviewInput} from '../src/index.ts';
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{},missing:['ca','es','en']},
  {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],houseStyle:[]}));
const reason=(name:string)=>(e:unknown)=>e instanceof ReplyError&&e.reason===name;
test('a fenced reply with prose around it, and a bare reply, both parse; no JSON is a reply error',()=>{
 assert.deepEqual(extractJson('Here you go:\n```json\n{"products": []}\n```\nDone.'),{products:[]});
 assert.deepEqual(extractJson('{"products": [1]}'),{products:[1]});
 assert.throws(()=>extractJson('sorry, I cannot'),reason('no_json'));
});
test('the first pass keeps only missing languages, trimmed, and never a given name',()=>{
 const reply=JSON.stringify({products:[{id:'p01',ca:' Gildes ',es:'Gildas',en:'Gildas',placeholder:false,corrections:[]},
  {id:'p02',ca:'Doble',es:'Doble',en:'Rewritten double',fr:'Double',corrections:[{field:'internal',wrong:'DOBLE',right:'DOBLE'},{field:'en',wrong:'Double',right:'Double shot'},{field:'xx',wrong:'a',right:'b'}]},{id:'p99',ca:'x'}]});
 const got=checkFirstPass(job,job.items,reply);
 assert.deepEqual(got[0],{ref:'product:1',names:{ca:'Gildes',es:'Gildas',en:'Gildas'},placeholder:false,corrections:[]});
 assert.deepEqual(got[1],{ref:'variant:2',names:{ca:'Doble',es:'Doble'},placeholder:false,corrections:[{field:'en',wrong:'Double',right:'Double shot'}]});
});
test('a missing product, a duplicate, or an empty missing language fails the check; a placeholder may be empty',()=>{
 const one=(p:object)=>JSON.stringify({products:[{id:'p01',ca:'a',es:'b',en:'c'},p]});
 assert.throws(()=>checkFirstPass(job,job.items,JSON.stringify({products:[{id:'p01',ca:'a',es:'b',en:'c'}]})),reason('missing'));
 assert.throws(()=>checkFirstPass(job,job.items,one({id:'p01',ca:'a',es:'b',en:'c'})),reason('duplicate'));
 assert.throws(()=>checkFirstPass(job,job.items,one({id:'p02',ca:'',es:'b'})),reason('empty'));
 assert.throws(()=>checkFirstPass(job,job.items,'{"items":[]}'),reason('shape'));
 assert.deepEqual(checkFirstPass(job,job.items,one({id:'p02',placeholder:true}))[1]!.names,{});
});
test('the review merge applies only allowed changes and counts the rest',()=>{
 const first=checkFirstPass(job,job.items,JSON.stringify({products:[{id:'p01',placeholder:true},{id:'p02',ca:'Doble',es:'Doble',en:'Double'}]}));
 const changes={changes:[{id:'p02',language:'ca',name:'Doble (cervesa)'},{id:'p02',language:'en',name:'Not allowed: given'},
  {id:'p01',language:'ca',name:'Placeholder'},{id:'p99',language:'ca',name:'Nobody'},{id:'p02',language:'xx',name:'No such'},
  {id:'p02',language:'es',name:'  '},{id:'p02',language:'ca',name:'Second change'}]};
 const merged=mergeReview(job,job.items,first,JSON.stringify(changes));
 assert.deepEqual(merged.results[1]!.names,{ca:'Doble (cervesa)',es:'Doble'});
 assert.deepEqual(merged.results[0]!.names,{});
 assert.deepEqual([merged.applied,merged.dropped],[1,6]);
 assert.equal(first[1]!.names.ca,'Doble');
 assert.throws(()=>mergeReview(job,job.items,first,'{"nope":[]}'),reason('shape'));
});
test('a context head needs no entry, gets no result and takes no review change',()=>{
 const ctx=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{ca:'Gildes',es:'Gildas',en:'Gildas'},missing:[]},
   {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],houseStyle:[]}));
 const first=checkFirstPass(ctx,ctx.items,JSON.stringify({products:[{id:'p02',ca:'Doble',es:'Doble'}]}));
 assert.deepEqual(first.map(r=>r.ref),['variant:2']);
 assert.deepEqual(checkFirstPass(ctx,ctx.items,JSON.stringify({products:[{id:'p01',ca:'Rewritten'},{id:'p02',ca:'Doble',es:'Doble'}]})).map(r=>r.ref),['variant:2']);
 const merged=mergeReview(ctx,ctx.items,first,JSON.stringify({changes:[{id:'p01',language:'ca',name:'Gildes noves'}]}));
 assert.deepEqual([merged.applied,merged.dropped],[0,1]);
 assert.ok(!reviewInput(ctx,ctx.items,first)!.includes('GUILDAS'));
 assert.ok(firstPassInput(ctx,ctx.items).includes('"partOf": "p01"'));
});
test('malformed review IDs and languages are dropped and counted without interrupting valid changes',()=>{
 const first=checkFirstPass(job,job.items,JSON.stringify({products:[{id:'p01',ca:'Gildes',es:'Gildas',en:'Gildas'},{id:'p02',ca:'Doble',es:'Doble'}]}));
 const reply=JSON.stringify({changes:[null,[],3,{id:{toString:null},language:'ca',name:'Invalid ID'},
  {id:'p02',language:{toString:null},name:'Invalid language'},{id:'p02',language:'ca',name:' Doble cervesa '}]});
 const merged=mergeReview(job,job.items,first,reply);
 assert.deepEqual([merged.applied,merged.dropped],[1,5]);
 assert.deepEqual(merged.results[1]!.names,{ca:'Doble cervesa',es:'Doble'});
});
const translated=()=>[{id:'p01',ca:'Gildes',es:'Gildas',en:'Gildas'},{id:'p02',ca:'Doble',es:'Doble'}];
test('invalid JSON and non-list envelopes use the reply error reason rather than raw parser errors',()=>{
 for(const text of ['{"products":','```json\n{"products":]\n```','[1,2]', '', 'null'])assert.throws(()=>extractJson(text),reason('no_json'));
 assert.deepEqual(extractJson('Prose {"products":[]} end.'),{products:[]});
 for(const envelope of [null,[],3,{}, {products:{}},{products:null}]){
  const expected=envelope===null||Array.isArray(envelope)||typeof envelope==='number'?'no_json':'shape';
  assert.throws(()=>checkFirstPass(job,job.items,JSON.stringify(envelope)),reason(expected));
  assert.throws(()=>mergeReview(job,job.items,[],JSON.stringify(envelope)),reason(expected));
 }
 const error=new ReplyError('missing');assert.equal(error.message,'missing');assert.equal(error.name,'ReplyError');
});
test('only known string IDs are checked, while output keeps batch order rather than reply order',()=>{
 const rows=translated();
 const got=checkFirstPass(job,job.items,JSON.stringify({products:[null,[],false,{id:1},{id:'p99'},{id:'p99'},rows[1],rows[0]]}));
 assert.deepEqual(got.map(r=>r.ref),['product:1','variant:2']);
 assert.deepEqual(got[1]!.names,{ca:'Doble',es:'Doble'});
});
test('required names must be text, nonempty after trimming and no longer than 500 UTF-16 units',()=>{
 for(const value of [undefined,null,23,false,{},[],' \n\t ', 'a'.repeat(501),'🍺'.repeat(251)]){
  const rows=translated();rows[1]={...rows[1]!,ca:value} as typeof rows[number];
  assert.throws(()=>checkFirstPass(job,job.items,JSON.stringify({products:rows})),reason('empty'));
 }
 for(const value of ['a'.repeat(500),'🍺'.repeat(250)]){
  const rows=translated();rows[1]={...rows[1]!,ca:' '+value+' '};
  assert.equal(checkFirstPass(job,job.items,JSON.stringify({products:rows}))[1]!.names.ca,value);
 }
});
test('only the boolean true marks a placeholder and no generated names survive on it',()=>{
 for(const value of [false,'true',1,null]){
  assert.throws(()=>checkFirstPass(job,job.items,JSON.stringify({products:[translated()[0],{id:'p02',placeholder:value}]})),reason('empty'));
 }
 const got=checkFirstPass(job,job.items,JSON.stringify({products:[translated()[0],{id:'p02',placeholder:true,ca:'Invented',es:'Invented',corrections:[{field:'internal',wrong:'DOBLE',right:'DOBLE!'}]}]}))[1]!;
 assert.deepEqual(got,{ref:'variant:2',names:{},placeholder:true,corrections:[{field:'internal',wrong:'DOBLE',right:'DOBLE!'}]});
});
test('corrections reject malformed fields, empty or oversized text, and unchanged spelling',()=>{
 const good={field:'internal',wrong:' GUILDA ',right:' GILDA '};
 const fixes=[null,[],3,{...good,field:1},{...good,field:'fr'},{...good,wrong:null},{...good,right:{}},
  {...good,wrong:'  '},{...good,right:'  '},{...good,wrong:'a'.repeat(501)},{...good,right:'b'.repeat(501)},
  {...good,wrong:'a',right:' a '},good,{field:'en',wrong:'a'.repeat(500),right:'b'.repeat(500)}];
 const got=checkFirstPass(job,job.items,JSON.stringify({products:[{...translated()[0],corrections:fixes},translated()[1]]}))[0]!;
 assert.deepEqual(got.corrections,[{field:'internal',wrong:'GUILDA',right:'GILDA'},{field:'en',wrong:'a'.repeat(500),right:'b'.repeat(500)}]);
 for(const value of [undefined,null,{},'fix'])assert.deepEqual(checkFirstPass(job,job.items,JSON.stringify({products:[{...translated()[0],corrections:value},translated()[1]]}))[0]!.corrections,[]);
});
test('only the first ten valid corrections are retained',()=>{
 const fixes=Array.from({length:12},(_,i)=>({field:'internal',wrong:`WRONG ${i}`,right:`Right ${i}`}));
 const got=checkFirstPass(job,job.items,JSON.stringify({products:[{...translated()[0],corrections:[null,...fixes]},translated()[1]]}))[0]!;
 assert.equal(got.corrections.length,10);
 assert.deepEqual(got.corrections[0],{field:'internal',wrong:'WRONG 0',right:'Right 0'});
 assert.deepEqual(got.corrections[9],{field:'internal',wrong:'WRONG 9',right:'Right 9'});
});
test('review rejects oversized names, accepts the boundary and preserves corrections and the first-pass input',()=>{
 const first=checkFirstPass(job,job.items,JSON.stringify({products:[{...translated()[0],corrections:[{field:'internal',wrong:'GUILDA',right:'GILDA'}]},translated()[1]]}));
 const before=structuredClone(first);
 const merged=mergeReview(job,job.items,first,JSON.stringify({changes:[{id:'p01',language:'ca',name:'a'.repeat(501)},
  {id:'p01',language:'es',name:null},{id:'p01',language:'ca',name:' '+ 'a'.repeat(500)+' '},
  {id:'p01',language:'ca',name:'Second'},{id:'p02',language:'ca',name:'🍺'.repeat(250)}]}));
 assert.deepEqual([merged.applied,merged.dropped],[2,3]);
 assert.equal(merged.results[0]!.names.ca,'a'.repeat(500));
 assert.equal(merged.results[1]!.names.ca,'🍺'.repeat(250));
 assert.deepEqual(merged.results[0]!.corrections,[{field:'internal',wrong:'GUILDA',right:'GILDA'}]);
 assert.deepEqual(first,before);
 merged.results[0]!.corrections[0]!.right='Changed';
 merged.results[0]!.names.es='Changed';
 assert.deepEqual(first,before);
});
test('review preserves a given name even if an internal caller also labels that language missing',()=>{
 const batch=[{...job.items[1]!,missing:['ca','es','en']}];
 const first=[{ref:'variant:2',names:{ca:'Doble',es:'Doble'},placeholder:false,corrections:[]}];
 const merged=mergeReview(job,batch,first,JSON.stringify({changes:[{id:'p01',language:'en',name:'Rewritten'}]}));
 assert.deepEqual(merged,{results:first,applied:0,dropped:1});
 assert.deepEqual(mergeReview(job,job.items,[],JSON.stringify({changes:[{id:'p02',language:'ca',name:'No result'}]})),{results:[],applied:0,dropped:1});
});
