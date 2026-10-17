import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {batchIds,firstPassInput,firstPassInstructions,parseJob,reviewInput,reviewInstructions,type ItemResult} from '../src/index.ts';
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{},missing:['ca','es','en']},
  {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],
 houseStyle:[{kind:'product',staffName:'CARAJILLO',names:{ca:'Cigaló',es:'Carajillo'}}]}));
test('both model instructions match the approved trial templates with only the authorised substitutions',()=>{
 assert.equal(firstPassInstructions(job),readFileSync(new URL('./fixtures/first-pass.txt',import.meta.url),'utf8'));
 assert.equal(reviewInstructions(job),readFileSync(new URL('./fixtures/review.txt',import.meta.url),'utf8'));
});
test('the first-pass instructions are the fourth prompt with the venue filled in',()=>{
 const text=firstPassInstructions(job);
 assert.ok(text.startsWith("You write customer-facing names for a venue's menu in Spain.\nThe venue's default customer language is Catalan (ca). The other customer languages are Spanish (es) and English (en).\n"));
 assert.ok(text.includes("4. Write each language as a native speaker would. Each language's names use that language's own vocabulary, not another\n   language's words written in its spelling."));
 assert.ok(!/Catalan names use|Spanish names use|café-bar/.test(text));
 for(const example of ['patates braves','truita de patates','brunch','poke bowl','SPECIAL 7'])assert.ok(text.includes(example),example);
 assert.ok(text.includes('2. A dish or drink that has a standard name in a language is called by that name in that language, the way a local\n'));
 assert.ok(text.includes('   to "internal", so staff can fix the internal name too. List only real spelling fixes, not translations,\n   capitalisation or dropped prices.\n'));
 assert.ok(text.includes('{"products": [{"id": "p01", "ca": "...", "es": "...", "en": "...", "placeholder": false,'));
 assert.ok(text.includes('set "placeholder": true and leave all\n   its names empty.'));
 assert.ok(text.endsWith('"corrections" is an empty list when there is nothing to fix.\nEvery product appears once.'));
});
test('one or no other language reads naturally',()=>{
 const two={...job,languages:{default:'es',enabled:['es','en']}},one={...job,languages:{default:'es',enabled:['es']}};
 assert.ok(firstPassInstructions(two).includes('The other customer language is English (en).'));
 assert.ok(firstPassInstructions(one).includes('The venue has no other customer languages.'));
 assert.ok(firstPassInstructions(two).includes('{"id": "p01", "es": "...", "en": "...", "placeholder": false,'));
});
test('the input carries house style, kinds and the family link only to an item in the batch',()=>{
 const input=firstPassInput(job,job.items);
 assert.ok(input.startsWith('Names this venue has saved: follow their wording where they apply.\n'));
 const rows=JSON.parse(input.slice(input.indexOf('Products:\n')+'Products:\n'.length));
 assert.deepEqual(rows,[{id:'p01',kind:'product',internal:'GUILDAS',category:'BAR TAPAS',existing:{}},
  {id:'p02',kind:'variant',internal:'DOBLE',category:'BAR TAPAS',existing:{en:'Double'},partOf:'p01'}]);
 assert.ok(!firstPassInput(job,[job.items[1]!]).includes('partOf'));
 assert.ok(!firstPassInput({...job,houseStyle:[]},job.items).includes('saved'));
});
test('the review lists every language with given ones marked, and skips placeholders',()=>{
 const first:ItemResult[]=[{ref:'product:1',names:{},placeholder:true,corrections:[]},{ref:'variant:2',names:{ca:'Doble',es:'Doble'},placeholder:false,corrections:[]}];
 const rows=JSON.parse(reviewInput(job,job.items,first)!.slice('Names:\n'.length));
 assert.deepEqual(rows,[{id:'p02',internal:'DOBLE',category:'BAR TAPAS',names:{ca:'Doble',es:'Doble',en:'Double'},given:['en']}]);
 assert.ok(reviewInstructions(job).startsWith("You review customer-facing names that someone else wrote for a venue's menu.\nThe venue's customer languages are: ca (Catalan, the default), es (Spanish), en (English).\n"));
 assert.equal(reviewInput(job,[job.items[0]!],[first[0]!]),undefined);
});
test('batch IDs remain aligned beyond 99 items and when context is omitted from review',()=>{
 const batch=Array.from({length:120},(_,i)=>({...job.items[0]!,ref:`product:${i}`,family:`product:${i}`}));
 const ids=batchIds(batch);
 assert.equal(ids.length,120);
 assert.deepEqual([ids[0],ids[98],ids[99],ids[119]],['p001','p099','p100','p120']);
 assert.deepEqual(batchIds([]),[]);
 const rows=JSON.parse(firstPassInput({...job,houseStyle:[]},batch).slice('Products:\n'.length));
 assert.deepEqual([rows[0].id,rows[119].id],['p001','p120']);
 const review=JSON.parse(reviewInput(job,batch,[{ref:'product:119',names:{ca:'Darrer',es:'Último',en:'Last'},placeholder:false,corrections:[]}])!.slice('Names:\n'.length));
 assert.deepEqual(review,[{id:'p120',internal:'GUILDAS',category:'BAR TAPAS',names:{ca:'Darrer',es:'Último',en:'Last'},given:[]}]);
});
test('country, default-first language order and house style are represented without changing submitted text',()=>{
 const alternate={...job,country:'FR',languages:{default:'en',enabled:['es','en','ca']}};
 const instructions=firstPassInstructions(alternate);
 assert.ok(instructions.startsWith("You write customer-facing names for a venue's menu in France.\nThe venue's default customer language is English (en). The other customer languages are Spanish (es) and Catalan (ca).\n"));
 assert.ok(instructions.includes('"en": "...", "es": "...", "ca": "..."'));
 assert.ok(reviewInstructions(alternate).includes('en (English, the default), es (Spanish), ca (Catalan).'));
 const input=firstPassInput(job,job.items);
 const style=JSON.parse(input.slice(input.indexOf('\n')+1,input.indexOf('\n\nProducts:')));
 assert.deepEqual(style,[{kind:'product',internal:'CARAJILLO',names:{ca:'Cigaló',es:'Carajillo'}}]);
 assert.deepEqual(job.items[1]!.existing,{en:'Double'});
});
