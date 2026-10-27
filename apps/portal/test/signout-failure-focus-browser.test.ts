import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const expiresAt='2099-01-01T00:00:00.000Z';
const installations=Array.from({length:8},(_,i)=>{
 const id=`12345678-1234-4234-8234-${String(i+1).padStart(12,'0')}`;
 return {installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
  services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};
});
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])for(const handler of ['normal','delayed','missing'] as const){
 if(handler==='missing'&&(locale!=='en'||theme!=='light'||width!==390))continue;
 test(`${locale} ${theme} ${width}${handler==='normal'?'':` with ${handler} handler`}: a failed sign-out is brought into view and focused`,async t=>{
  const browser=await chromium.launch({headless:true});let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});let handlerEntered=false;const entered=()=>{handlerEntered=true;};
  try{
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
   const c=translations[locale];let signedIn=true,attempts=0;
   await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
   await page.route('**/api/account/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname.replace('/api/account','');
    if(endpoint==='/session'||endpoint==='/session/activity')return signedIn?route.fulfill({json:{accountId:'owner',expiresAt}}):route.fulfill({status:401,json:{error:'unauthenticated'}});
    if(endpoint==='/authenticator')return route.fulfill({json:{active:false,version:0,recoveryCodesRemaining:0,available:true}});
    if(endpoint==='/passkeys')return route.fulfill({json:{passkeys:[]}});
    if(endpoint==='/installations')return route.fulfill({json:{installations}});
    if(endpoint==='/alerts')return route.fulfill({json:{enabled:false,locale}});
    if(endpoint==='/logout'){
     attempts++;if(attempts===1){if(handler==='delayed')await delay(100);if(handler!=='missing')entered();await held;return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});}
     signedIn=false;return route.fulfill({status:204});
    }
    return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
   });
   await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
   const signOut=page.getByRole('button',{name:c.signout,exact:true});
   await signOut.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>scrollY>500),true,'the button starts well below the summary');
   const waitForHandler=()=>t.waitFor(()=>{assert.equal(handlerEntered,true,'the first logout route handler must enter');},{timeout:4000});
   if(handler==='missing'){
    await signOut.click();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
     await assert.rejects(Promise.race([waitForHandler(),new Promise<void>(resolve=>{timer=setTimeout(resolve,5000);})]),/waitFor\(\) timed out/);
     assert.equal(attempts,1,'the missing signal belongs to the held first logout request');
    }finally{clearTimeout(timer);}
    return;
   }
   const response=page.waitForResponse('**/api/account/logout');await signOut.click();await waitForHandler();
   assert.equal(await signOut.isDisabled(),true,'sign-out remains disabled while pending');assert.equal(attempts,1);
   release();assert.equal((await response).status(),503);
   const summary=page.locator('wt-form-error-summary');await summary.getByText(c.logoutFailed,{exact:true}).waitFor();
   const box=await summary.boundingBox();assert.ok(box);assert.equal(box.y>=0&&box.y+box.height<=900,true,'the failure summary is visible without manual scrolling');
   assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('wt-form-error-summary')),true);
   assert.equal(await signOut.isEnabled(),true);assert.equal(attempts,1);
   assert.equal(await page.getByText(c.signedOut,{exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.SIGNOUT_FOCUS_RECEIPT_DIR){await mkdir(process.env.SIGNOUT_FOCUS_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.SIGNOUT_FOCUS_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});}
   await signOut.click();await page.getByText(c.signedOut,{exact:true}).waitFor();assert.equal(attempts,2);
   assert.equal(await summary.getByText(c.logoutFailed,{exact:true}).count(),0);
  }finally{release();await browser.close();}
 });
}
