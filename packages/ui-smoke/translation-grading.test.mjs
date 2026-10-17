import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {gradingPage} from '../translation/quality/build-grading.ts';
const root=new URL('../../',import.meta.url).pathname;
test('translation grading saves exact marks, clears them, and reports failures in both languages and layouts', {timeout:60000}, async()=>{
const template=readFileSync(root+'/packages/translation/quality/page.template.html','utf8');
const set={products:[{id:'p01',internal:'CAFE </script>',category:'Drinks',existing:{en:'Coffee'}},{id:'p02',internal:'PA AMB TOMAQUET',category:'Food'}],grades:new Map(),shown:new Set()};
const {html,keys}=gradingPage(set,[{file:'test.json',names:{p01:{ca:'Cafè </script> $&',es:'Café'},p02:{ca:'Pa amb tomàquet',en:'Bread with tomato'}}}],template,'test');

const browser=await chromium.launch({headless:true});
try{
 for(const lang of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
   const collections=new Map();
   window.fixture={fail:false,writes:[],collection(name){
    if(!collections.has(name))collections.set(name,{docs:new Map(),listener:null});
    const state=collections.get(name),emit=()=>state.listener?.({docs:[...state.docs].map(([id,value])=>({id,data:()=>value}))});
    return {onSnapshot(fn){state.listener=fn;emit();},doc(id){return {
     async set(value){if(window.fixture.fail)throw new Error('fixture unavailable');state.docs.set(id,value);window.fixture.writes.push({name,id,value});emit();},
     async delete(){if(window.fixture.fail)throw new Error('fixture unavailable');state.docs.delete(id);window.fixture.writes.push({name,id,deleted:true});emit();}
    };}};
   }};
   window.claude={use:async()=>window.fixture};
  });
  await page.goto('about:blank');
  await page.setContent(html);
  assert.equal(await page.locator('.name').count(),4);
  await page.locator('#locale').selectOption(lang);
  await page.getByRole('heading',{name:lang==='en'?'Menu name grading':'Revisión de nombres'}).waitFor();
  const row=page.locator('.name').first();
  await row.getByRole('button',{name:lang==='en'?'Needs work':'Mejorar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.name').dataset.v==='fix');
  assert.equal(await page.locator('#n-fix').textContent(),'1');
  assert.equal(await page.evaluate(()=>window.fixture.writes[0].value.text),'Cafè </script> $&');
  await row.getByRole('button',{name:lang==='en'?'Needs work':'Mejorar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.name').dataset.v==='');
  await page.evaluate(()=>window.fixture.fail=true);
  await row.getByRole('button',{name:lang==='en'?'Wrong':'Incorrecto',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#save-state').dataset.state==='failed');
  assert.equal(await row.getAttribute('data-v'),'');
  await page.evaluate(()=>window.fixture.fail=false);
  await page.getByRole('button',{name:lang==='en'?'Mark done':'Terminar',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('.product').classList.contains('done'));
  await page.locator('#hide-done').check();
  assert.equal(await page.locator('.product:visible').count(),1);
  await page.locator('#hide-done').uncheck();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log(`${lang} ${colorScheme} ${width}: render, marks, deletion, refused save and done PASS`);
  await context.close();
 }
 const page=await browser.newPage();await page.setContent(html);
 await page.waitForFunction(()=>document.querySelector('#save-state')?.dataset.state==='unavailable');
 assert.equal(await page.locator('.marks button:enabled').count(),0);
 assert.equal(Object.keys(keys).length,4);console.log('No bridge: marks visibly disabled PASS');
 await page.close();
}finally{await browser.close();}
});
