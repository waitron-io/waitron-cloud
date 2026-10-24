import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
import {validRecoveryView, type RecoveryView} from '../src/recovery-types.ts';

const stamp='2026-11-10T09:05:09.000Z', expiry='2026-12-10T09:05:09.000Z';
const venue='20000000-0000-4000-8000-000000000001', point='20000000-0000-4000-8000-000000000002', request='20000000-0000-4000-8000-000000000003';
const installation={installationId:venue,venueId:venue,organisationId:venue,legalBusinessId:venue,environment:'test',revision:0,revokedAt:null,lastContactAt:stamp,leaseExpiresAt:expiry,canRevoke:true,
 overview:{organisationName:'Sol SL',businessName:'Café Sol',countryCode:'ES',latestSnapshotAt:stamp,verifiedSnapshotAt:stamp},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'ready',health:'healthy',failure:null,observedAt:stamp})),
 monitoring:{enabled:true,fresh:true,checkedAt:stamp,incidents:[{kind:'disconnected',openedAt:stamp,changedAt:stamp},{kind:'public_certificate_expiring',openedAt:stamp,changedAt:stamp}],remoteChecks:{public:{status:'healthy',checkedAt:stamp,certificateNotAfter:expiry},staff:{status:'healthy',checkedAt:stamp,certificateNotAfter:expiry}}},
};
const approved: RecoveryView={requestId:request,state:'approved',expiresAt:expiry,operationId:request,operation:{id:request,venueId:venue,pointId:null,source:{kind:'continuous',recoverableAt:stamp,sourceNodeId:venue},mode:'failure',status:'pending',expiresAt:expiry}};
assert(validRecoveryView(approved));
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: installation, backup, monitoring and recovery dates name the month`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,timezoneId:'Europe/Madrid',viewport:{width,height:900}});page.setDefaultTimeout(3000);
  await page.clock.install({time:new Date('2026-11-11T12:00:00Z')});
  await page.route('https://portal.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:expiry}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[installation]}});
   if(path.endsWith('/backups/list'))return route.fulfill({json:{venueId:venue,points:[{id:point,capturedAt:stamp,verification:'verified',retention:'daily',expiresAt:expiry,protection:'fallback'}],nextCursor:null,defaultPointId:point,continuousRecovery:{recoverableAt:stamp,checkedAt:stamp,sourceNodeId:venue}}});
   if(path.startsWith('/api/'))return route.fulfill({status:503,json:{error:'unavailable'}});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.installations.loaded);
  const c=translations[locale], expected=locale==='en'?/^November 10, 2026(?: at|,) 10:05:09 AM$/:/^10 de noviembre de 2026(?: a las|,) 10:05:09$/, expectedExpiry=locale==='en'?/^December 10, 2026(?: at|,) 10:05:09 AM$/:/^10 de diciembre de 2026(?: a las|,) 10:05:09$/;
  const assertTimes=async(minimum:number)=>{
   const times=await page.locator('time').evaluateAll(nodes=>nodes.map(node=>({value:node.getAttribute('datetime'),text:node.textContent})));
   assert(times.length>=minimum);
   for(const time of times){assert([stamp,expiry].includes(time.value!));assert.match(time.text!,time.value===stamp?expected:expectedExpiry);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  };
  await assertTimes(9);
  await page.getByRole('button',{name:c.viewSnapshots,exact:true}).click();await page.getByLabel(c.chooseSnapshot,{exact:true}).waitFor();
  await assertTimes(11);assert((await page.locator('option:checked').allTextContents()).some(text=>text.startsWith(locale==='en'?'November 10, 2026':'10 de noviembre de 2026')));
  if(process.env.DATES_RECEIPT_DIR){await mkdir(process.env.DATES_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.DATES_RECEIPT_DIR}/${locale}-${theme}-${width}-account.png`,fullPage:true});}
  await page.evaluate(({request,expiry})=>{
   const app=(window as any).app;app.path='/recover';app.recovery.open(request);app.recovery.code='12345678';
   app.recovery.view={requestId:request,state:'awaiting_owner',expiresAt:expiry,operationId:null,operation:null};app.draw();
  },{request,expiry});
  for(const source of ['snapshot','continuous'] as const){
   await page.getByRole('radio',{name:source==='snapshot'?c.recoverySnapshotFallback:c.recoveryContinuous,exact:true}).check();
   const loss=page.locator('strong').filter({hasText:c.recoveryLoss});assert.match((await loss.textContent())!.slice(c.recoveryLoss.length).trim(),expected);
   assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).isEnabled(),false);
   await assertTimes(source==='snapshot'?5:3);
   if(process.env.DATES_RECEIPT_DIR)await page.screenshot({path:`${process.env.DATES_RECEIPT_DIR}/${locale}-${theme}-${width}-${source}.png`,fullPage:true});
  }
  await page.evaluate(approved=>{const app=(window as any).app;app.recovery.view=approved;app.draw();},approved);
  await assertTimes(2);
 }finally{await browser.close();}
});
