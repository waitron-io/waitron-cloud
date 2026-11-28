import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
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
const labels={en:{open:'Remote access',title:'Staff email sender',reply:'Replies go to',defaultReply:'Replies go to your sending address by default.',saved:'Reply address saved.',reset:'Use standard sender',cleared:'Standard sender restored.',refresh:'Refresh status',address:'Sending address',saveDomain:'Save sending address',records:'DNS records',recordName:'Name',recordValue:'Target',copy:'Copy target',pdf:'Download DNS records',verified:'Verified',unknown:'Unknown'},
 es:{open:'Acceso remoto',title:'Remitente del correo del personal',reply:'Enviar respuestas a',defaultReply:'Por defecto, las respuestas van a tu dirección de envío.',saved:'Dirección de respuesta guardada.',reset:'Usar remitente habitual',cleared:'Remitente habitual restaurado.',refresh:'Actualizar estado',address:'Dirección de envío',saveDomain:'Guardar dirección de envío',records:'Registros DNS',recordName:'Nombre',recordValue:'Destino',copy:'Copiar destino',pdf:'Descargar registros DNS',verified:'Verificado',unknown:'Desconocido'}};

const signingLabels={
 en:{alias:'Email signing alias',aliasStatus:'Alias status',from:'From in the test inbox',notStarted:'Signing not started',
  waiting:'Waiting for signing',verified:'Signing verified',failed:'Signing failed',resetHelp:'Using the standard sender also clears your reply address.'},
 es:{alias:'Alias de firma de correo',aliasStatus:'Estado del alias',from:'Remitente en la bandeja de pruebas',notStarted:'Firma sin iniciar',
  waiting:'Esperando la firma',verified:'Firma verificada',failed:'Error de firma',resetHelp:'Usar el remitente habitual también borra tu dirección de respuesta.'},
};

function deferred(){
 let resolve!:()=>void;
 const promise=new Promise<void>(done=>{resolve=done;});
 return {promise,resolve};
}

