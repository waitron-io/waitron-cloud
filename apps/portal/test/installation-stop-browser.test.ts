import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
const initial=[first,second].map((id,index)=>({
 installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:index?'Z second organisation':'A first organisation',businessName:index?'Second venue':'First venue',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),
}));
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: Account refresh reconciles the stop prompt`,async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  let installations=initial;const writes:unknown[]=[];
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations}});
   if(path.endsWith('/installations/revoke')){writes.push(route.request().postDataJSON());return route.fulfill({json:{...initial[0],revokedAt:'2026-10-24T00:00:00.000Z'}});}
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.installations.loaded);
  const c=translations[locale],prompt=page.getByRole('group',{name:c.stopAccess,exact:true});
  for(const change of ['permission','organisation','fallback','unchanged'] as const)await t.test(`${change}: only the still offered confirmation remains`,async()=>{
   installations=initial;
   await page.evaluate(async first=>{const controller=(window as any).app.installations;await controller.load();controller.selectOrganisation(first);},first);
   await page.locator('article.installation').filter({has:page.getByRole('heading',{name:'First venue · 20000000',exact:true})}).getByRole('button',{name:c.stopAccess,exact:true}).click();
   assert.equal(await prompt.count(),1);assert.equal(await prompt.getByRole('button',{name:c.confirmStop,exact:true}).isEnabled(),true);
   if(process.env.INSTALLATION_STOP_RECEIPT_DIR&&change==='permission'){
    await mkdir(process.env.INSTALLATION_STOP_RECEIPT_DIR,{recursive:true});
    await page.screenshot({path:`${process.env.INSTALLATION_STOP_RECEIPT_DIR}/${locale}-${theme}-${width}-before.png`,fullPage:true});
   }
   installations=initial.map((i,index)=>change==='permission'&&!index?{...i,canRevoke:false}:change==='organisation'?{...i,organisationId:index?first:second}:change==='fallback'?{...i,organisationId:second}:i);
   await page.getByRole('region',{name:c.installations,exact:true}).locator(':scope > wt-button').getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.waitForFunction(()=>!(window as any).app.installations.pending);
   assert.equal(await prompt.count(),change==='unchanged'?1:0);
   assert.equal(await page.evaluate(()=>(window as any).app.installations.confirming??null),change==='unchanged'?first:null);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.INSTALLATION_STOP_RECEIPT_DIR&&change==='permission')await page.screenshot({path:`${process.env.INSTALLATION_STOP_RECEIPT_DIR}/${locale}-${theme}-${width}-after.png`,fullPage:true});
   assert.deepEqual(writes,[]);
   if(change==='unchanged'){
    await prompt.getByRole('button',{name:c.confirmStop,exact:true}).click();await page.waitForFunction(()=>!(window as any).app.installations.pending);
    assert.equal(await prompt.count(),0);assert.deepEqual(writes,[{installationId:first}]);
   }
  });
 }finally{await browser.close();}
});
