import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium,type Page} from 'playwright';
import axe from 'axe-core';
import {translations} from '../src/locale.ts';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);window.app=new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const sdk=`window.mounts=0;window.unmounts=0;window.SumUpCard={mount(options){window.mounts++;window.cardOptions=options;window.cardReply=options.onResponse;const frame=document.createElement('iframe');frame.title='Synthetic provider card';frame.src='https://gateway.sumup.com/synthetic-frame';document.getElementById(options.id).append(frame);return {unmount(){window.unmounts++;frame.remove();}};}};`;
async function fixture(page:Page,ordinary=false){
 let selected:'card'|'direct_debit'|null='direct_debit',setup:unknown=null,verifyState='pending',starts=0,verifies=0;
 await page.route('https://portal.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/app.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0]!.text});
  if(path==='/app.css')return route.fulfill({contentType:'text/css',body:styles});
  if(path==='/account')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="portal" class="portal"></div><script src="/app.js"></script>'});
  if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString(),billingTrialAvailable:true}});
  if(path.endsWith('/installations'))return route.fulfill({json:{installations:[]}});
  if(path.endsWith('/billing/read'))return route.fulfill({json:{venues:[first,second].map(venueId=>({venueId,level:'connected',trial:null,canStartTrial:false,...ordinary?{}:{paymentMethods:{selected,setup}}}))}});
  if(path.endsWith('/method/start')){
   starts++;const body=route.request().postDataJSON();assert.deepEqual(body,{venueId:first,kind:body.kind});
   setup={kind:body.kind,state:'pending'};
   return route.fulfill({json:body.kind==='card'?{checkoutId:'synthetic-'+starts}:{url:'https://checkout.stripe.com/c/pay/synthetic'}});
  }
  if(path.endsWith('/method/verify')){
   verifies++;assert.deepEqual(route.request().postDataJSON(),{venueId:first});
   if(verifyState==='verified')selected=(setup as {kind:'card'|'direct_debit'}).kind;
   if(setup)setup={...(setup as object),state:verifyState};return route.fulfill({json:{state:verifyState}});
  }
  return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
 });
 await page.route('https://gateway.sumup.com/**',route=>route.fulfill({contentType:route.request().resourceType()==='script'?'text/javascript':'text/html',body:route.request().resourceType()==='script'?sdk:'<!doctype html><title>Synthetic card fields</title><p>Provider test fields</p>'}));
 await page.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic mandate</title><p>Provider test mandate</p><a href="https://portal.test/account">Return</a>'}));
 return {set pending(kind:'card'|'direct_debit'){setup={kind,state:'pending'};},set state(value:string){verifyState=value;},get starts(){return starts;},get verifies(){return verifies;}};
}
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: test payment panel preserves a method through pending and failed card setup`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(5000);const server=await fixture(page);
  await page.goto('https://portal.test/account');
  const panel=page.getByRole('region',{name:locale==='en'?'Test payment method':'Método de pago de prueba',exact:true});await panel.waitFor();
  const card=panel.getByRole('button',{name:locale==='en'?'Add or switch test card':'Añadir o cambiar tarjeta de prueba',exact:true});
  const refresh=panel.getByRole('button',{name:locale==='en'?'Check saved method':'Consultar método guardado',exact:true});
  await card.focus();await page.keyboard.press('Enter');await panel.locator('iframe').waitFor();
  assert.equal(await page.evaluate(()=>(window as any).cardOptions.locale),locale==='en'?'en-GB':'es-ES');
  await refresh.click();await page.waitForFunction(()=>(window as any).app.billing.methodState==='pending');
  assert.equal(await panel.locator('iframe').count(),1);assert.equal(await page.evaluate(()=>(window as any).app.billing.venue.paymentMethods.selected),'direct_debit');
  if(process.env.BILLING_METHOD_RECEIPT_DIR){await mkdir(process.env.BILLING_METHOD_RECEIPT_DIR,{recursive:true});await panel.screenshot({path:process.env.BILLING_METHOD_RECEIPT_DIR+'/pending-'+locale+'-'+theme+'-'+width+'.png'});}
  server.state='failed';await refresh.click();await page.waitForFunction(()=>(window as any).app.billing.methodState==='failed');assert.equal(await panel.locator('iframe').count(),0);
  assert.equal(await page.evaluate(()=>(window as any).app.billing.venue.paymentMethods.selected),'direct_debit');
  await card.click();await panel.locator('iframe').waitFor();server.state='verified';await page.evaluate(()=>(window as any).cardReply('success',{token:'untrusted-browser-value'}));
  await page.waitForFunction(()=>(window as any).app.billing.venue.paymentMethods.selected==='card');assert.equal(await panel.locator('iframe').count(),0);assert.equal(server.starts,2);assert.equal(server.verifies,3);
  assert.equal(await page.evaluate(()=>(window as any).unmounts),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(axe.source);assert.deepEqual((await page.evaluate(async()=>(await (window as any).axe.run(document)).violations)).map((v:any)=>({id:v.id,nodes:v.nodes.map((n:any)=>n.target)})),[]);
  if(process.env.BILLING_METHOD_RECEIPT_DIR){await mkdir(process.env.BILLING_METHOD_RECEIPT_DIR,{recursive:true});await panel.screenshot({path:`${process.env.BILLING_METHOD_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});}
 }finally{await browser.close();}
});

