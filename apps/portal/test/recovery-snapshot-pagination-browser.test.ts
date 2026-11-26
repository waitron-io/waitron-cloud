import {mockActionProof} from './action-proof-fixture.ts';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const venue='20000000-0000-4000-8000-000000000001',first='20000000-0000-4000-8000-000000000002',request='20000000-0000-4000-8000-000000000004';
const stamp='2026-11-10T09:05:09.000Z',expiry='2026-12-10T09:05:09.000Z';
const installation={installationId:venue,venueId:venue,organisationId:venue,legalBusinessId:venue,environment:'test',revision:0,revokedAt:null,lastContactAt:stamp,leaseExpiresAt:expiry,canRevoke:true,
 overview:{organisationName:'Sol SL',businessName:'Café Sol',countryCode:'ES',latestSnapshotAt:stamp,verifiedSnapshotAt:stamp},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'ready',health:'healthy',failure:null,observedAt:stamp}))};
const point={id:first,capturedAt:stamp,verification:'verified',retention:'daily',expiresAt:expiry,protection:'fallback'};
const continuous={recoverableAt:'2026-11-11T09:05:09.000Z',checkedAt:'2026-11-11T09:05:30.000Z',sourceNodeId:venue};
const pending={requestId:request,state:'awaiting_owner',expiresAt:expiry,operationId:null,operation:null};
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: snapshot approval leaves the checked copy for the replacement server`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,timezoneId:'UTC',viewport:{width,height:900}});page.setDefaultTimeout(3000);
  await page.clock.install({time:new Date('2026-11-11T12:00:00Z')});
  const approvals:unknown[]=[];
  await page.route('https://portal.test/**',route=>{
   const path=new URL(route.request().url()).pathname;
   const proof=mockActionProof(route,true);if(proof)return proof;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:expiry}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[installation]}});
   if(path.endsWith('/recovery/inspect'))return route.fulfill({json:pending});
   if(path.endsWith('/backups/list'))return route.fulfill({json:{venueId:venue,points:[point],nextCursor:'next',defaultPointId:first,continuousRecovery:continuous}});
   if(path.endsWith('/recovery/approve')){approvals.push(route.request().postDataJSON());return route.fulfill({json:{...pending,state:'approved',operationId:request,operation:{id:request,venueId:venue,pointId:null,source:{kind:'snapshot',pointId:null},mode:'failure',status:'pending',expiresAt:expiry}}});}
   if(path.startsWith('/api/'))return route.fulfill({status:503,json:{error:'unavailable'}});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
  });
  await page.goto(`https://portal.test/recover#request=${request}&lang=${locale}`);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const c=translations[locale];
  await page.waitForFunction(()=>(window as any).app.installations.loaded);
  await page.locator('wt-input[name="recoveryCode"] input').fill('00123456');
  await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  await page.getByLabel(c.recoveryVenue,{exact:true}).selectOption(venue);
  const stream=page.getByRole('radio',{name:c.recoveryContinuous,exact:true}),snapshot=page.getByRole('radio',{name:c.recoverySnapshotFallback,exact:true});
  await stream.waitFor();assert.equal(await stream.isChecked(),true);
  const stopped=page.getByRole('checkbox',{name:c.recoveryStopped,exact:true}),approve=page.getByRole('button',{name:c.recoveryApprove,exact:true});
  await stopped.check();await page.getByRole('checkbox',{name:c.recoveryAcceptLoss,exact:true}).check();
  await snapshot.check();
  assert.equal(await page.getByLabel(c.chooseSnapshot,{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:c.olderSnapshots,exact:true}).count(),0);
  const loss=page.getByRole('checkbox',{name:locale==='en'?/losing.*changes.*snapshot/i:/perder.*cambios.*instantánea/i});
  assert.equal(await stopped.isChecked(),false);assert.equal(await loss.isChecked(),false);assert.equal(await approve.isEnabled(),false);
  assert.match(await page.locator('p').filter({hasText:locale==='en'?/choose.*snapshot.*replacement server/i:/elige.*instantánea.*servidor de sustitución/i}).innerText(),locale==='en'?/changes.*lost/i:/se perderán.*cambios/i);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.RECOVERY_APPROVAL_RECEIPT_DIR){await mkdir(process.env.RECOVERY_APPROVAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_APPROVAL_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
  await stopped.check();assert.equal(await approve.isEnabled(),false);await loss.check();
  await approve.click();await page.getByText(c.recoveryApprovedSnapshot,{exact:true}).waitFor();
  assert.deepEqual(approvals,[{requestId:request,code:'00123456',source:'snapshot',venueId:venue,oldServerUnavailable:'true',acceptDataLoss:'true'}]);
 }finally{await browser.close();}
});
