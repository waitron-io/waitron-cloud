import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import axe from 'axe-core';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const installationId='12345678-1234-4234-8234-123456789abc';
const staff='staff.cafe.example.test',assigned='staff.venue.example.test';

for(const locale of ['en','es'] as const)test(`the ${locale} record notice identifies only the affected address and supports rechecking`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,viewport:{width:390,height:812}});
  page.setDefaultTimeout(5000);
  const c=translations[locale],now=new Date().toISOString();
  let moved=true,fixed=false;
  const remoteView=()=>({installationId,revision:1,revoked:false,
   names:{staff:{assigned,current:staff,recordMoved:moved,certificateNotAfter:'2026-12-01T12:00:00.000Z'},
    public:{assigned:'venue.example.test',current:'venue.example.test',recordMoved:false,certificateNotAfter:null}},
   service:{state:'ready',health:'unknown',observedAt:null,validUntil:null}});
  const monitoring={enabled:true,fresh:true,checkedAt:now,incidents:[{kind:'staff_record_moved',openedAt:now,changedAt:now}],
   remoteChecks:{staff:null,public:null}};
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Waitron Cloud</title></head><body><div id="portal"></div></body></html>'}));
  await page.route('**/api/account/**',async route=>{
   switch(new URL(route.request().url()).pathname){
    case '/api/account/session':
    case '/api/account/session/activity':
     return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
    case '/api/account/installations':
     return route.fulfill({json:{installations:[{installationId,venueId:installationId,organisationId:installationId,legalBusinessId:installationId,
      environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,monitoring,
      services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))}]}});
    case '/api/account/remote-access/status':
     return route.fulfill({json:remoteView()});
    case '/api/account/remote-access/recheck':
     if(!fixed)return route.fulfill({status:400,json:{error:'dns_not_verified'}});
     moved=false;return route.fulfill({json:remoteView()});
    default:
     return route.fulfill({status:503,json:{error:'unavailable'}});
   }
  });
  await page.goto('https://portal.test/account');
  await page.addStyleTag({content:styles});
  await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByRole('group',{name:c.monitorStaff,exact:true}).getByText(c.monitorRecordMoved,{exact:true}).waitFor();
  await page.getByRole('button',{name:c.remoteSetup,exact:true}).click();
  const panel=page.getByRole('region',{name:c.remoteSetupTitle,exact:true});
  const sentence=locale==='en'
   ? 'Your DNS record for staff.cafe.example.test no longer points at Waitron Cloud. Point it back to staff.venue.example.test, or this address stops working when its certificate expires.'
   : 'Tu registro DNS de staff.cafe.example.test ya no apunta a Waitron Cloud. Vuelve a dirigirlo a staff.venue.example.test; si no, esta dirección dejará de funcionar cuando caduque su certificado.';
  const notice=panel.getByText(sentence,{exact:true});
  await notice.waitFor();
  const check=panel.getByRole('button',{name:locale==='en'?'Check again':'Comprobar de nuevo',exact:true});
  assert.equal(await check.count(),1);
  await check.click();
  await panel.getByRole('alert').getByText(c.remoteDnsWait,{exact:true}).waitFor();
  const explanation = locale === 'en'
   ? /Cloud may still have the earlier DNS answer.*wait a few minutes/i
   : /Cloud puede seguir usando la respuesta DNS anterior.*espera unos minutos/i;
  await panel.getByRole('alert').getByText(explanation).waitFor();
  assert.equal(await notice.count(),1);
  for(const width of [390,1280])for(const colorScheme of ['light','dark'] as const){
   await page.setViewportSize({width,height:812});
   await page.emulateMedia({colorScheme});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.evaluate(axe.source);
   const violations=await page.evaluate(async()=> (await window.axe.run('.remote-setup')).violations.map(v=>v.id));
   assert.deepEqual(violations,[],`${locale} ${colorScheme} ${width}`);
   const receipts=process.env.RECORD_MOVED_RECEIPT_DIR;
   if(receipts){await mkdir(receipts,{recursive:true});await panel.screenshot({path:`${receipts}/${locale}-${colorScheme}-${width}.png`});}
  }
  fixed=true;
  await check.click();
  await notice.waitFor({state:'detached'});
  assert.equal(await check.count(),0);
  await page.waitForFunction(()=>document.activeElement?.id==='remote-name-staff');
 }finally{await browser.close();}
});
