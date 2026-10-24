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
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])for(const action of ['remove','add'] as const)test(`${locale} ${theme} ${width}: ${action} series clears stale row errors and preserves other field errors`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(3000);let requests=0;
  await page.route('https://portal.test/**',route=>{
   if(new URL(route.request().url()).pathname.startsWith('/api/')){requests++;return route.fulfill({status:400,json:{error:'invalid_input'}});}
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
  });
  await page.goto('https://portal.test/');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const input=reserve();input.scope.taxpayerNif='';input.bases=[{code:'',purpose:'standard'},{code:'A',purpose:'full'}];
  await page.evaluate(({locale,accountId,input})=>(window as any).mount(locale,accountId,input),{locale,accountId,input});
  const c=translations[locale],nif=page.locator('wt-input[name=fiscalNif]'),base=(i:number)=>page.locator(`wt-input[name="base-${i}"]`);
  const error=async(field:ReturnType<typeof page.locator>)=>{
   const message=field.getByText(c.fiscalRequired,{exact:true});
   return await message.count()?message.textContent():'';
  };
  await page.getByRole('button',{name:c.fiscalReserve,exact:true}).click();
  assert.equal(await error(base(0)),c.fiscalRequired);assert.equal(await error(nif),c.fiscalRequired);assert.equal(await error(base(1)),'');
  await page.getByRole('button',{name:action==='remove'?c.fiscalRemoveBase+' 1':c.fiscalAddBase,exact:true}).click();
  assert.equal(await error(base(0)),'','a row must not inherit an error from the previous list');
  assert.equal(await error(nif),c.fiscalRequired,'series edits must keep unrelated validation feedback');
  if(action==='remove'){
   assert.equal(await base(0).locator('input').inputValue(),'A');
   assert.equal(await page.getByLabel(c.fiscalPurpose+' 1',{exact:true}).inputValue(),'full');
   await page.getByRole('button',{name:c.fiscalAddBase,exact:true}).click();
   assert.equal(await base(1).locator('input').inputValue(),'');assert.equal(await error(base(1)),'');
   await page.getByRole('button',{name:c.fiscalReserve,exact:true}).click();
   assert.equal(await error(base(0)),'');assert.equal(await error(base(1)),c.fiscalRequired,'reserve must still validate a newly added empty series');
   await page.getByRole('button',{name:c.fiscalRemoveBase+' 2',exact:true}).click();
   await page.getByRole('button',{name:c.fiscalAddBase,exact:true}).click();assert.equal(await error(base(1)),'');
  }else{
   assert.equal(await error(base(2)),'');
   await page.getByRole('button',{name:c.fiscalReserve,exact:true}).click();
   assert.equal(await error(base(0)),c.fiscalRequired);assert.equal(await error(base(1)),'');assert.equal(await error(base(2)),c.fiscalRequired);
  }
  assert.equal(await error(nif),c.fiscalRequired);assert.equal(requests,0,'invalid fiscal drafts must stay local');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.FISCAL_SERIES_RECEIPT_DIR){await mkdir(process.env.FISCAL_SERIES_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.FISCAL_SERIES_RECEIPT_DIR}/${locale}-${theme}-${width}-${action}.png`,fullPage:true});}
 }finally{await browser.close();}
});
