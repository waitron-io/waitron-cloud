import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const id='20000000-0000-4000-8000-000000000001';
const view={installationId:id,revision:1,revoked:false,names:{staff:{assigned:'staff.venue.example',current:'staff.venue.example'},public:{assigned:'venue.example',current:'venue.example'}},service:{state:'provisioning',health:'unknown',observedAt:null,validUntil:null}};
const installation={installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:1,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:'Harbour Kitchen',businessName:'Harbour Kitchen',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['remote_access','continuous_backup','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);window.app=new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])
 test(`${locale} ${theme} ${width}: remote refusals offer current limits and read-only navigation`,async()=>{
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(3000);
   const c=translations[locale];let denied='',code='',revoked=false,statusRevoked=false,installationReads=0;const writes:string[]=[];
   await page.route('https://portal.test/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(!path.startsWith('/api/account/'))return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="portal" class="portal"></div><script>${bundle.outputFiles[0]!.text}</script>`});
    const endpoint=path.slice('/api/account/'.length);
    if(endpoint==='session'||endpoint==='session/activity')return route.fulfill({json:{accountId:id,expiresAt:'2099-01-01T00:00:00Z'}});
    if(endpoint==='installations'){installationReads++;return route.fulfill({json:{installations:[{...installation,revokedAt:revoked?'2026-01-01T00:00:00Z':null}]}});}
    if(endpoint===denied){writes.push(endpoint);return route.fulfill({status:403,json:{error:code}});}
    if(endpoint==='remote-access/status')return route.fulfill({json:{...view,revoked:statusRevoked||revoked}});
    if(endpoint==='remote-access/dns')return route.fulfill({json:{installationId:id,kind:'staff',hostname:'staff.cafe.example',records:[{type:'CNAME',name:'staff.cafe.example',value:view.names.staff.assigned},{type:'CNAME',name:'_acme-challenge.staff.cafe.example',value:'_acme-challenge.'+view.names.staff.assigned}]}});
    if(endpoint==='remote-access/apply'||endpoint==='installations/revoke')writes.push(endpoint);
    return route.fulfill({status:503,json:{error:'unavailable'}});
   });
   for(const [cause,key] of [['remote_plan_required','remotePlanRequired'],['remote_setup_required','remoteSetupRequired'],['remote_test_only','remoteTestOnly'],['revoked','remoteRevoked']] as const){
    for(const action of ['dns','apply']){
     denied='';revoked=false;await page.goto('https://portal.test/account');
     await page.getByRole('button',{name:c.remoteSetup,exact:true}).click();
     const section=page.locator('.remote-setup');await section.locator('input').fill('staff.cafe.example');
     code=cause;denied='remote-access/'+action;
     await section.getByRole('button',{name:c.remoteReview,exact:true}).click();
     if(action==='apply')await section.getByRole('button',{name:c.remoteConfirm,exact:true}).click();
     await section.getByRole('alert').filter({hasText:c[key]}).waitFor();
     assert.equal(await section.locator('input').count(),0);assert.equal(await section.getByRole('group').count(),0);
     const back=section.getByRole('link',{name:c.permissionBack,exact:true});await back.waitFor();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     if(process.env.REMOTE_REFUSAL_RECEIPT_DIR&&action==='dns'){
      await mkdir(process.env.REMOTE_REFUSAL_RECEIPT_DIR,{recursive:true});await section.scrollIntoViewIfNeeded();
      await page.screenshot({path:`${process.env.REMOTE_REFUSAL_RECEIPT_DIR}/${locale}-${theme}-${width}-${cause}.png`,fullPage:true});
     }
     if(cause==='revoked'){
      revoked=true;const before=installationReads;await section.getByRole('button',{name:locale==='en'?'Refresh installations':'Actualizar instalaciones',exact:true}).click();
      await page.waitForFunction(()=>!(window as any).app.installations.pending);
      assert(installationReads>before);await page.locator('.installation').getByText(c.remoteRevoked,{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:c.refreshStatus,exact:true}).count(),1,'the revoked card guidance names the existing installation refresh');
      assert.equal(await page.locator('.installation').getByRole('button',{name:c.remoteSetup,exact:true}).count(),0);
     }else{await back.click();await page.getByRole('heading',{name:c.account,exact:true}).waitFor();}
    }
   }
   denied='';revoked=false;statusRevoked=true;await page.goto('https://portal.test/account');
   await page.getByRole('button',{name:c.remoteSetup,exact:true}).click();
   await page.locator('.remote-setup').getByRole('status').filter({hasText:c.remoteRevoked}).waitFor();
   assert.equal(await page.locator('.remote-setup').getByRole('button',{name:c.refreshStatus,exact:true}).count(),1,'revoked status names its existing refresh control');
   assert.equal(await page.locator('.remote-setup input').count(),0);
   assert.equal(await page.locator('.remote-setup a[target=_blank]').count(),0);
   assert.equal(writes.filter(path=>path==='remote-access/apply').length,4,'one deliberate save refusal per cause; no automatic replay');
   assert.equal(writes.includes('installations/revoke'),false);
  }finally{await browser.close();}
 });
