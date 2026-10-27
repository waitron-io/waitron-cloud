import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const venue='20000000-0000-4000-8000-000000000001';
const installation={installationId:venue,venueId:venue,organisationId:venue,legalBusinessId:venue,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:'Test organisation',businessName:'Test venue',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])for(const handler of ['normal', 'delayed', ...(locale==='en'&&theme==='light'&&width===390?['missing'] as const:[])] as const)test(`${locale} ${theme} ${width} ${handler}: translation refresh waits for the installation list`,async t=>{
 const browser=await chromium.launch({headless:true});let release=()=>{};
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  let gate:Promise<void>|undefined,entered:(()=>void)|undefined,status=503;
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations')){if(gate&&handler==='delayed')await new Promise(resolve=>setTimeout(resolve,100));if(handler!=='missing')entered?.();await gate;return route.fulfill({json:{installations:[installation]}});}
   if(path.endsWith('/usage/read'))return route.fulfill({json:{version:1,organisationId:venue,storage:{currentBytes:'0',addedBytes:'0',removedBytes:'0'},transfer:{uploadedBytes:'0',restoredBytes:'0'},operations:{installationCompleted:'0',monitoringProbes:'0'},messages:{sent:'0',failed:'0',expired:'0',cancelled:'0'},latestEventAt:null,measuredThrough:null}});
   if(path.endsWith('/translation-consent'))return route.fulfill(status===200?{json:{consents:[]}}:{status,json:{error:'unavailable'}});
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>{const app=(window as any).app;return app.installations.loaded&&!app.installations.pending&&app.translationConsent.error==='unavailable'&&!app.translationConsent.pending;});
  const c=translations[locale],list=page.getByRole('region',{name:c.installations,exact:true}),group=list.getByRole('group',{name:c.translationConsent,exact:true});
  const refresh=group.locator('wt-button').first().getByRole('button');
  await t.test('translation retry has a distinct accessible name from list refresh',async()=>{
   assert.equal(await group.getByRole('button',{name:locale==='en'?'Refresh translation status':'Actualizar estado de traducción',exact:true}).count(),1);
   assert.equal(await list.getByRole('button',{name:c.refreshStatus,exact:true}).count(),1);
  });
  await t.test('translation retry is disabled throughout a held installation refresh',async()=>{
   gate=new Promise<void>(resolve=>{release=resolve;});let handlerEntered=false;entered=()=>{handlerEntered=true;};
   await list.locator(':scope > wt-button').getByRole('button',{name:c.refreshStatus,exact:true}).click();
   const waitForHandler=()=>t.waitFor(()=>{assert.equal(handlerEntered,true,'the installation refresh route handler must enter');},{timeout:4000});
   if(handler==='missing'){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
     await assert.rejects(Promise.race([waitForHandler(),new Promise<void>(resolve=>{timer=setTimeout(resolve,5000);})]),/waitFor\(\) timed out/);
    }finally{clearTimeout(timer);release();gate=undefined;entered=undefined;}
    return;
   }
   await waitForHandler();
   try{
    assert.equal(await group.getByRole('button',{name:c.translationConsentAgree,exact:true}).isDisabled(),true);
    assert.equal(await refresh.isDisabled(),true);
    if(process.env.TRANSLATION_REFRESH_RECEIPT_DIR){await mkdir(process.env.TRANSLATION_REFRESH_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.TRANSLATION_REFRESH_RECEIPT_DIR}/${locale}-${theme}-${width}-pending.png`,fullPage:true});}
   }finally{release();gate=undefined;entered=undefined;}
   await page.waitForFunction(()=>!(window as any).app.installations.pending);
  });
  await t.test('retry becomes available after the list settles and a successful read enables consent',async()=>{
   await refresh.click({trial:true});assert.equal(await refresh.isEnabled(),true);
   assert.equal(await group.getByRole('button',{name:c.translationConsentAgree,exact:true}).isDisabled(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.TRANSLATION_REFRESH_RECEIPT_DIR){await mkdir(process.env.TRANSLATION_REFRESH_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.TRANSLATION_REFRESH_RECEIPT_DIR}/${locale}-${theme}-${width}-ready.png`,fullPage:true});}
   status=200;await refresh.click();await page.waitForFunction(()=>{const app=(window as any).app;return app.translationConsent.loaded&&!app.translationConsent.pending&&!app.installations.pending;});
   assert.equal(await group.getByRole('button',{name:locale==='en'?'Refresh translation status':'Actualizar estado de traducción',exact:true}).count(),0);
   await group.getByRole('button',{name:c.translationConsentAgree,exact:true}).click({trial:true});
   assert.equal(await group.getByRole('button',{name:c.translationConsentAgree,exact:true}).isEnabled(),true);
   assert.equal(await group.getByRole('alert').count(),0);
  });
 }finally{release();await browser.close();}
});
