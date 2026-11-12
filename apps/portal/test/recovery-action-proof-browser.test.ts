import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import axe from 'axe-core';
import {translations} from '../src/locale.ts';
const id='12345678-1234-4234-8234-123456789abc',pointId='22345678-1234-4234-8234-123456789abc',venueId='32345678-1234-4234-8234-123456789abc',expiresAt='2099-01-01T00:00:00.000Z';
const pending={requestId:id,state:'awaiting_owner',expiresAt,operationId:null,operation:null};
const approved={...pending,state:'approved',operationId:id,operation:{id,pointId,venueId,source:{kind:'snapshot',pointId},mode:'failure',status:'pending',expiresAt}};
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);window.app=new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: recovery asks for enrollment and proof before authorising data`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(3000);
  page.on('pageerror',error=>console.error(error));
  const c=translations[locale];let enrolled=false,freshUntil:string|null=null,approvals=0;let view:typeof pending|typeof approved=pending;
  await page.route('https://portal.test/recover',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname.replace('/api/account','');
   if(path==='/session'||path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt}});
   if(path==='/action-proof')return route.fulfill({json:{methods:enrolled?['passkey','recovery']:['email'],freshUntil}});
   if(path==='/action-proof/factor'){freshUntil=expiresAt;return route.fulfill({status:204});}
   if(path==='/installations')return route.fulfill({json:{installations:[{installationId:id,venueId,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,overview:{organisationName:'Café Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))}]}});
   if(path==='/backups/list')return route.fulfill({json:{venueId,points:[{id:pointId,capturedAt:'2026-11-12T10:00:00.000Z',verification:'verified',retention:'daily',expiresAt,protection:null}],nextCursor:null,defaultPointId:pointId,continuousRecovery:null}});
   if(path==='/recovery/inspect')return route.fulfill({json:view});
   if(path==='/recovery/approve'){assert.deepEqual(route.request().postDataJSON(),{requestId:id,code:'12345678',source:'snapshot',pointId,oldServerUnavailable:'true',acceptDataLoss:'true'});approvals++;view=approved;return route.fulfill({json:approved});}
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/recover#request='+id);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByRole('textbox',{name:c.pairCode,exact:true}).fill('12345678');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  await page.getByLabel(c.recoveryVenue,{exact:true}).selectOption(venueId);await page.getByLabel(c.recoveryStopped,{exact:true}).check();await page.getByLabel(c.recoveryAcceptLoss,{exact:true}).check();
  const approve=page.getByRole('button',{name:c.recoveryApprove,exact:true});await approve.click();await page.waitForLoadState('networkidle');
  assert.equal(approvals,0,'an unenrolled session never queues recovery approval');await page.getByText(c.pairEnrollment,{exact:true}).waitFor();
  const capture=async(state:string)=>{await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.RECOVERY_PROOF_RECEIPT_DIR){await mkdir(process.env.RECOVERY_PROOF_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_PROOF_RECEIPT_DIR}/${locale}-${theme}-${width}-${state}.png`,fullPage:true});}};
  await capture('enroll');enrolled=true;await approve.click();await page.waitForLoadState('networkidle');
  assert.equal(approvals,0,'the proof prompt never queues recovery approval');await page.locator('.action-proof').waitFor();await capture('proof');
  await page.locator('wt-input[name=actionProofCode] input').fill('11111111222222223333333344444444');
  await page.locator('.action-proof').getByRole('button',{name:c.factorRecovery,exact:true}).click();await page.locator('.action-proof').getByText(c.actionProofReady,{exact:true}).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(approvals,0,'verification needs an explicit recovery click afterwards');await capture('ready');
  await approve.click();await page.getByText(c.recoveryApprovedSnapshot,{exact:true}).waitFor();assert.equal(approvals,1);
  const reauthoriseHelp=locale==='en'?'If the server asks, authorise this recovery again.':'Si el servidor lo pide, vuelve a autorizar esta recuperación.';
  assert.equal(await page.getByText(reauthoriseHelp,{exact:true}).count(),1);await capture('approved');
  freshUntil=null;await page.goto('about:blank');await page.goto('https://portal.test/recover#request='+id);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByRole('textbox',{name:c.pairCode,exact:true}).fill('12345678');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  await page.getByText(c.recoveryApprovedSnapshot,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).count(),1,'a pending operation can be authorised again');
  assert.equal(await page.getByLabel(c.recoveryVenue,{exact:true}).count(),0,'the authorised source stays frozen');
  const existingLoss=locale==='en'?'I accept losing changes after this authorised recovery point.':'Acepto perder los cambios posteriores a este punto de recuperación autorizado.';
  assert.equal(await page.getByLabel(existingLoss,{exact:true}).count(),1);
  await capture('reauthorise-confirmations');
  await page.getByLabel(c.recoveryStopped,{exact:true}).check();await page.getByLabel(existingLoss,{exact:true}).check();
  await capture('reauthorise');await page.getByRole('button',{name:c.recoveryApprove,exact:true}).click();await page.waitForLoadState('networkidle');
  assert.equal(approvals,1,'reauthorisation waits for new proof');await page.locator('.action-proof').waitFor();await capture('reauthorise-proof');
  await page.locator('wt-input[name=actionProofCode] input').fill('11111111222222223333333344444444');
  await page.locator('.action-proof').getByRole('button',{name:c.factorRecovery,exact:true}).click();await page.locator('.action-proof').getByText(c.actionProofReady,{exact:true}).waitFor();await capture('reauthorise-ready');
  assert.equal(approvals,1,'new proof still requires an explicit reauthorisation click');
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/account/recovery/approve')&&response.request().method()==='POST'),page.getByRole('button',{name:c.recoveryApprove,exact:true}).click()]);assert.equal(approvals,2);
 }finally{await browser.close();}
});
