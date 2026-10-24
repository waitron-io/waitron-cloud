import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
const initial=[first,second].map((id,index)=>({
 installationId:id,venueId:id,organisationId:first,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:'Two venues',businessName:index?'Second venue':'First venue',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),
}));
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: translation read errors appear once and write errors stay at their venue`,async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  let installations=initial,readStatus=503;
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations}});
   if(path.endsWith('/usage/read'))return route.fulfill({json:{version:1,organisationId:first,storage:{currentBytes:'0',addedBytes:'0',removedBytes:'0'},transfer:{uploadedBytes:'0',restoredBytes:'0'},operations:{installationCompleted:'0',monitoringProbes:'0'},messages:{sent:'0',failed:'0',expired:'0',cancelled:'0'},latestEventAt:null,measuredThrough:null}});
   if(path.endsWith('/translation-consent')){
    if(route.request().method()==='POST'||readStatus!==200)return route.fulfill({status:503,json:{error:'unavailable'}});
    return route.fulfill({json:{consents:[{venueId:first,consented:true,consentedAt:'2026-10-24T00:00:00.000Z'},{venueId:second,consented:false,consentedAt:null}]}});
   }
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>{const app=(window as any).app;return app.installations.loaded&&app.translationConsent.error==='unavailable'&&!app.translationConsent.pending;});
  const c=translations[locale],list=page.getByRole('region',{name:c.installations,exact:true}),venues=list.locator('article.installation');
  const group=(index:number)=>venues.nth(index).getByRole('group',{name:c.translationConsent,exact:true});
  const readAlerts=list.getByRole('alert').filter({hasText:c.unavailable});
  await t.test('one failed account-wide read produces one message for two venues',async()=>{
   assert.equal(await venues.count(),2);assert.equal(await readAlerts.count(),1);
   assert.equal(await group(0).getByRole('button',{name:c.translationConsentAgree,exact:true}).isEnabled(),false);
   assert.equal(await group(1).getByRole('button',{name:c.translationConsentAgree,exact:true}).isEnabled(),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.TRANSLATION_ALERT_RECEIPT_DIR){
    await mkdir(process.env.TRANSLATION_ALERT_RECEIPT_DIR,{recursive:true});
    await page.screenshot({path:`${process.env.TRANSLATION_ALERT_RECEIPT_DIR}/${locale}-${theme}-${width}-read.png`,fullPage:true});
   }
  });
  await t.test('a successful retry clears the read error and a failed write names only its venue',async()=>{
   readStatus=200;
   await group(1).getByRole('button',{name:c.refreshStatus,exact:true}).click();
   await page.waitForFunction(()=>(window as any).app.translationConsent.loaded);
   assert.equal(await readAlerts.count(),0);
   for(const index of [1,0]){
    await group(index).getByRole('button',{name:index?c.translationConsentAgree:c.translationConsentWithdraw,exact:true}).click();
    await page.waitForFunction(()=>!(window as any).app.translationConsent.pending);
    assert.equal(await group(index).getByRole('alert').textContent(),c.translationConsentUncertain);
    assert.equal(await group(1-index).getByRole('alert').count(),0);
    assert.equal(await list.getByRole('alert').filter({hasText:c.translationConsentUncertain}).count(),1);
   }
   if(process.env.TRANSLATION_ALERT_RECEIPT_DIR)await page.screenshot({path:`${process.env.TRANSLATION_ALERT_RECEIPT_DIR}/${locale}-${theme}-${width}-write.png`,fullPage:true});
  });
  await t.test('a failed translation read adds no message when no translation controls are offered',async()=>{
   installations=initial.map(i=>({...i,canRevoke:false}));readStatus=503;
   await page.evaluate(async()=>{const app=(window as any).app;await app.installations.load();await app.translationConsent.load();});
   assert.equal(await venues.count(),2);
   assert.equal(await list.getByRole('group',{name:c.translationConsent,exact:true}).count(),0);
   assert.equal(await readAlerts.count(),0);
  });
 }finally{await browser.close();}
});
