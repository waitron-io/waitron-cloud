import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const requestId='12345678-1234-4234-8234-123456789abc';
const business={organisationId:requestId,legalBusinessId:'22345678-1234-4234-8234-123456789abc',organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'};
const view={requestId,localVenueId:'32345678-1234-4234-8234-123456789abc',environment:'test',expiresAt:'2026-10-25T12:00:00Z',state:'awaiting_cloud'};
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: pasted pairing code is displayed and sent trimmed`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  const calls:{path:string;body:unknown}[]=[];
  await page.route('https://portal.test/connect',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/pairing/businesses'))return route.fulfill({json:{businesses:[business]}});
   if(path.endsWith('/pairing/inspect')||path.endsWith('/pairing/approve')){
    calls.push({path,body:route.request().postDataJSON()});
    return route.fulfill({json:path.endsWith('/approve')?{...view,...business,state:'awaiting_local'}:view});
   }
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto(`https://portal.test/connect#request=${requestId}`);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const c=translations[locale],input=page.locator('input[name=pairingCode]');
  await input.fill('1234 5678');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  await page.getByRole('alert').filter({hasText:c.pairCodeError}).waitFor();assert.deepEqual(calls,[]);
  await input.fill(' 01234567 ');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  await page.getByRole('button',{name:c.pairApprove,exact:true}).waitFor();
  assert.equal(await input.inputValue(),'01234567');assert.equal(await input.isDisabled(),true);
  assert.deepEqual(calls,[{path:'/api/account/pairing/inspect',body:{requestId,code:'01234567'}}]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.PAIRING_RECEIPT_DIR){await mkdir(process.env.PAIRING_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.PAIRING_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:c.pairApprove,exact:true}).click();await page.getByText(c.pairApproved,{exact:true}).waitFor();
  assert.deepEqual(calls.at(-1),{path:'/api/account/pairing/approve',body:{requestId,code:'01234567',organisationId:business.organisationId,legalBusinessId:business.legalBusinessId}});
  assert.equal(calls.length,2);
 }finally{await browser.close();}
});
