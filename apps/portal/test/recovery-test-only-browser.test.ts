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
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: test-only refusal gives a setup path without implying reload enables recovery`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  const calls:{path:string;body:unknown}[]=[],expiresAt=new Date(Date.now()+3600000).toISOString();
  let refusal='local_integration_only';
  await page.route('https://portal.test/recover',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   if(path.includes('/recovery/'))calls.push({path,body:route.request().postDataJSON()});
   if(path.endsWith('/recovery/inspect'))return route.fulfill({json:{requestId:id,state:'approved',expiresAt,operationId:id,operation:{id,pointId,venueId,source:{kind:'snapshot',pointId},mode:'failure',status:'pending',expiresAt}}});
   if(path.endsWith('/recovery/close'))return route.fulfill({status:403,json:{error:refusal}});
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/recover#request='+id);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const c=translations[locale],code=page.getByRole('textbox',{name:c.pairCode,exact:true});await code.fill('00123456');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  await page.getByRole('button',{name:c.recoveryCancel,exact:true}).click();
  const alert=page.getByRole('alert');await alert.waitFor();
  const text=await alert.innerText();
  assert.match(text,locale==='en'?/test venues only/i:/solo.*locales de prueba/i);
  assert.match(text,locale==='en'?/replacement server.*setup/i:/configuración.*servidor de sustitución/i);
  assert.match(text,locale==='en'?/production recovery is not available/i:/recuperación.*producción no está disponible/i);
  assert.doesNotMatch(text,/reload|recarga|support|soporte/i);
  assert.equal(await page.getByRole('button',{name:c.recoveryCancel,exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>(window as any).app.recovery.uncertain),false);
  assert.deepEqual(calls,[{path:'/api/account/recovery/inspect',body:{requestId:id,code:'00123456'}},{path:'/api/account/recovery/close',body:{requestId:id,code:'00123456'}}]);
  assert.equal(await page.getByRole('link',{name:c.account,exact:true}).getAttribute('href'),'/account');
  assert.equal(await page.getByRole('button',{name:c.signout,exact:true}).isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.RECOVERY_TEST_ONLY_RECEIPT_DIR){await mkdir(process.env.RECOVERY_TEST_ONLY_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_TEST_ONLY_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
  refusal='permission_denied';await page.getByRole('button',{name:c.pairInspect,exact:true}).click();await page.getByRole('button',{name:c.recoveryCancel,exact:true}).click();
  await page.getByRole('alert').filter({hasText:c.forbidden}).waitFor();assert.equal(await page.evaluate(()=>(window as any).app.recovery.uncertain),false);
  assert.deepEqual(calls.map(call=>call.path),['/api/account/recovery/inspect','/api/account/recovery/close','/api/account/recovery/inspect','/api/account/recovery/close']);
 }finally{await browser.close();}
});
