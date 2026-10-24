import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const id='20000000-0000-4000-8000-000000000001';
const summary={version:1,organisationId:id,storage:{currentBytes:'1536',addedBytes:'0',removedBytes:'0'},transfer:{uploadedBytes:'0',restoredBytes:'0'},operations:{installationCompleted:'0',monitoringProbes:'0'},messages:{sent:'0',failed:'0',expired:'0',cancelled:'0'},latestEventAt:null,measuredThrough:'2026-10-24T00:00:00.000Z'};
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: failed usage reads show one message and keep retry and totals`,async t=>{
 const browser=await chromium.launch({headless:true});
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  await page.clock.install();let mode:503|429|200=503;
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/usage/read')){
    await held;
    return mode===200?route.fulfill({json:summary}):route.fulfill({status:mode,headers:mode===429?{'Retry-After':'60'}:{},json:{error:mode===429?'rate_limited':'unavailable'}});
   }
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),overview:{organisationName:'Café Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}}]}});
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.usage.pending);
  const c=translations[locale],usage=page.locator('section.usage'),messages=usage.locator('[role="alert"], [role="status"]'),refresh=usage.getByRole('button',{name:c.usageRefresh,exact:true});
  await t.test('a pending first read shows only the wait message',async()=>{
   assert.deepEqual(await messages.allTextContents(),[c.wait]);assert.equal(await refresh.isDisabled(),true);
  });
  release();await page.waitForFunction(()=>(window as any).app.usage.error==='unavailable');
  await t.test('503 shows only its alert',async()=>{
   assert.deepEqual(await messages.allTextContents(),[c.unavailable]);assert.equal(await usage.getByRole('alert').count(),1);
   assert.equal(await refresh.isEnabled(),true);
   if(process.env.USAGE_MESSAGE_RECEIPT_DIR){await mkdir(process.env.USAGE_MESSAGE_RECEIPT_DIR,{recursive:true});await usage.screenshot({path:`${process.env.USAGE_MESSAGE_RECEIPT_DIR}/${locale}-${theme}-${width}-503.png`});}
  });
  mode=429;await refresh.click();await page.waitForFunction(()=>(window as any).app.usage.error==='limited');
  await t.test('429 shows only its alert while the page keeps the cooldown',async()=>{
   assert.deepEqual(await messages.allTextContents(),[c.limited]);assert.equal(await usage.getByRole('alert').count(),1);
   assert.equal(await refresh.isDisabled(),true);assert.equal(await page.locator('p[role="status"]').filter({hasText:c.cooldown}).count(),1);
   if(process.env.USAGE_MESSAGE_RECEIPT_DIR)await usage.screenshot({path:`${process.env.USAGE_MESSAGE_RECEIPT_DIR}/${locale}-${theme}-${width}-429.png`});
  });
  await page.clock.fastForward(61000);mode=200;await refresh.click();await page.waitForFunction(()=>(window as any).app.usage.loaded);
  await t.test('a successful retry replaces the error with totals',async()=>{
   assert.equal(await messages.count(),0);assert.equal(await usage.locator('.usage-groups').count(),1);
   assert.equal(await usage.getByText(locale==='en'?'1.5 KiB':'1,5 KiB',{exact:true}).count(),1);
  });
  mode=503;await refresh.click();await page.waitForFunction(()=>(window as any).app.usage.error==='unavailable');
  await t.test('a failed refresh keeps the earlier totals beside one alert',async()=>{
   assert.deepEqual(await messages.allTextContents(),[c.unavailable]);assert.equal(await usage.locator('.usage-groups').count(),1);
  });
  await page.evaluate(()=>{const app=(window as any).app;app.usage.summary=undefined;app.usage.error=undefined;app.draw();});
  await t.test('an idle empty view still explains that totals are unavailable',async()=>{
   assert.deepEqual(await messages.allTextContents(),[c.usageUnavailable]);assert.equal(await usage.getByRole('status').count(),1);
  });
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{release();await browser.close();}
});
