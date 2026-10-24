import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const requestId='12345678-1234-4234-8234-123456789abc';
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: malformed recovery codes mark the field without sending a request`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  const calls:unknown[]=[];
  await page.route('https://portal.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   if(path.startsWith('/api/account/recovery/'))calls.push({path,body:route.request().postDataJSON()});
   if(path.startsWith('/api/'))return route.fulfill({status:503,json:{error:'unavailable'}});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
  });
  await page.goto(`https://portal.test/recover#request=${requestId}`);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const c=translations[locale],field=page.locator('wt-input[name="recoveryCode"]'),input=field.locator('input'),inspect=page.getByRole('button',{name:c.pairInspect,exact:true});
  await input.waitFor();assert.notEqual(await input.getAttribute('aria-invalid'),'true');
  for(const code of ['1234','1234 5678','1234567x']){
   await input.fill(code);await inspect.click();
   await page.getByRole('alert').filter({hasText:c.pairCodeError}).waitFor();
   assert.deepEqual(calls,[]);
   assert.equal(await input.getAttribute('aria-invalid'),'true');
   await field.getByText(c.pairCodeError,{exact:true}).waitFor();
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.RECOVERY_CODE_RECEIPT_DIR){await mkdir(process.env.RECOVERY_CODE_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_CODE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
  await input.fill(' 01234567 ');await inspect.click();
  await page.getByRole('alert').filter({hasText:c.unavailable}).waitFor();
  assert.deepEqual(calls,[{path:'/api/account/recovery/inspect',body:{requestId,code:'01234567'}}]);
  assert.equal(await input.inputValue(),'01234567');
  assert.notEqual(await input.getAttribute('aria-invalid'),'true');
  assert.equal(await field.getByText(c.pairCodeError,{exact:true}).count(),0);
 }finally{await browser.close();}
});
