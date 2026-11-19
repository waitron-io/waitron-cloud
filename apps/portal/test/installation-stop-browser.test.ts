import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
const initial=[first,second].map((id,index)=>({
 installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:index?'Z second organisation':'A first organisation',businessName:'Fixture SL',venueName:index?'Second venue':'First venue',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),
}));
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: Account refresh reconciles the removal prompt`,async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  const stamp='2026-10-24T00:00:00.000Z';
  const initialRows=initial.map((row,index)=>({...row,revokedAt:index===0?stamp:null,portalRemovedAt:null as string|null,guestMenuShared:index===0}));
  let installations=initialRows,rejectNextRemoval=false;const writes:unknown[]=[];
  await page.route('https://portal.test/account/venues',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations}});
   if(path.endsWith('/installations/remove')){
    writes.push(route.request().postDataJSON());
    if(rejectNextRemoval){rejectNextRemoval=false;return route.fulfill({status:503,json:{error:'guest_menu_takedown_failed'}});}
const removed={...initialRows[0]!,portalRemovedAt:stamp,guestMenuShared:false};installations=[removed,initialRows[1]!];return route.fulfill({json:removed});}
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account/venues');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.installations.loaded);
  const c=translations[locale],remove=locale==='en'?'Remove venue':'Quitar local',prompt=page.getByRole('group',{name:remove,exact:true});
  for(const change of ['permission','organisation','fallback','unchanged'] as const)await t.test(`${change}: only the still offered confirmation remains`,async()=>{
   installations=initialRows;
   await page.evaluate(async first=>{const controller=(window as any).app.installations;await controller.load();controller.selectOrganisation(first);},first);
   await page.locator('article.installation').filter({has:page.getByRole('heading',{name:'First venue',exact:true})}).getByRole('button',{name:remove,exact:true}).click();
   assert.equal(await prompt.count(),1);
   assert.match(await prompt.innerText(),locale==='en'?/Its shared guest menu stops showing/ : /Su menú compartido dejará de mostrarse/);
   assert.match(await prompt.innerText(),locale==='en'?/Charges for this venue continue.*Billing/s:/Los cobros de este local continúan.*Facturación/s);
   assert.equal(await prompt.getByRole('button',{name:c.confirmRemove,exact:true}).isEnabled(),true);
   if(process.env.INSTALLATION_STOP_RECEIPT_DIR&&change==='permission'){
    await mkdir(process.env.INSTALLATION_STOP_RECEIPT_DIR,{recursive:true});
    await page.screenshot({path:`${process.env.INSTALLATION_STOP_RECEIPT_DIR}/${locale}-${theme}-${width}-before.png`,fullPage:true});
   }
   installations=initialRows.map((i,index)=>change==='permission'&&!index?{...i,canRevoke:false}:change==='organisation'?{...i,organisationId:index?first:second}:change==='fallback'?{...i,organisationId:second}:i);
   await page.getByRole('region',{name:c.installations,exact:true}).locator(':scope > wt-button').getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.waitForFunction(()=>!(window as any).app.installations.pending);
   assert.equal(await prompt.count(),change==='unchanged'?1:0);
   assert.equal(await page.evaluate(()=>(window as any).app.installations.confirming??null),change==='unchanged'?first:null);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.INSTALLATION_STOP_RECEIPT_DIR&&change==='permission')await page.screenshot({path:`${process.env.INSTALLATION_STOP_RECEIPT_DIR}/${locale}-${theme}-${width}-after.png`,fullPage:true});
   assert.deepEqual(writes,[]);
   if(change==='unchanged'){
    const control=locale==='en'&&theme==='light'&&width===390;
    rejectNextRemoval=control;
    await prompt.getByRole('button',{name:c.confirmRemove,exact:true}).click();
    if(control){
     const retry=prompt.getByRole('button',{name:c.retry,exact:true});
     await retry.waitFor();
     assert.equal(await page.getByRole('heading',{name:'First venue',exact:true}).count(),1);
     assert.deepEqual(writes,[{installationId:first}]);
     await retry.click();
    }
    await page.waitForFunction(()=>!(window as any).app.installations.pending);
    assert.equal(await prompt.count(),0);
    assert.deepEqual(writes,control?[{installationId:first},{installationId:first}]:[{installationId:first}]);
    assert.equal(await page.getByRole('heading',{name:'First venue',exact:true}).count(),0);
    await page.evaluate(()=>(window as any).app.installations.load());
    assert.equal(await page.getByRole('heading',{name:'First venue',exact:true}).count(),0);
   }
  });
  if(locale==='en'&&theme==='light'&&width===390){
   installations=initialRows.map(row=>({...row,revokedAt:stamp,portalRemovedAt:stamp}));
   await page.evaluate(()=>(window as any).app.installations.load());
   assert.equal(await page.getByText(c.addVenue,{exact:true}).count(),1);
   assert.equal(await page.getByText('Removed venues stay in Billing. Test venues are also in Recovery.',{exact:true}).count(),1);
  }
 }finally{await browser.close();}
});
