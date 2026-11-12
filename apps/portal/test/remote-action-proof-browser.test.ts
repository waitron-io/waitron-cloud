import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import axe from 'axe-core';
import {translations} from '../src/locale.ts';
const id='12345678-1234-4234-8234-123456789abc';
const view={installationId:id,revision:1,revoked:false,names:{staff:{assigned:'staff.venue.example',current:'staff.venue.example'},public:{assigned:'venue.example',current:'venue.example'}},service:{state:'provisioning',health:'unknown',observedAt:null,validUntil:null}};
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: remote setup asks for enrollment and proof before applying`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(3000);
  const c=translations[locale];let enrolled=false,freshUntil:string|null=null,applies=0;
  await page.route('https://portal.test/account',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname.replace('/api/account','');
   if(path==='/session'||path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
   if(path==='/action-proof')return route.fulfill({json:{methods:enrolled?['passkey','recovery']:['email'],freshUntil}});
   if(path==='/action-proof/factor'){freshUntil='2099-01-01T00:00:00Z';return route.fulfill({status:204});}
   if(path==='/installations')return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))}]}});
   if(path==='/remote-access/status')return route.fulfill({json:view});
   if(path==='/remote-access/dns')return route.fulfill({json:{installationId:id,kind:'staff',hostname:'staff.cafe.example',records:[{type:'CNAME',name:'staff.cafe.example',value:'staff.venue.example'},{type:'CNAME',name:'_acme-challenge.staff.cafe.example',value:'_acme-challenge.staff.venue.example'}]}});
   if(path==='/remote-access/apply'){applies++;return route.fulfill({json:{...view,revision:2,names:{...view.names,staff:{...view.names.staff,current:'staff.cafe.example'}}}});}
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByRole('button',{name:c.remoteSetup,exact:true}).click();const section=page.locator('.remote-setup');
  await section.locator('wt-input[name=remoteHostname] input').fill('staff.cafe.example');await section.getByRole('button',{name:c.remoteReview,exact:true}).click();
  const confirm=section.getByRole('button',{name:c.remoteConfirm,exact:true});await confirm.click();
  await section.getByText(c.pairEnrollment,{exact:true}).waitFor();assert.equal(applies,0,'enrollment guidance precedes the write');
  const capture=async(state:string)=>{await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.REMOTE_PROOF_RECEIPT_DIR){await mkdir(process.env.REMOTE_PROOF_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.REMOTE_PROOF_RECEIPT_DIR}/${locale}-${theme}-${width}-${state}.png`,fullPage:true});}};
  await capture('enroll');
  enrolled=true;await confirm.click();await section.getByText(c.actionProofUnavailable,{exact:true}).waitFor();assert.equal(applies,0,'the prompt precedes the write');await capture('proof');
  await page.locator('wt-input[name=actionProofCode] input').fill('11111111222222223333333344444444');await page.locator('.action-proof').getByRole('button',{name:c.factorRecovery,exact:true}).click();
  await page.locator('.action-proof').getByText(c.actionProofReady,{exact:true}).waitFor();await section.getByRole('alert').waitFor({state:'hidden'});assert.equal(applies,0,'verification does not apply the name');await capture('ready');
  await confirm.click();await section.getByText(c.remoteSaved,{exact:true}).waitFor();assert.equal(applies,1);
 }finally{await browser.close();}
});
