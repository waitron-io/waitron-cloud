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
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: usage retry display expires after elapsed time despite a backward clock`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  await page.addInitScript(() => {
   const clock = {wall: Date.parse('2026-10-28T10:00:00.000Z'), elapsed: 0};
   (window as any).usageClock = clock; Date.now = () => clock.wall;
   performance.now = () => clock.elapsed;
  });
  let reads=0;
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:'2027-01-01T00:00:00.000Z'}});
   if(path.endsWith('/usage/read')){reads++;return reads===1?route.fulfill({status:429,headers:{'Retry-After':'2'},json:{error:'rate_limited'}}):route.fulfill({json:summary});}
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),overview:{organisationName:'Café Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}}]}});
   if(path.endsWith('/authenticator'))return route.fulfill({json:{active:false,version:0,recoveryCodesRemaining:0,available:true}});
   if(path.endsWith('/passkeys'))return route.fulfill({json:{passkeys:[]}});
   if(path.endsWith('/sessions'))return route.fulfill({json:{sessions:[{id,createdAt:'2026-10-01T00:00:00Z',lastUsedAt:'2026-10-28T10:00:00Z',expiresAt:'2027-01-01T00:00:00Z',current:true}]}});
   if(path.endsWith('/translation-consent'))return route.fulfill({json:{consents:[]}});
   if(path.endsWith('/alerts'))return route.fulfill({json:{enabled:false,locale}});
   throw new Error(`unplanned account endpoint: ${path}`);
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.usage.error==='limited');
  const refresh=page.locator('section.usage').getByRole('button',{name:translations[locale].usageRefresh,exact:true});
  assert.equal(await page.evaluate(()=>(window as any).app.waiting),2);
  await page.evaluate(() => { (window as any).usageClock.wall -= 3_600_000; });
  await page.evaluate(()=>(window as any).app.draw());
  assert.equal(await page.evaluate(()=>(window as any).app.waiting),2);
  assert.equal(await refresh.isDisabled(),true);assert.equal(reads,1);
  await page.evaluate(() => { (window as any).usageClock.elapsed = 1_999; (window as any).app.draw(); });
  assert.equal(await page.evaluate(()=>(window as any).app.waiting),1);assert.equal(await refresh.isDisabled(),true);
  await page.evaluate(() => { (window as any).usageClock.elapsed = 2_000; (window as any).app.draw(); });
  assert.equal(await page.evaluate(()=>(window as any).app.waiting),0);assert.equal(await refresh.isEnabled(),true);assert.equal(reads,1);
  if(process.env.USAGE_CLOCK_RECEIPT_DIR){await mkdir(process.env.USAGE_CLOCK_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.USAGE_CLOCK_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
  await refresh.click();await page.waitForFunction(()=>(window as any).app.usage.loaded);
  assert.equal(reads,2);assert.equal(await page.evaluate(()=>(window as any).app.usage.summary.storage.currentBytes),'1536');
 }finally{await browser.close();}
});
