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
  const hosted='33333333-3333-4333-8333-333333333333',usedTrial='44444444-4444-4444-8444-444444444444';
  const free='55555555-5555-4555-8555-555555555555';
  const registered={level:'registered',trial:null as unknown,canStartTrial:true};
  const connectedPrice={currency:'EUR',netCents:1000,grossCents:1210};
  let venues=[
   {venueId:first,...registered},
   {venueId:second,...registered,connectedPrice},
   {venueId:hosted,...registered,level:'hosted',canStartTrial:false,connectedPrice},
   {venueId:usedTrial,...registered,canStartTrial:false,connectedPrice},
   {venueId:free,...registered,connectedPrice:{...connectedPrice,netCents:0,grossCents:0}},
  ];
  await page.route('https://portal.test/account/billing',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString(),billingTrialAvailable:true}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   if(path.endsWith('/billing/read')){reads++;return route.fulfill({json:{venues}});}
   if(path.endsWith('/billing/start-trial')){
    starts++;assert.deepEqual(route.request().postDataJSON(),{venueId:second});
    venues=venues.map(v=>v.venueId===second?{...v,level:'connected',canStartTrial:false,trial:{level:'connected',startedOn:'2026-11-07',endsOn:'2026-12-07',state:'active',extended:false}}:v);
    return route.fulfill({json:{venues}});
   }
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/account/billing');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const section=page.getByRole('region',{name:c.billingTitle,exact:true});await section.waitFor();
  const price=section.getByText(locale==='en'?'€10.00/month + VAT (€12.10)':'10,00 €/mes + IVA (12,10 €)',{exact:true});
  const timing=section.getByText(locale==='en'
   ?'In live service, we charge your saved payment method when your business’s first paid venue finishes its trial. Without one, the venue returns to Registered.'
   :'En el servicio real, cobramos con tu método de pago guardado al terminar la prueba del primer local de pago de tu empresa. Sin él, el local vuelve a Registered.',{exact:true});
  assert.equal(await price.count(),0);
  assert.equal(await timing.count(),0);
  const venueChoice=section.getByRole('combobox',{name:c.billingVenue,exact:true});
  for(const venueId of [hosted,usedTrial]){
   await venueChoice.selectOption(venueId);
   await section.getByText(venueId,{exact:true}).waitFor();
   await section.getByText(c.billingIneligible,{exact:true}).waitFor();
   assert.equal(await price.count(),0);
   assert.equal(await timing.count(),0);
  }
  await venueChoice.selectOption(free);
  await section.getByText(locale==='en'?'€0.00/month + VAT (€0.00)':'0,00 €/mes + IVA (0,00 €)',{exact:true}).waitFor();
  assert.equal(await timing.count(),0);
  await venueChoice.selectOption(second);
  await price.waitFor();
  await timing.waitFor();
  const start=section.getByRole('button',{name:c.billingStart,exact:true});await start.focus();await page.keyboard.press('Enter');
  await section.locator('time').waitFor();assert.equal(starts,1);assert.equal(reads,1);
  await price.waitFor();
  await timing.waitFor();
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

for(const status of [403,503])test(`unavailable trial chooser ${status} adds no refused-account panel`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(4000);
  await page.route('https://portal.test/account/billing',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session'))return route.fulfill({json:{accountId:'ordinary',expiresAt:new Date(Date.now()+3600000).toISOString(),billingTrialAvailable:true}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   return route.fulfill({status:path.endsWith('/billing/read')?status:503,json:{error:path.endsWith('/billing/read')&&status===403?'permission_denied':'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/account/billing');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>{const billing=(window as any).app.billing;return billing.loadAttempted&&!billing.pending;});
  assert.equal(await page.getByRole('region',{name:translations.en.billingTitle,exact:true}).count(),0);
  await page.getByText('We could not load billing details.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).isEnabled(),true);
 }finally{await browser.close();}
});

for(const hint of [undefined,false,'true'])test(`ordinary or malformed discovery ${JSON.stringify(hint)} never requests billing, including activity`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(4000);let reads=0,activities=0;
  await page.route('https://portal.test/account/billing',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity')){
    if(path.endsWith('/activity'))activities++;
    return route.fulfill({json:{accountId:'ordinary',expiresAt:new Date(Date.now()+3600000).toISOString(),...(hint===undefined?{}:{billingTrialAvailable:hint})}});
   }
   if(path.endsWith('/billing/read'))reads++;
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/account/billing');await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>['authenticated','unavailable'].includes((window as any).app.session.state.kind));
  if(hint===undefined){
   await page.waitForURL('https://portal.test/account');
   const activity=page.waitForResponse('**/session/activity');await page.keyboard.press('Tab');await activity;
  }
  await page.waitForLoadState('networkidle');
  assert.equal(reads,0);assert.equal(activities,hint===undefined?1:0);
  assert.equal(await page.getByRole('region',{name:translations.en.billingTitle,exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>(window as any).app.session.state.kind),hint===undefined?'authenticated':'unavailable');
 }finally{await browser.close();}
});

for(const retain of [false,true])test(`activity ${retain?'retains discovery':'fences a late billing read and allows one new read when discovery returns'}`,async()=>{
 const browser=await chromium.launch({headless:true});let release!:()=>void;
 const reply=new Promise<void>(resolve=>{release=resolve;});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(4000);let reads=0,hint=true;
  await page.route('https://portal.test/account/billing',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString(),...(hint?{billingTrialAvailable:true}:{})}});
   if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
   if(path.endsWith('/billing/read')){reads++;if(reads===1)await reply;return route.fulfill({json:{venues:[{venueId:first,level:'registered',trial:null,canStartTrial:true}]}});}
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/account/billing');await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.waitForFunction(()=>(window as any).app.billing.pending);
  hint=retain;const activity=page.waitForResponse('**/session/activity');await page.keyboard.press('Tab');await activity;
  await page.waitForFunction((expected)=>(window as any).app.session.state.billingTrialAvailable===expected,retain?true:undefined);
  release();await page.waitForLoadState('networkidle');
  const section=page.getByRole('region',{name:translations.en.billingTitle,exact:true});
  assert.equal(reads,1);assert.equal(await section.count(),retain?1:0);
  if(!retain){
   assert.deepEqual(await page.evaluate(()=>(window as any).app.billing.venues),[]);
   hint=true;await page.evaluate(()=>(window as any).app.session.check());
   await page.getByRole('navigation',{name:translations.en.accountNav}).getByRole('link',{name:'Billing',exact:true}).click();
   await section.waitFor();
   await page.waitForLoadState('networkidle');assert.equal(reads,2);
  }
 }finally{release();await browser.close();}
});
