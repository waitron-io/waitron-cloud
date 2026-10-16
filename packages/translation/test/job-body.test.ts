import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseJob,TranslationError,writtenItems} from '../src/index.ts';
const valid={version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'variant:812',kind:'variant',family:'product:640',category:'TAP BEERS',staffName:'PINTA',existing:{en:'Pint'},missing:['ca','es']}],
 houseStyle:[{kind:'product',staffName:'CARAJILLO',names:{ca:'Cigaló',es:'Carajillo'}}]};
const refused=(e:unknown)=>e instanceof TranslationError&&e.code==='invalid_request';
test('the contract example parses',()=>{assert.equal(parseJob(JSON.stringify(valid)).items[0]!.ref,'variant:812');});
test('every broken field is an invalid request',()=>{
 const bad=[
  {...valid,version:2},{...valid,country:'Spain'},{...valid,country:'ZZ'},{...valid,extra:1},{...valid,languages:{default:'fr',enabled:['ca']}},
  {...valid,languages:{default:'ca',enabled:['ca','ca']}},{...valid,languages:{default:'ca',enabled:['ca','xx']}},{...valid,items:[]},
  {...valid,items:[{...valid.items[0],kind:'dish'}]},{...valid,items:[{...valid.items[0],missing:['en']}]},
  {...valid,items:[{...valid.items[0],missing:['fr']}]},{...valid,items:[{...valid.items[0],missing:[]}]},
  {...valid,items:[{...valid.items[0],existing:{fr:'x'}}]},{...valid,items:[{...valid.items[0],staffName:''}]},
  {...valid,items:[{...valid.items[0],staffName:'x'.repeat(501)}]},{...valid,items:[{...valid.items[0],ref:'r'.repeat(129)}]},
  {...valid,items:[valid.items[0],valid.items[0]]},{...valid,houseStyle:Array(301).fill(valid.houseStyle[0])},
  {...valid,houseStyle:undefined},{...valid,items:[{...valid.items[0],category:5}]},
  {...valid,items:[{ref:'list:1',kind:'option_list',family:'list:1',category:'TAP BEERS',staffName:'SIZES',existing:{},missing:['ca']}]},
 ];
 for(const b of bad)assert.throws(()=>parseJob(JSON.stringify(b)),refused,JSON.stringify(b).slice(0,120));
 assert.throws(()=>parseJob('not json'),refused);
});
test('only a product or a variant carries a category; every other kind sends null',()=>{
 const list={ref:'list:1',kind:'option_list',family:'list:1',category:null,staffName:'SIZES',existing:{},missing:['ca']};
 assert.equal(parseJob(JSON.stringify({...valid,items:[list]})).items[0]!.category,null);
 assert.equal(parseJob(JSON.stringify({...valid,items:[{...valid.items[0],category:null}]})).items[0]!.category,null);
});
test('a context head with nothing missing is accepted only beside a member it heads',()=>{
 const head={ref:'product:640',kind:'product',family:'product:640',category:'TAP BEERS',staffName:'CANYA',existing:{ca:'Canya',es:'Caña',en:'Half pint'},missing:[]};
 const job=parseJob(JSON.stringify({...valid,items:[head,valid.items[0]]}));
 assert.deepEqual(writtenItems(job).map(i=>i.ref),['variant:812']);
 for(const items of [[head],[{...head,ref:'product:9',family:'product:9'},valid.items[0]],[{...valid.items[0],missing:[]},{...valid.items[0],ref:'variant:813'}]])
  assert.throws(()=>parseJob(JSON.stringify({...valid,items})),refused,JSON.stringify(items).slice(0,120));
});
test('more than 1,000 items is too large, and exactly 1,000 is accepted',()=>{
 const many=(n:number)=>({...valid,items:Array.from({length:n},(_,i)=>({...valid.items[0],ref:`r${i}`,family:`r${i}`}))});
 assert.equal(parseJob(JSON.stringify(many(1000))).items.length,1000);
 assert.throws(()=>parseJob(JSON.stringify(many(1001))),(e:unknown)=>e instanceof TranslationError&&e.code==='job_too_large');
});
test('objects have exact field sets at every level',()=>{
 const invalid:unknown[]=[null,[],1,{}, {...valid,languages:null},{...valid,languages:[]},
  {...valid,languages:{...valid.languages,extra:1}},
  {...valid,items:null},{...valid,items:[null]},{...valid,items:[[]]},
  {...valid,items:[{...valid.items[0],extra:1}]},
  {...valid,houseStyle:null},{...valid,houseStyle:[null]},
  {...valid,houseStyle:[{...valid.houseStyle[0],extra:1}]}];
 for(const field of Object.keys(valid)){
  const body:Record<string,unknown>={...valid};delete body[field];invalid.push(body);
 }
 for(const field of Object.keys(valid.items[0]!)){
  const entry:Record<string,unknown>={...valid.items[0]};delete entry[field];invalid.push({...valid,items:[entry]});
 }
 for(const field of Object.keys(valid.houseStyle[0]!)){
  const example:Record<string,unknown>={...valid.houseStyle[0]};delete example[field];invalid.push({...valid,houseStyle:[example]});
 }
 for(const body of invalid)assert.throws(()=>parseJob(JSON.stringify(body)),refused);
});
test('language sets keep the accepted tags and enforce one to twenty distinct enabled languages',()=>{
 const tags=['ca','es','en','fr','de','it','pt-BR','nl','pl','ar','zh-Hant','ja','ko','el','uk','ro','sv','da','fi','tr'];
 const body={...valid,languages:{default:'pt-BR',enabled:tags}};
 assert.deepEqual(parseJob(JSON.stringify(body)).languages,{default:'pt-BR',enabled:tags});
 const one={...valid,languages:{default:'en',enabled:['en']},items:[{...valid.items[0],existing:{},missing:['en']}],houseStyle:[]};
 assert.deepEqual(parseJob(JSON.stringify(one)).languages,{default:'en',enabled:['en']});
 for(const enabled of [[],[...tags,'cs'],['und'],['xx'],['EN'],['en_XX'],['en-abcdefghi'],['en-x-private'],[3]])
  assert.throws(()=>parseJob(JSON.stringify({...valid,languages:{default:enabled[0],enabled}})),refused);
 for(const languages of [{default:3,enabled:['en']},{enabled:['en']},{default:'en'},'en'])
  assert.throws(()=>parseJob(JSON.stringify({...valid,languages})),refused);
});
test('country names a recognized uppercase two-letter region',()=>{
 for(const country of ['US','GB','JP'])assert.equal(parseJob(JSON.stringify({...valid,country})).country,country);
 for(const country of ['es','ZZ','AA','ESP','E',null,42])assert.throws(()=>parseJob(JSON.stringify({...valid,country})),refused);
});
test('opaque references and text keep exact length boundaries and contents',()=>{
 const entry={...valid.items[0],ref:'r'.repeat(128),family:'f'.repeat(128),staffName:'n'.repeat(500),category:'c'.repeat(500),existing:{en:'e'.repeat(500)}};
 assert.deepEqual(parseJob(JSON.stringify({...valid,items:[entry]})).items,[entry]);
 for(const field of ['ref','family','staffName','category'] as const){
  for(const value of ['',null,4,'x'.repeat(field==='ref'||field==='family'?129:501)]){
   if(field==='category'&&value===null)continue;
   assert.throws(()=>parseJob(JSON.stringify({...valid,items:[{...entry,[field]:value}]})),refused,field);
  }
 }
 const staffName='Cafè 🍵 "\\\u0000\ud800';
 assert.equal(parseJob(JSON.stringify({...valid,items:[{...entry,staffName}]})).items[0]!.staffName,staffName);
});
test('every non-product kind requires a null category',()=>{
 for(const kind of ['product','variant','option_list','option_label','extra_list','menu','section','included_menu','unit']){
  const entry={...valid.items[0],kind,category:null};
  assert.equal(parseJob(JSON.stringify({...valid,items:[entry]})).items[0]!.kind,kind);
  if(kind!=='product'&&kind!=='variant')assert.throws(()=>parseJob(JSON.stringify({...valid,items:[{...entry,category:'A'}]})),refused);
 }
});
test('existing names and missing languages obey the requested language set',()=>{
 for(const existing of [null,[],1,{en:''},{en:'x'.repeat(501)},{en:1},{xx:'Name'}])
  assert.throws(()=>parseJob(JSON.stringify({...valid,items:[{...valid.items[0],existing}]})),refused);
 for(const missing of [null,'ca',[1],['ca','ca'],['ca','en'],['xx']])
  assert.throws(()=>parseJob(JSON.stringify({...valid,items:[{...valid.items[0],missing}]})),refused);
});
test('house style keeps zero through three hundred complete examples',()=>{
 assert.deepEqual(parseJob(JSON.stringify({...valid,houseStyle:[]})).houseStyle,[]);
 const example={kind:'unit',staffName:'x'.repeat(500),names:{en:'y'.repeat(500)}};
 assert.deepEqual(parseJob(JSON.stringify({...valid,houseStyle:Array(300).fill(example)})).houseStyle,Array(300).fill(example));
 for(const patch of [{kind:'dish'},{staffName:''},{staffName:'x'.repeat(501)},{staffName:1},{names:null},{names:[]},{names:{fr:'x'}},{names:{en:''}},{names:{en:'x'.repeat(501)}},{names:{en:2}}])
  assert.throws(()=>parseJob(JSON.stringify({...valid,houseStyle:[{...example,...patch}]})),refused);
});
test('context heads stay in model input while only written items count',()=>{
 const items=[{ref:'list:1',kind:'option_list',family:'list:1',category:null,staffName:'SIZE',existing:{en:'Size'},missing:[]},
  {ref:'label:2',kind:'option_label',family:'list:1',category:null,staffName:'SMALL',existing:{},missing:['en']},
  {ref:'menu:3',kind:'menu',family:'menu:3',category:null,staffName:'LUNCH',existing:{},missing:[]},
  {ref:'section:4',kind:'section',family:'menu:3',category:null,staffName:'DESSERT',existing:{},missing:['ca']}];
 const job=parseJob(JSON.stringify({...valid,items,houseStyle:[]}));
 assert.deepEqual(job.items,items);assert.deepEqual(writtenItems(job).map(i=>i.ref),['label:2','section:4']);
 assert.equal(writtenItems(job).length,2);
 const orphan={...items[2],ref:'orphan',family:'orphan'};
 assert.throws(()=>parseJob(JSON.stringify({...valid,items:[...items,orphan]})),refused);
});
