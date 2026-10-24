import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const id='12345678-1234-4234-8234-123456789abc',pointId='22345678-1234-4234-8234-123456789abc',venueId='32345678-1234-4234-8234-123456789abc';
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: a refused recovery close keeps its limit message and trimmed code`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);await page.clock.install();
  const calls:{path:string;body:unknown}[]=[],expiresAt=new Date(Date.now()+3600000).toISOString();
  await page.route('https://portal.test/recover',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   if(path.includes('/recovery/'))calls.push({path,body:route.request().postDataJSON()});
   if(path.endsWith('/recovery/inspect'))return route.fulfill({json:{requestId:id,state:'approved',expiresAt,operationId:id,operation:{id,pointId,venueId,source:{kind:'snapshot',pointId},mode:'failure',status:'pending',expiresAt}}});
   if(path.endsWith('/recovery/close'))return route.fulfill({status:429,headers:{'Retry-After':'2'},json:{error:'rate_limited'}});
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/recover#request='+id);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const c=translations[locale],code=page.getByRole('textbox',{name:c.pairCode,exact:true});await code.fill(' 00123456 ');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  const close=page.getByRole('button',{name:c.recoveryCancel,exact:true});await close.waitFor();
  assert.equal(await code.inputValue(),'00123456');await close.click();await page.getByRole('alert').filter({hasText:c.limited}).waitFor();
  assert.equal(await page.getByRole('alert').filter({hasText:c.recoveryUncertain}).count(),0);
  assert.equal(await page.evaluate(()=>(window as any).app.recovery.uncertain),false);
  assert.deepEqual(calls,[{path:'/api/account/recovery/inspect',body:{requestId:id,code:'00123456'}},{path:'/api/account/recovery/close',body:{requestId:id,code:'00123456'}}]);
  assert.equal(await close.isDisabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.RECOVERY_REFUSAL_RECEIPT_DIR){await mkdir(process.env.RECOVERY_REFUSAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_REFUSAL_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
  await page.clock.runFor(2100);await page.waitForFunction(()=>(window as any).app.recovery.waiting===0);assert.equal(await close.isEnabled(),true);assert.equal(calls.length,2);
 }finally{await browser.close();}
});
