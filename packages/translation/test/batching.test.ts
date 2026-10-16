import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planBatches,type JobItem} from '../src/index.ts';
const item=(ref:string,family=ref,category:string|null='A'):JobItem=>({ref,kind:family===ref?'product':'variant',family,category,staffName:ref.toUpperCase(),existing:{},missing:['ca']});
test('a family is never split across batches',()=>{
 const items=[...Array.from({length:85},(_,i)=>item(`p${i}`)),item('head'),...Array.from({length:9},(_,i)=>item(`v${i}`,'head'))];
 const batches=planBatches(items);
 const holder=batches.filter(b=>b.some(i=>i.family==='head'));
 assert.equal(holder.length,1);assert.equal(holder[0]!.filter(i=>i.family==='head').length,10);
});
test('a family over 90 items stays whole in its own batch',()=>{
 const big=[item('head'),...Array.from({length:119},(_,i)=>item(`v${i}`,'head'))];
 const batches=planBatches([item('a'),...big,item('b')]);
 assert.deepEqual(batches.map(b=>b.length),[1,120,1]);
});
test('a category that fits in a batch is never split, and categories keep their order',()=>{
 const items=[...Array.from({length:50},(_,i)=>item(`a${i}`,`a${i}`,'A')),...Array.from({length:50},(_,i)=>item(`b${i}`,`b${i}`,'B')),...Array.from({length:50},(_,i)=>item(`c${i}`,`c${i}`,'C'))];
 assert.deepEqual(planBatches(items).map(b=>[...new Set(b.map(i=>i.category))]),[['A'],['B'],['C']]);
});
test('items of one category sent apart are batched together, and a family follows its head category',()=>{
 const items=[item('x1','x1','A'),item('y1','y1','B'),item('x2','x2','A'),item('v','x1','B')];
 assert.deepEqual(planBatches(items).map(b=>b.map(i=>i.ref)),[['x1','v','x2','y1']]);
});
test('1,000 items in ten categories of 100 make eleven batches of 90 and one of 10',()=>{
 const items=Array.from({length:1000},(_,i)=>item(`p${i}`,`p${i}`,`C${Math.floor(i/100)}`));
 const batches=planBatches(items);
 assert.deepEqual(batches.map(b=>b.length),[...Array(11).fill(90),10]);
 assert.deepEqual(batches.flat().map(i=>i.ref),items.map(i=>i.ref));
});
test('a context head with nothing missing counts in its batch and stays with its family',()=>{
 const head={...item('head'),missing:[]};
 const items=[...Array.from({length:85},(_,i)=>item(`p${i}`)),head,...Array.from({length:9},(_,i)=>item(`v${i}`,'head'))];
 const holder=planBatches(items).filter(b=>b.some(i=>i.family==='head'));
 assert.equal(holder.length,1);assert.ok(holder[0]!.includes(head));
});
test('a null category is its own group',()=>{
 assert.deepEqual(planBatches([item('a','a',null),item('b','b','B')]).flat().map(i=>i.category),[null,'B']);
});
test('a late family head chooses the category without reordering its members',()=>{
 const items=[item('v','head','B'),item('b','b','B'),item('head','head','A'),item('a','a','A')];
 assert.deepEqual(planBatches(items).map(b=>b.map(i=>i.ref)),[['v','head','a','b']]);
});
test('an absent head uses the first member category',()=>{
 const items=[item('v1','head','A'),item('b','b','B'),item('v2','head','B'),item('a','a','A')];
 assert.deepEqual(planBatches(items).map(b=>b.map(i=>i.ref)),[['v1','v2','a','b']]);
});
test('a small category moves whole after a large category leaves a short batch',()=>{
 const first=Array.from({length:170},(_,i)=>item(`a${i}`,`a${i}`,'A'));
 const second=Array.from({length:20},(_,i)=>item(`b${i}`,`b${i}`,'B'));
 const batches=planBatches([...first,...second]);
 assert.deepEqual(batches.map(b=>b.length),[90,80,20]);
 assert.deepEqual(batches.map(b=>[...new Set(b.map(i=>i.category))]),[['A'],['A'],['B']]);
});
test('a family of exactly ninety fills one batch and leaves surrounding items intact',()=>{
 const family=[item('head'),...Array.from({length:89},(_,i)=>item(`v${i}`,'head'))];
 assert.deepEqual(planBatches([item('before'),...family,item('after')]).map(b=>b.length),[1,90,1]);
});
test('null categories group apart from named categories',()=>{
 assert.deepEqual(planBatches([item('n1','n1',null),item('b','b','B'),item('n2','n2',null)]).map(b=>b.map(i=>i.ref)),[['n1','n2','b']]);
});
test('batching accepts no items and preserves the supplied item objects and input order',()=>{
 assert.deepEqual(planBatches([]),[]);
 const items=Object.freeze([Object.freeze(item('a')),Object.freeze(item('b'))]);
 const batches=planBatches(items);
 assert.notEqual(batches[0],items);assert.equal(batches[0]![0],items[0]);assert.equal(batches[0]![1],items[1]);
 assert.deepEqual(items.map(i=>i.ref),['a','b']);
});
