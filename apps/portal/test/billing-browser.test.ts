import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import axe from 'axe-core';
import {translations} from '../src/locale.ts';

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);window.app=new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: account can start a trial without an installation`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  const c=translations[locale];let starts=0,reads=0;
  let venues=[first,second].map(venueId=>({venueId,level:'registered',trial:null as unknown,canStartTrial:true}));
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   if(path.endsWith('/billing/read')){reads++;return route.fulfill({json:{venues}});}
   if(path.endsWith('/billing/start-trial')){
    starts++;assert.deepEqual(route.request().postDataJSON(),{venueId:second});
    venues=venues.map(v=>v.venueId===second?{...v,level:'connected',canStartTrial:false,trial:{level:'connected',startedOn:'2026-11-07',endsOn:'2026-12-07',state:'active',extended:false}}:v);
    return route.fulfill({json:{venues}});
   }
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const section=page.getByRole('region',{name:c.billingTitle,exact:true});await section.waitFor();
  await section.getByRole('combobox',{name:c.billingVenue,exact:true}).selectOption(second);
  const start=section.getByRole('button',{name:c.billingStart,exact:true});await start.focus();await page.keyboard.press('Enter');
  await section.locator('time').waitFor();assert.equal(starts,1);assert.equal(reads,1);
  assert.equal(await section.locator('time').getAttribute('datetime'),'2026-12-06');
  assert.equal(await section.locator('time').textContent(),locale==='en'?'6 December 2026':'6 de diciembre de 2026');
  assert.equal(await section.getByRole('button',{name:c.billingStart,exact:true}).count(),0);
  await section.getByRole('button',{name:c.billingRefresh,exact:true}).click();await page.waitForFunction(()=>(window as any).app.billing.pending===false);
  assert.equal(reads,2);assert.equal(starts,1);assert.equal(await section.locator('time').getAttribute('datetime'),'2026-12-06');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(axe.source);assert.deepEqual((await page.evaluate(async()=>(await (window as any).axe.run(document)).violations)).map((v:any)=>({id:v.id,nodes:v.nodes.map((n:any)=>n.target)})),[]);
  if(process.env.BILLING_RECEIPT_DIR){await mkdir(process.env.BILLING_RECEIPT_DIR,{recursive:true});await section.screenshot({path:`${process.env.BILLING_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});}
 }finally{await browser.close();}
});
