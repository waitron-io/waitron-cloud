import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const requestId='12345678-1234-4234-8234-123456789abc';
const business={organisationId:requestId,legalBusinessId:'22345678-1234-4234-8234-123456789abc',organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'};
const view={requestId,venueId:'32345678-1234-4234-8234-123456789abc',environment:'test',expiresAt:'2099-01-01T00:00:00Z',state:'awaiting_cloud'};
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])
test(`${locale} ${theme} ${width}: pairing shows body refusal advice for inspection and approval`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  let refused='',status=408;const calls:string[]=[];
  await page.route('https://portal.test/connect',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
   if(path.endsWith('/action-proof'))return route.fulfill({json:{methods:['passkey'],freshUntil:'2099-01-01T00:00:00Z'}});
   if(path.endsWith('/pairing/businesses'))return route.fulfill({json:{businesses:[business]}});
   if(path.endsWith('/pairing/inspect')||path.endsWith('/pairing/approve')){calls.push(path);return route.fulfill(refused&&path.endsWith(refused)?{status,json:{error:'invalid_input'}}:{json:view});}
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  const c=translations[locale];
  for(const action of ['inspect','approve'])for(const [response,cause] of [[408,'Interrupted'],[413,'Size'],[415,'Format']] as const){
   refused='';status=response;await page.goto('about:blank');await page.goto(`https://portal.test/connect#request=${requestId}`);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
   await page.locator('input[name=pairingCode]').fill('12345678');
   if(action==='approve'){await page.getByRole('button',{name:c.pairInspect,exact:true}).click();await page.getByRole('button',{name:c.pairApprove,exact:true}).waitFor();}
   refused='/'+action;const before=calls.length;await page.getByRole('button',{name:action==='inspect'?c.pairInspect:c.pairApprove,exact:true}).click();
   const alert=page.getByRole('alert');await alert.filter({hasText:c[`requestBody${cause}`]}).waitFor();
   await alert.getByText(c[`requestBody${cause}`]+(response===408?` ${action==='approve'?c.pairApprove:c.pairInspect}.`:''),{exact:true}).waitFor();
   assert.equal(await page.locator('input[name=pairingCode]').inputValue(),'12345678');assert.equal(calls.length,before+1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.PAIRING_REFUSAL_RECEIPT_DIR){await mkdir(process.env.PAIRING_REFUSAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.PAIRING_REFUSAL_RECEIPT_DIR}/${locale}-${theme}-${width}-${action}-${response}.png`,fullPage:true});}
  }
 }finally{await browser.close();}
});
