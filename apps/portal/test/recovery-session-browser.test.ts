import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium,type Route} from 'playwright';

const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])for(const failure of ['503','network'] as const)test(`${locale} ${theme} ${width} ${failure}: recovery distinguishes a failed session check and retries`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(3000);
  let firstRoute!:Route,received!:()=>void;
  const sessionRequested=new Promise<void>(resolve=>{received=resolve;});let requests=0;
  await page.route('https://portal.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/account/session'){
    requests++;
    if(requests===1){firstRoute=route;received();return;}
    return route.fulfill({status:401,json:{error:'credentials_invalid'}});
   }
   if(!path.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/recover#request=10000000-0000-4000-8000-000000000001');
  await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});await sessionRequested;
  const checking=locale==='en'?'Checking your session…':'Comprobando tu sesión…';
  const unavailable=locale==='en'?'We could not check your session. Try again.':'No hemos podido comprobar tu sesión. Vuelve a intentarlo.';
  const status=page.getByRole('status');assert.equal(await status.textContent(),checking);
  if(failure==='503')await firstRoute.fulfill({status:503,json:{error:'unavailable'}});else await firstRoute.abort('failed');
  await page.getByRole('status').filter({hasText:unavailable}).waitFor();
  assert.equal(await status.textContent(),unavailable);assert.equal(requests,1);
  assert.equal(await page.locator('input[name=recoveryCode]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.RECOVERY_SESSION_RECEIPT_DIR){await mkdir(process.env.RECOVERY_SESSION_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_SESSION_RECEIPT_DIR}/${locale}-${theme}-${width}-${failure}.png`,fullPage:true});}
  await page.getByRole('button',{name:locale==='en'?'Try again':'Volver a intentar',exact:true}).click();
  await page.waitForURL('https://portal.test/login');assert.equal(requests,2);
 }finally{await browser.close();}
});
