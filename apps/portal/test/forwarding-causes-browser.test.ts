import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import axe from 'axe-core';
import {translations} from '../src/locale.ts';
import type {RemoteView} from '../src/remote-types.ts';

const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const id='12345678-1234-4234-8234-123456789abc';
const original:RemoteView={installationId:id,revision:1,revoked:false,
 names:{staff:{assigned:'staff.venue.example',current:'staff.venue.example'},public:{assigned:'venue.example',current:'venue.example'}},
 service:{state:'ready',health:'healthy',observedAt:'2026-10-25T10:00:00Z',validUntil:'2099-01-01T00:00:00Z'}};


const outcomes={
 upstream_non_200:['The venue application returned an unsuccessful response.','La aplicación del local devolvió una respuesta no satisfactoria.'],
 upstream_timeout:['The connection to the venue application timed out.','Se agotó el tiempo de conexión con la aplicación del local.'],
 upstream_response_limit:['The venue application response exceeded the gateway limit.','La respuesta de la aplicación del local superó el límite de la pasarela.'],
 upstream_transport:['The gateway could not complete the connection to the venue application.','La pasarela no pudo completar la conexión con la aplicación del local.'],
 forward_internal:['The gateway could not complete this forwarding attempt.','La pasarela no pudo completar este intento de conexión.'],
 success:['The last recorded forward succeeded.','El último intento registrado se completó.'],
 unknown:['No current forwarding result is available.','No hay un resultado de conexión vigente.'],
};
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: forwarding categories, expiry and refresh keep private evidence current`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(3000);
  const c=translations[locale],language=locale==='en'?0:1,now=Date.now();let saved:RemoteView=structuredClone(original),reads=0;
  await page.clock.install({time:now});
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname.replace('/api/account','');
   if(path==='/session'||path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
   if(path==='/installations')return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))}]}});
   if(path==='/remote-access/status'){reads++;return route.fulfill({json:saved});}
   return route.fulfill({status:503,json:{error:'unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});await page.getByRole('button',{name:c.remoteSetup,exact:true}).waitFor();
  const heading=locale==='en'?'Last recorded forwarding attempt':'Último intento de conexión registrado';
  for(const [category,text] of Object.entries(outcomes)){
   saved={...original,publicForward:category==='unknown'?null:{category:category==='success'?null:category as any,observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+10000).toISOString()}};
   await page.evaluate(id=>(window as any).app.remote.open(id),id);
   const panel=page.getByRole('region',{name:heading,exact:true});await panel.waitFor();await panel.getByText(text[language]!,{exact:true}).waitFor();
   assert.equal(await panel.locator('time').count(),category==='unknown'?0:2);
   if(!['success','unknown'].includes(category))await panel.getByText(locale==='en'?'Check the venue application and its connection. Gateway configuration still requires operator tools.':'Comprueba la aplicación del local y su conexión. La configuración de la pasarela sigue requiriendo herramientas de operador.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.FORWARDING_RECEIPT_DIR){await mkdir(process.env.FORWARDING_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.FORWARDING_RECEIPT_DIR}/${locale}-${theme}-${width}-${category}.png`,fullPage:true});}
  }
  saved={...original,publicForward:{category:'upstream_timeout',observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+10000).toISOString()}};
  await page.evaluate(id=>(window as any).app.remote.open(id),id);const before=reads;
  await page.clock.runFor(11000);await page.getByText(outcomes.unknown[language]!,{exact:true}).waitFor();assert.equal(reads,before,'expiry clears without fetching');
  saved={...original,publicForward:{category:null,observedAt:new Date(now+10000).toISOString(),expiresAt:new Date(now+30000).toISOString()}};
  await page.locator('.remote-setup').getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.getByText(outcomes.success[language]!,{exact:true}).waitFor();assert.equal(reads,before+1);
  await page.locator('.remote-setup').getByRole('button',{name:c.refreshStatus,exact:true}).focus();assert(await page.locator('.remote-setup').getByRole('button',{name:c.refreshStatus,exact:true}).evaluate(button=>button===document.activeElement||button===document.activeElement?.shadowRoot?.activeElement));
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert(!((await page.locator('#portal').textContent())??'').includes(outcomes.success[language]!), 'pagehide erases private evidence before drawing');
  const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));for(const privateValue of ['upstream_timeout','publicForward','observedAt'])assert(!stored.includes(privateValue));
 }finally{await browser.close();}
});
