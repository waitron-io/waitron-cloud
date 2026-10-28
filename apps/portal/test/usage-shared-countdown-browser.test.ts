import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
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
// One panel becoming ready must leave the other panel’s remaining wait visible.
for(const waits of [{usage:2,alerts:5},{usage:5,alerts:2}])for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: shared countdown retains usage ${waits.usage}s and alerts ${waits.alerts}s`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  await page.addInitScript(() => {
   const clock = {wall: Date.parse('2026-10-28T10:00:00.000Z'), elapsed: 0};
   (window as any).usageClock = clock; Date.now = () => clock.wall;
   performance.now = () => clock.elapsed;
  });
  let reads=0,alertReads=0;
  const unexpected:string[]=[];
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:'2027-01-01T00:00:00.000Z'}});
   if(path.endsWith('/usage/read')){reads++;return reads===1?route.fulfill({status:429,headers:{'Retry-After':String(waits.usage)},json:{error:'rate_limited'}}):route.fulfill({json:summary});}
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),overview:{organisationName:'Café Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}}]}});
   if(path.endsWith('/authenticator'))return route.fulfill({json:{active:false,version:0,recoveryCodesRemaining:0,available:true}});
   if(path.endsWith('/passkeys'))return route.fulfill({json:{passkeys:[]}});
   if(path.endsWith('/sessions'))return route.fulfill({json:{sessions:[{id,createdAt:'2026-10-01T00:00:00Z',lastUsedAt:'2026-10-28T10:00:00Z',expiresAt:'2027-01-01T00:00:00Z',current:true}]}});
   if(path.endsWith('/translation-consent'))return route.fulfill({json:{consents:[]}});
   if(path.endsWith('/alerts')){alertReads++;return route.fulfill({status:429,headers:{'Retry-After':String(waits.alerts)},json:{error:'rate_limited'}});}
   unexpected.push(path);return route.fulfill({status:500,json:{error:'unexpected_fixture_request'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.usage.error==='limited'&&(window as any).app.alerts.error==='limited');
  const refresh=page.locator('section.usage').getByRole('button',{name:translations[locale].usageRefresh,exact:true});
  const countdown=(seconds:number)=>page.getByText(`${translations[locale].cooldown} ${seconds} ${seconds===1?translations[locale].second:translations[locale].seconds}`,{exact:true});
  const advance=async(elapsed:number)=>{
   await page.evaluate(value=>{const w=window as any;w.usageClock.elapsed=value;w.usageClock.wall=Date.parse('2026-10-28T10:00:00.000Z')+value;w.app.draw();},elapsed);
  };
  assert.equal(await countdown(5).isVisible(),true);
  assert.equal(await refresh.isDisabled(),true);assert.equal(reads,1);assert.equal(alertReads,1);
  await advance(1_999);
  assert.equal(await countdown(4).isVisible(),true);assert.equal(await refresh.isDisabled(),true);
  await advance(2_000);
  assert.equal(await countdown(3).isVisible(),true);
  assert.equal(await refresh.isDisabled(),waits.usage===5);
  assert.equal(await page.evaluate(()=>(window as any).app.alerts.waiting),waits.alerts===5?3:0);
  assert.equal(reads,1);assert.equal(alertReads,1);
  if(waits.usage===2){
   await refresh.click();await page.waitForFunction(()=>(window as any).app.usage.loaded);
   assert.equal(reads,2);assert.equal(await page.evaluate(()=>(window as any).app.usage.summary.storage.currentBytes),'1536');
   assert.equal(await countdown(3).isVisible(),true);
   assert.equal(await page.evaluate(()=>(window as any).app.alerts.waiting),3);
  }
  await advance(4_999);assert.equal(await countdown(1).isVisible(),true);
  assert.equal(await refresh.isDisabled(),waits.usage===5);
  await advance(5_000);
  assert.equal(await page.evaluate(()=>(window as any).app.waiting),0);
  assert.equal(await page.getByRole('status').filter({hasText:translations[locale].cooldown}).count(),0);
  assert.equal(await refresh.isEnabled(),true);
  assert.equal(reads,waits.usage===2?2:1);assert.equal(alertReads,1);
  if(waits.usage===5){
   await refresh.click();await page.waitForFunction(()=>(window as any).app.usage.loaded);
   assert.equal(reads,2);assert.equal(await page.evaluate(()=>(window as any).app.usage.summary.storage.currentBytes),'1536');
  }
  assert.deepEqual(unexpected,[]);
 }finally{await browser.close();}
});
