import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
const installations=[first,second].map((id,index)=>({
 installationId:id,venueId:id,organisationId:first,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:'Test organisation',businessName:index?'Second venue':'First venue',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),
}));
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: diagnostic failure stays beside its venue`,async t=>{
 const browser=await chromium.launch({headless:true});let release=()=>{};
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  let gate:Promise<void>|undefined,entered:(()=>void)|undefined;const requests:unknown[]=[];
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations}});
   if(path.endsWith('/diagnostics/read')){requests.push(route.request().postDataJSON());entered?.();await gate;return route.fulfill({status:503,json:{error:'unavailable'}});}
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.installations.loaded);
  const c=translations[locale],list=page.getByRole('region',{name:c.installations,exact:true}),rows=list.locator('article.installation');
  const diagnosticAlerts=list.getByRole('alert').filter({hasText:c.diagnosticUnavailable});
  const rowAlerts=(index:number)=>rows.nth(index).getByRole('alert').filter({hasText:c.diagnosticUnavailable});
  await t.test('a failed second-venue download has one alert in that row and none at list level',async()=>{
   await rows.nth(1).getByRole('button',{name:c.diagnosticDownload,exact:true}).click();
   await page.waitForFunction(()=>!(window as any).app.diagnostics.pending);
   assert.deepEqual(requests,[{installationId:second}]);
   assert.equal(await diagnosticAlerts.count(),1);assert.equal(await rowAlerts(1).count(),1);assert.equal(await rowAlerts(0).count(),0);
   assert.equal(await list.locator(':scope > [role="alert"]').filter({hasText:c.diagnosticUnavailable}).count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.DIAGNOSTIC_ERROR_RECEIPT_DIR){await mkdir(process.env.DIAGNOSTIC_ERROR_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.DIAGNOSTIC_ERROR_RECEIPT_DIR}/${locale}-${theme}-${width}-failed.png`,fullPage:true});}
  });
  await t.test('a new download clears the old alert and its failure belongs to the new venue',async()=>{
   gate=new Promise<void>(resolve=>{release=resolve;});const requested=new Promise<void>(resolve=>{entered=resolve;});
   await rows.nth(0).getByRole('button',{name:c.diagnosticDownload,exact:true}).click();await requested;
   try{
    assert.equal(await diagnosticAlerts.count(),0);
    for(const index of [0,1])assert.equal(await rows.nth(index).getByRole('button',{name:c.diagnosticDownload,exact:true}).isDisabled(),true);
   }finally{release();gate=undefined;entered=undefined;}
   await page.waitForFunction(()=>!(window as any).app.diagnostics.pending);
   assert.deepEqual(requests,[{installationId:second},{installationId:first}]);
   assert.equal(await diagnosticAlerts.count(),1);assert.equal(await rowAlerts(0).count(),1);assert.equal(await rowAlerts(1).count(),0);
   assert.equal(await list.locator(':scope > [role="alert"]').filter({hasText:c.diagnosticUnavailable}).count(),0);
  });
 }finally{release();await browser.close();}
});
