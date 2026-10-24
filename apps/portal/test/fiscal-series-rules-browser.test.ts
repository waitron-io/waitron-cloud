import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {reserve,accountId} from '../../../packages/fiscal-allocation/test/fixtures.ts';
import {translations} from '../src/locale.ts';

const bundle=await build({stdin:{contents:`
 import {render} from 'lit';
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import '@waitron-io/ui-core/components/wt-input';
 import '@waitron-io/ui-core/components/wt-button';
 import {fiscalAllocationScreen} from './src/fiscal-allocation-screen.ts';
 import {FiscalAllocationController} from './src/fiscal-allocation-controller.ts';
 import {translations} from './src/locale.ts';
 applyTokens(document.body);
 window.mount=(locale,accountId,input)=>{
  const app={copy:translations[locale],session:{state:{kind:'authenticated'}},
   installations:{organisations:[],visible:[{venueId:input.venueId,canRevoke:true,environment:'test'}]},
   draw(){render(fiscalAllocationScreen(app),document.querySelector('#portal'));}};
  app.fiscal=new FiscalAllocationController(()=>app.draw());
  app.fiscal.account(accountId);app.fiscal.open(input.venueId);app.fiscal.choose(input);app.draw();
 };
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
// Removing either series feedback branch must fail before a valid correction can submit.
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])for(const problem of ['no-standard','duplicate','both'] as const)test(`${locale} ${theme} ${width}: ${problem} series explains the refusal locally and allows a corrected draft`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(3000);
  const requests:{path:string;body:unknown}[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://portal.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.startsWith('/api/')){requests.push({path,body:route.request().postDataJSON()});return route.fulfill({status:400,json:{error:'invalid_input'}});}
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
  });
  await page.goto('https://portal.test/');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const input=reserve();input.scope.taxpayerNif=' b12345678 ';input.scope.softwareId=' wt ';
  input.bases=problem==='no-standard'?[{code:'A',purpose:'full'},{code:'B',purpose:'rectificative'}]:[{code:'A',purpose:'full'},{code:'B',purpose:problem==='both'?'full':'standard'},{code:'A',purpose:'rectificative'}];
  await page.evaluate(({locale,accountId,input})=>(window as any).mount(locale,accountId,input),{locale,accountId,input});
  const c=translations[locale],base=(i:number)=>page.locator(`wt-input[name="base-${i}"]`),submit=page.getByRole('button',{name:c.fiscalReserve,exact:true});
  await submit.click();
  if(problem!=='duplicate')assert.equal(await page.getByRole('alert').textContent(),locale==='en'?'Add a Standard series.':'Añade una serie ordinaria.');
  for(let i=0;i<input.bases.length;i++){
   const repeated=problem!=='no-standard'&&i!==1;
   assert.equal(await base(i).locator('input').getAttribute('aria-invalid'),repeated?'true':'false',`series ${i+1} must mark only repeated codes`);
   if(repeated)assert.equal(await base(i).getByText(locale==='en'?'Use a different series code.':'Usa un código de serie distinto.',{exact:true}).count(),1);
  }
  assert.equal(requests.length,0,'invalid drafts must send no request');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.FISCAL_SERIES_RULES_RECEIPT_DIR){await mkdir(process.env.FISCAL_SERIES_RULES_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.FISCAL_SERIES_RULES_RECEIPT_DIR}/${locale}-${theme}-${width}-${problem}.png`,fullPage:true});}
  // Case-sensitive codes remain distinct; a corrected draft retains the existing normalisation.
  if(problem!=='no-standard')await base(2).locator('input').fill('a');
  for(let i=0;i<input.bases.length;i++)assert.equal(await base(i).locator('input').getAttribute('aria-invalid'),'false','correcting a repeated code clears all stale series marks before submission');
  if(problem==='duplicate')assert.deepEqual(await page.getByRole('alert').allTextContents(),[c.fiscalInvalid],'a series edit must not clear unrelated screen errors');
  if(problem!=='duplicate'){await page.getByLabel(c.fiscalPurpose+' 1',{exact:true}).selectOption('standard');assert.equal(await page.getByRole('alert').count(),0,'choosing Standard clears its warning before submission');}
  const response=page.waitForResponse(r=>r.url().endsWith('/api/account/fiscal-allocations/reserve'));
  await submit.click();await response;
  assert.equal(requests.length,1);assert.equal(requests[0]!.path,'/api/account/fiscal-allocations/reserve');
  assert.deepEqual(requests[0]!.body,{...input,scope:{...input.scope,taxpayerNif:'B12345678',softwareId:'WT'},bases:input.bases.map((b,i)=>({...b,...(i===2?{code:'a'}:{}),...(i===0&&problem!=='duplicate'?{purpose:'standard'}:{})}))});
  for(let i=0;i<input.bases.length;i++)assert.equal(await base(i).locator('input').getAttribute('aria-invalid'),'false');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
