import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
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

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280]){
 test(`${locale} ${theme} ${width}: an unchanged name cannot be reviewed or applied`,async()=>{
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(3000);
   const c=translations[locale];let saved=structuredClone(original);
   const calls:{path:string;body:Record<string,string>}[]=[];
   await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
   await page.route('**/api/account/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/account','');
    if(path==='/session'||path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
    if(path==='/installations')return route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
     services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))}]}});
    if(path==='/remote-access/status')return route.fulfill({json:saved});
    if(path==='/remote-access/dns'||path==='/remote-access/apply'){
     const body=request.postDataJSON();calls.push({path,body});const kind=body.kind as 'staff'|'public',hostname=body.hostname as string;
     if(path.endsWith('/dns'))return route.fulfill({json:{installationId:id,kind,hostname,records:[{type:'CNAME',name:hostname,value:saved.names![kind].assigned},{type:'CNAME',name:'_acme-challenge.'+hostname,value:'_acme-challenge.'+saved.names![kind].assigned}]}});
     saved={...saved,revision:saved.revision+1,names:{...saved.names!,[kind]:{...saved.names![kind],current:hostname}}};return route.fulfill({json:saved});
    }
    return route.fulfill({status:503,json:{error:'unavailable'}});
   });
   await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
   await page.getByRole('button',{name:c.remoteSetup,exact:true}).waitFor();
   for(const custom of [false,true])for(const kind of ['staff','public'] as const){
    saved=structuredClone(original);if(custom)saved.names![kind].current=`${kind}.cafe.example`;
    await page.evaluate(async({id,kind})=>{const app=(window as any).app;await app.remote.open(id);app.remote.choose(kind);},{id,kind});
    const section=page.locator('.remote-setup'),input=section.locator('wt-input[name=remoteHostname] input');
    const review=section.getByRole('button',{name:c.remoteReview,exact:true});
    const confirmation=section.getByRole('group',{name:c.remoteConfirmTitle,exact:true});
    const current=saved.names![kind].current,start=calls.length;
    assert.equal(await input.inputValue(),current);
    for(const value of [current,`  ${current.toUpperCase()}.  `]){
     await input.fill(value);
     assert.equal(await review.isDisabled(),true,'Review waits for a different cleaned name');
     await review.evaluate(button=>(button as HTMLButtonElement).click());await input.press('Enter');
     await page.evaluate(()=>{const app=(window as any).app;return app.remote.preview().then(()=>app.remote.apply());});
     assert.equal(await confirmation.count(),0);assert.equal(calls.length,start,'unchanged names send no DNS or apply');
    }
    await input.fill(current+'..');assert.equal(await review.isEnabled(),true,'two trailing dots still need invalid-name feedback');
    await review.click();await section.locator('wt-input[name=remoteHostname]').getByText(c.remoteInvalid,{exact:true}).waitFor();
    assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(calls.length,start);
    await input.fill(current);assert.equal(await review.isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(custom&&kind==='staff'&&process.env.REMOTE_UNCHANGED_RECEIPT_DIR){
     await mkdir(process.env.REMOTE_UNCHANGED_RECEIPT_DIR,{recursive:true});
     await page.screenshot({path:`${process.env.REMOTE_UNCHANGED_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});
    }
    const target=`${kind}.changed.example`;
    await input.fill(`  ${target.toUpperCase()}.  `);assert.equal(await review.isEnabled(),true);
    await review.click();await confirmation.waitFor();
    assert.deepEqual(calls.slice(start),[{path:'/remote-access/dns',body:{installationId:id,kind,hostname:target}}]);
    await confirmation.getByRole('button',{name:c.remoteConfirm,exact:true}).click();await section.getByText(c.remoteSaved,{exact:true}).waitFor();
    assert.deepEqual(calls[start+1],{path:'/remote-access/apply',body:{installationId:id,kind,hostname:target,expectedRevision:'1'}});
    assert.equal(await review.isDisabled(),true,'the saved target is now unchanged');
    await section.getByRole('button',{name:c.remoteUseAssigned,exact:true}).click();assert.equal(await review.isEnabled(),true);
    await review.click();await confirmation.waitFor();assert.equal(calls.length,start+2,'switching back to assigned needs no DNS lookup');
    await confirmation.getByRole('button',{name:c.remoteConfirm,exact:true}).click();await section.getByText(c.remoteSaved,{exact:true}).waitFor();
    assert.deepEqual(calls[start+2],{path:'/remote-access/apply',body:{installationId:id,kind,hostname:original.names![kind].assigned,expectedRevision:'2'}});
    assert.equal(await review.isDisabled(),true);assert.equal(calls.length,start+3);
   }
  }finally{await browser.close();}
 });
}
