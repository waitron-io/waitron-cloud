import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const id='20000000-0000-4000-8000-000000000001';
const installation={installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:'Harbour Kitchen',businessName:'Harbour Kitchen',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: refused refresh removes installation rows and stop confirmation`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  let status=200;const writes:unknown[]=[];
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations'))return status===200?route.fulfill({json:{installations:[installation]}}):route.fulfill({status,json:{error:status===401?'unauthenticated':status===403?'forbidden':'temporarily_unavailable'}});
   if(path.endsWith('/installations/revoke'))writes.push(request.postDataJSON());
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.installations.loaded);
  const c=translations[locale],region=page.getByRole('region',{name:c.installations,exact:true}),rows=region.locator('article.installation'),prompt=region.getByRole('group',{name:c.stopAccess,exact:true});
  const refresh=async()=>{await region.locator(':scope > wt-button').getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.waitForFunction(()=>!(window as any).app.installations.pending);};
  for(const refused of [401,403]){
   assert.equal(await rows.count(),1);await rows.getByRole('button',{name:c.stopAccess,exact:true}).click();assert.equal(await prompt.count(),1);
   status=503;await refresh();assert.equal(await rows.count(),1);assert.equal(await prompt.count(),1);
   status=refused;await refresh();
   assert.equal(await rows.count(),0);assert.equal(await prompt.count(),0);
   assert.equal(await region.getByRole('button',{name:c.stopAccess,exact:true}).count(),0);
   assert.equal(await region.getByRole('alert').filter({hasText:refused===401?c.pairSession:c.forbidden}).count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(writes,[]);
   if(process.env.INSTALLATION_REFRESH_RECEIPT_DIR){await mkdir(process.env.INSTALLATION_REFRESH_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.INSTALLATION_REFRESH_RECEIPT_DIR}/${locale}-${theme}-${width}-${refused}.png`,fullPage:true});}
   status=200;await refresh();assert.equal(await rows.count(),1);assert.equal(await prompt.count(),0);
  }
 }finally{await browser.close();}
});
