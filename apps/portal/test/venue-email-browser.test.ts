import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const csrf='A'.repeat(43),id='12345678-1234-4234-8234-123456789abc',url='https://portal.test/account/remote-access';
const labels={en:{open:'Remote access',title:'Staff email sender',reply:'Replies go to',saved:'Reply address saved.',reset:'Use standard sender',cleared:'Standard sender restored.'},
 es:{open:'Acceso remoto',title:'Remitente del correo del personal',reply:'Enviar respuestas a',saved:'Dirección de respuesta guardada.',reset:'Usar remitente habitual',cleared:'Remitente habitual restaurado.'}};

test('a venue owner can save a reply address from Remote access',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const receipts=process.env.VENUE_EMAIL_RECEIPT_DIR;
 if(receipts)await mkdir(receipts,{recursive:true});
 for(const locale of receipts?['en','es'] as const:['en'] as const)for(const colorScheme of receipts?['light','dark'] as const:['light'] as const)for(const width of receipts?[390,1280]:[390]){
  const page=await browser.newPage({locale,colorScheme,viewport:{width,height:850}});
  page.setDefaultTimeout(3500);
  await page.context().addCookies([{name:'__Host-cloud_csrf',value:csrf,url:'https://portal.test',secure:true}]);
  try{
   const c=labels[locale],requests:unknown[]=[],tokens:(string|null)[]=[];
   await page.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
   await page.route('**/api/account/**',async route=>{
    const request=route.request(),endpoint=new URL(request.url()).pathname.slice('/api/account'.length);
    if(endpoint==='/session'||endpoint==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
    if(endpoint==='/action-proof')return route.fulfill({json:{methods:['passkey'],freshUntil:'2099-01-01T00:00:00Z'}});
    if(endpoint==='/installations')return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,
     environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
     services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))}]}});
    if(endpoint==='/remote-access/status')return route.fulfill({json:{installationId:id,revision:1,revoked:false,names:null,
     service:{state:'unconfigured',health:'unknown',observedAt:null,validUntil:null},venueEmail:{replyTo:null}}});
    if(endpoint==='/venue-email/save'){
     requests.push(request.postDataJSON());
     tokens.push(await request.headerValue('x-csrf-token'));
     return route.fulfill({json:{replyTo:request.postDataJSON().replyTo||null}});
    }
    return route.fulfill({status:503,json:{error:'unavailable'}});
   });
   await page.goto(url);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
   await page.getByRole('button',{name:c.open,exact:true}).click();
   const sender=page.getByRole('region',{name:c.title,exact:true}),reply=sender.getByRole('textbox',{name:c.reply,exact:true});
   await reply.fill('office@example.test');await reply.press('Enter');
   const confirmation=sender.getByRole('status').filter({hasText:c.saved});
   await confirmation.waitFor();
   assert.deepEqual(requests,[{installationId:id,replyTo:'office@example.test'}]);
   assert.deepEqual(tokens,[csrf]);
   assert.equal(await reply.evaluate(element=>element===document.activeElement),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(receipts){
    await sender.evaluate(element=>element.scrollIntoView({block:'center'}));
    await page.screenshot({path:`${receipts}/${locale}-${colorScheme}-${width}.png`,fullPage:true});
   }
   await reply.fill('a@b');
   await confirmation.waitFor({state:'hidden'});
   await reply.press('Enter');
   await sender.getByRole('alert').waitFor();
   assert.equal(requests.length,1);
   await sender.getByRole('button',{name:c.reset,exact:true}).click();
   await sender.getByRole('status').filter({hasText:c.cleared}).waitFor();
   assert.deepEqual(requests.at(-1),{installationId:id,replyTo:''});
   assert.equal(await reply.inputValue(),'');
  }finally{await page.close();}
 }
});