test('Stripe test redirect returns to plain account and verifies the saved setup without a browser reference',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);const server=await fixture(page);await page.goto('https://portal.test/account');
  await page.getByRole('button',{name:'Add or switch test direct debit',exact:true}).click();await page.waitForURL('https://checkout.stripe.com/c/pay/synthetic');server.state='verified';
  await page.getByRole('link',{name:'Return',exact:true}).click();await page.waitForURL('https://portal.test/account');
  await page.getByRole('button',{name:'Check saved method',exact:true}).click();await page.waitForFunction(()=>(window as any).app.billing.venue.paymentMethods.setup.state==='verified');assert.equal(server.starts,1);assert.equal(server.verifies,1);
 }finally{await browser.close();}
});
for(const boundary of ['venue','account','pagehide'] as const)test(`card widget is removed on ${boundary} and its old callback cannot verify`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);const server=await fixture(page);await page.goto('https://portal.test/account');await page.getByRole('button',{name:'Add or switch test card',exact:true}).click();await page.locator('billing-card iframe').waitFor();
  await page.evaluate(boundary=>{const app=(window as any).app;if(boundary==='venue')app.billing.select('22222222-2222-4222-8222-222222222222');else if(boundary==='account'){app.billing.account('other');app.draw();}else window.dispatchEvent(new PageTransitionEvent('pagehide'));},boundary);
  assert.equal(await page.evaluate(()=>(window as any).unmounts),1);await page.evaluate(()=>(window as any).cardReply('success',{}));await page.waitForLoadState('networkidle');assert.equal(server.verifies,0);assert.equal(await page.locator('billing-card iframe').count(),0);
 }finally{await browser.close();}
});

test('ordinary billing discovery neither shows payment controls nor downloads a provider script',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);await fixture(page,true);let requests=0;page.on('request',request=>{if(new URL(request.url()).hostname==='gateway.sumup.com')requests++;});await page.goto('https://portal.test/account');await page.getByRole('region',{name:translations.en.billingTitle,exact:true}).waitFor();assert.equal(await page.locator('billing-card').count(),0);assert.equal(await page.getByRole('button',{name:'Add or switch test card',exact:true}).count(),0);assert.equal(requests,0);
 }finally{await browser.close();}
});

test('a late script load cannot mount a card after the account changes',async()=>{
 const browser=await chromium.launch({headless:true});let release!:()=>void;const delayed=new Promise<void>(resolve=>release=resolve);try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);await fixture(page);let requested!:()=>void;const requesting=new Promise<void>(resolve=>requested=resolve);
  await page.route('https://gateway.sumup.com/**/sdk.js',async route=>{requested();await delayed;await route.fulfill({contentType:'text/javascript',body:sdk});});
  await page.goto('https://portal.test/account');await page.getByRole('button',{name:'Add or switch test card',exact:true}).click();await requesting;
  await page.evaluate(()=>{const app=(window as any).app;app.billing.account('other');app.draw();});release();await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>(window as any).mounts),0);assert.equal(await page.locator('billing-card iframe').count(),0);
 }finally{release();await browser.close();}
});

test('a failed provider script can be retried only by starting a fresh setup',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);const server=await fixture(page);let scripts=0;
  await page.route('https://gateway.sumup.com/**/sdk.js',route=>++scripts===1?route.abort():route.fulfill({contentType:'text/javascript',body:sdk}));
  await page.goto('https://portal.test/account');const start=page.getByRole('button',{name:'Add or switch test card',exact:true});await start.click();await page.getByRole('alert').filter({hasText:'We could not confirm the setup.'}).waitFor();
  await start.click();await page.locator('billing-card iframe').waitFor();assert.equal(server.starts,2);assert.equal(scripts,2);
 }finally{await browser.close();}
});

test('navigation away from account discards an in-flight Stripe redirect',async()=>{
 const browser=await chromium.launch({headless:true});let release!:()=>void;const delayed=new Promise<void>(resolve=>release=resolve);try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);await fixture(page);let entered!:()=>void;const waiting=new Promise<void>(resolve=>entered=resolve);
  await page.route('**/api/account/billing/method/start',async route=>{entered();await delayed;await route.fulfill({json:{url:'https://checkout.stripe.com/c/pay/late'}});});
  await page.goto('https://portal.test/account');await page.getByRole('button',{name:'Add or switch test direct debit',exact:true}).click();await waiting;
  await page.evaluate(()=>(window as any).app.navigate('/login'));release();await page.waitForLoadState('networkidle');assert.equal(page.url(),'https://portal.test/login');
 }finally{release();await browser.close();}
});

test('a reopened card still tears down on the next pagehide after a history return',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);const server=await fixture(page);await page.goto('https://portal.test/account');
  await page.getByRole('button',{name:'Add or switch test card',exact:true}).click();await page.locator('billing-card iframe').waitFor();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.evaluate(()=>(window as any).unmounts),1);
  await page.evaluate(async()=>{const app=(window as any).app;app.billing.account('owner');await app.billing.load();});
  await page.getByRole('button',{name:'Add or switch test card',exact:true}).click();await page.locator('billing-card iframe').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await page.evaluate(()=>(window as any).unmounts),2);assert.equal(await page.locator('billing-card iframe').count(),0);
  await page.evaluate(()=>(window as any).cardReply('success',{}));await page.waitForLoadState('networkidle');assert.equal(server.verifies,0);
 }finally{await browser.close();}
});

for(const locale of ['en','es'] as const)test(`${locale}: an unverified setup read gives a neutral refresh instruction without claiming provider progress`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({locale});page.setDefaultTimeout(5000);const server=await fixture(page);server.pending='card';await page.goto('https://portal.test/account');
  await page.getByText(locale==='en'?'Setup is not confirmed. Check the saved method before starting again. Your previous method stays selected.':'La configuración no está confirmada. Consulta el método guardado antes de volver a empezar. El anterior sigue seleccionado.',{exact:true}).waitFor();
  assert.equal(server.verifies,0);assert.equal(server.starts,0);
 }finally{await browser.close();}
});