test('a venue owner can save a reply address from Remote access',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const receipts=process.env.VENUE_EMAIL_RECEIPT_DIR;
 if(receipts)await mkdir(receipts,{recursive:true});
 for(const locale of receipts?['en','es'] as const:['en'] as const)for(const colorScheme of receipts?['light','dark'] as const:['light'] as const)for(const width of receipts?[390,1280]:[390]){
  const page=await browser.newPage({locale,colorScheme,viewport:{width,height:850}});
  page.setDefaultTimeout(3500);
  await page.context().addCookies([{name:'__Host-cloud_csrf',value:csrf,url:'https://portal.test',secure:true}]);
  try{
   const c=labels[locale],signing=signingLabels[locale],requests:unknown[]=[],tokens:(string|null)[]=[],clears:unknown[]=[];
   let savedReplyTo:string|null=null,address:string|null=null,pdfLoads=0,dnsLimited=false,domainEnabled=true;
   const currentSigning='not_started';
   let checkedSigning=currentSigning,differentDnsChoice=false;
   let delayedDns:ReturnType<typeof deferred>|undefined;
   const releasePdf=deferred(),dnsStarted=deferred();
   const emailAlias={type:'CNAME',name:`${id}._domainkey.cafe.example.test`,value:`${id}.mail.cloud.example.test`};
   const remoteAlias={type:'CNAME',name:'staff.cafe.example.test',value:'staff.venue.example.test'};
   const domain=()=>({address,records:address?[emailAlias,remoteAlias]:[remoteAlias]});
   const selected=(state:string)=>({address:state==='verified'&&address?address:'relay@example.test',signing:address?state:null});
   const settings=()=>domainEnabled?{replyTo:savedReplyTo,domain:domain(),sender:selected(currentSigning)}:{replyTo:savedReplyTo??address};
   await page.context().grantPermissions(['clipboard-read','clipboard-write']);
   await page.route('**/venue-dns-pdf.js',async route=>{
    pdfLoads++;
    delayedDns?.resolve();
    await releasePdf.promise;
    await route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../dist/venue-dns-pdf.js',import.meta.url))});
   });
   await page.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
   await page.route('**/api/account/**',async route=>{
    const request=route.request(),endpoint=new URL(request.url()).pathname.slice('/api/account'.length);
    if(endpoint==='/session'||endpoint==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
    if(endpoint==='/action-proof')return route.fulfill({json:{methods:['passkey'],freshUntil:'2099-01-01T00:00:00Z'}});
    if(endpoint==='/installations')return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,
     environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
     services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))}]}});
    if(endpoint==='/remote-access/status')return route.fulfill({json:{installationId:id,revision:1,revoked:false,names:null,
     service:{state:'unconfigured',health:'unknown',observedAt:null,validUntil:null},venueEmail:settings()}});
    if(endpoint==='/venue-email/check-dns'){
     if(dnsLimited)return route.fulfill({status:429,headers:{'retry-after':'60'},json:{error:'rate_limited'}});
     if(delayedDns){dnsStarted.resolve();await delayedDns.promise;}
     return route.fulfill({json:{...settings(),sender:selected(checkedSigning),domain:{...domain(),address:differentDnsChoice?'other@example.test':address,records:domain().records.map(record=>({...record,status:'verified'}))}}});
    }
    if(endpoint==='/venue-email/save-domain'){
     assert.deepEqual(request.postDataJSON(),{installationId:id,address:'bookings@cafe.example.test'});
     assert.equal(await request.headerValue('x-csrf-token'),csrf);
     address='bookings@cafe.example.test';
     return route.fulfill({json:settings()});
    }
    if(endpoint==='/venue-email/clear-reply'){
     clears.push(request.postDataJSON());
     savedReplyTo=null;
     return route.fulfill({json:settings()});
    }
    if(endpoint==='/venue-email/save'){
     requests.push(request.postDataJSON());
     tokens.push(await request.headerValue('x-csrf-token'));
     const replyTo=request.postDataJSON().replyTo;
     if(replyTo==='unsaved@example.test')return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
     savedReplyTo=replyTo||null;
     if(replyTo==='')address=null;
     return route.fulfill({json:settings()});
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
   await reply.fill('unsaved@example.test');await reply.press('Enter');
   await sender.getByRole('alert').waitFor();
   await page.locator('.remote-setup').getByRole('button',{name:c.refresh,exact:true}).click();
   await sender.getByRole('alert').waitFor({state:'hidden'});
   await t.waitFor(async()=>assert.equal(await reply.inputValue(),'office@example.test'),{timeout:3000});
   await sender.getByRole('button',{name:c.reset,exact:true}).click();
   await sender.getByRole('status').filter({hasText:c.cleared}).waitFor();
   assert.deepEqual(requests.at(-1),{installationId:id,replyTo:''});
   assert.equal(await reply.inputValue(),'');
   const from=sender.getByRole('textbox',{name:c.address,exact:true});
   assert.equal(await from.count(),1,'the owner can enter a sending address');
   await from.fill('bookings@cafe.example.test');
   await sender.getByRole('button',{name:c.saveDomain,exact:true}).click();
   const list=sender.getByRole('region',{name:c.records,exact:true});
   await list.getByText(emailAlias.name,{exact:true}).waitFor();
   await t.waitFor(async()=>assert.equal(await list.getByText(c.verified,{exact:true}).count(),2),{timeout:3000});
   assert.equal(await sender.getByText(c.defaultReply,{exact:true}).isVisible(),true);
   await list.getByText(signing.alias,{exact:true}).waitFor();
   const signingStatus=(label:string)=>sender.getByRole('status').filter({hasText:label});
   await signingStatus(signing.notStarted).waitFor();
   const fromStatus=sender.getByText(signing.from,{exact:false}).filter({hasText:'relay@example.test'});
   await fromStatus.waitFor();
   checkedSigning='verified';differentDnsChoice=true;
   await page.locator('.remote-setup').getByRole('button',{name:c.refresh,exact:true}).click();
   await list.getByText(c.unknown,{exact:true}).first().waitFor();
   assert.equal(await signingStatus(signing.notStarted).isVisible(),true);
   assert.equal(await fromStatus.isVisible(),true);
   checkedSigning='waiting';differentDnsChoice=false;
   await page.locator('.remote-setup').getByRole('button',{name:c.refresh,exact:true}).click();
   await signingStatus(signing.waiting).waitFor();
   const rows=[emailAlias,remoteAlias];
   for(const [i,alias] of rows.entries()){
    await list.getByRole('button',{name:c.copy,exact:true}).nth(i).click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),alias.value);
   }
   assert.equal(pdfLoads,0);
   checkedSigning='verified';
   delayedDns=deferred();
   await page.locator('.remote-setup').getByRole('button',{name:c.refresh,exact:true}).click();
   await dnsStarted.promise;
   const pendingDownload=page.waitForEvent('download',{timeout:5000});
   await list.getByRole('button',{name:c.pdf,exact:true}).click();
   await t.waitFor(async()=>assert.equal(await list.getByText(c.verified,{exact:true}).count(),2),{timeout:3000});
   await signingStatus(signing.verified).waitFor();
   await sender.getByText(signing.from,{exact:false}).filter({hasText:'bookings@cafe.example.test'}).waitFor();
   delayedDns=undefined;
   releasePdf.resolve();
   const pdf=await readFile(await (await pendingDownload).path());
   assert.equal(pdfLoads,1);
   const streams=[...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
   const texts=streams.flatMap(([,bytes])=>[...inflateSync(Buffer.from(bytes!,'latin1')).toString().matchAll(/<([0-9A-F]+)> Tj/g)]
    .map(([,hex])=>Buffer.from(hex!,'hex').toString('latin1')));
   assert.deepEqual(texts,[c.records,...rows.flatMap(alias=>['CNAME',c.recordName,alias.name,c.recordValue,alias.value])]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(receipts){
    await list.evaluate(element=>element.scrollIntoView({block:'center'}));
    await page.screenshot({path:`${receipts}/dns-${locale}-${colorScheme}-${width}.png`,fullPage:true});
   }
   dnsLimited=true;
   await page.locator('.remote-setup').getByRole('button',{name:c.refresh,exact:true}).click();
   await list.getByText(c.unknown,{exact:true}).first().waitFor();
   await reply.fill('desk@example.test');await reply.press('Enter');
   await confirmation.waitFor();
   assert.deepEqual(requests.at(-1),{installationId:id,replyTo:'desk@example.test'});
   dnsLimited=false;
   await reply.fill('');await reply.press('Enter');
   await sender.getByText(c.defaultReply,{exact:true}).waitFor();
   assert.deepEqual(clears,[{installationId:id}]);
   assert.equal(await list.getByText(emailAlias.name,{exact:true}).isVisible(),true);
   await reply.fill('desk@example.test');await reply.press('Enter');await confirmation.waitFor();
   checkedSigning='failed';
   await page.locator('.remote-setup').getByRole('button',{name:c.refresh,exact:true}).click();
   await signingStatus(signing.failed).waitFor();
   await list.getByText(signing.aliasStatus,{exact:true}).waitFor();
   await fromStatus.waitFor();
   await sender.getByText(signing.resetHelp,{exact:false}).waitFor();
   if(receipts)await page.screenshot({path:`${receipts}/failed-${locale}-${colorScheme}-${width}.png`,fullPage:true});
   await sender.getByRole('button',{name:c.reset,exact:true}).click();
   await sender.getByRole('status').filter({hasText:c.cleared}).waitFor();
   assert.deepEqual(requests.at(-1),{installationId:id,replyTo:''});
   assert.equal(await reply.inputValue(),'');
   assert.equal(await from.inputValue(),'');
   checkedSigning='not_started';
   await from.fill('bookings@cafe.example.test');
   await sender.getByRole('button',{name:c.saveDomain,exact:true}).click();
   await signingStatus(signing.notStarted).waitFor();
   domainEnabled=false;
   await page.locator('.remote-setup').getByRole('button',{name:c.refresh,exact:true}).click();
   await t.waitFor(async()=>assert.equal(await reply.inputValue(),'bookings@cafe.example.test'),{timeout:3000});
   assert.equal(await sender.getByText(signing.from,{exact:false}).count(),0);
   await reply.fill('');await reply.press('Enter');
   await sender.getByRole('status').filter({hasText:c.cleared}).waitFor();
   assert.deepEqual(requests.at(-1),{installationId:id,replyTo:''});
   assert.equal(await reply.inputValue(),'');
  }finally{await page.close();}
 }
});
