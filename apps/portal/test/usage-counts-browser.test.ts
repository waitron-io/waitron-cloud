import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const id='20000000-0000-4000-8000-000000000001';
const summary={version:1,organisationId:id,storage:{currentBytes:'0',addedBytes:'0',removedBytes:'0'},transfer:{uploadedBytes:'0',restoredBytes:'0'},operations:{installationCompleted:'12345',monitoringProbes:'23456'},messages:{sent:'34567',failed:'45678',expired:'56789',cancelled:'67890'},latestEventAt:null,measuredThrough:null};
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: all six usage counts use language-specific grouping`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/usage/read'))return route.fulfill({json:summary});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),overview:{organisationName:'Café Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}}]}});
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.usage.loaded);
  const c=translations[locale],usage=page.getByRole('region',{name:c.usageTitle,exact:true});
  assert.deepEqual(await usage.getByRole('region',{name:c.usageOperations,exact:true}).locator('dd').allTextContents(),locale==='en'?['12,345','23,456']:['12.345','23.456']);
  assert.deepEqual(await usage.getByRole('region',{name:c.usageMessages,exact:true}).locator('dd').allTextContents(),locale==='en'?['34,567','45,678','56,789','67,890']:['34.567','45.678','56.789','67.890']);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.USAGE_COUNTS_RECEIPT_DIR){await mkdir(process.env.USAGE_COUNTS_RECEIPT_DIR,{recursive:true});await usage.screenshot({path:`${process.env.USAGE_COUNTS_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});}
 }finally{await browser.close();}
});
