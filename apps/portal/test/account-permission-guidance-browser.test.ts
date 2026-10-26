import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const id='20000000-0000-4000-8000-000000000001';
const installation={installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:'Harbour Kitchen',businessName:'Harbour Kitchen',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);window.app=new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: Account denial offers account checks, a return and recoverable sign-out`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);page.on('pageerror',error=>console.log('Browser fixture error:',error.message));
  let denied='',code='permission_denied',signedIn=true,logoutFails=false,logoutCalls=0;
  const writes:string[]=[];
  const c=translations[locale];
  await page.route('https://portal.test/**',async route=>{
   const r=route.request(),path=new URL(r.url()).pathname;
   if(!path.startsWith('/api/account/'))return route.fulfill({contentType:'text/html',body:`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="portal" class="portal"></div><script>${bundle.outputFiles[0]!.text}</script></html>`});
   const endpoint=path.slice('/api/account/'.length);
   if(endpoint==='session'||endpoint==='session/activity')return route.fulfill(signedIn?{json:{accountId:id,expiresAt:new Date(Date.now()+3600000).toISOString()}}:{status:401,json:{error:'unauthenticated'}});
   if(endpoint==='logout'){logoutCalls++;if(logoutFails)return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});signedIn=false;return route.fulfill({status:204});}
   if(r.method()==='POST')writes.push(endpoint);
   if(endpoint===denied)return route.fulfill({status:403,json:{error:code}});
   const values:Record<string,unknown>={installations:{installations:[installation,{...installation,installationId:'20000000-0000-4000-8000-000000000002',venueId:'20000000-0000-4000-8000-000000000002'}]},alerts:{enabled:false,locale:'en'},'translation-consent':{consents:[{venueId:id,consented:false,consentedAt:null}]},sessions:{sessions:[{id,createdAt:new Date().toISOString(),lastUsedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),current:true}]},passkeys:{passkeys:[]},authenticator:{active:false,version:0,recoveryCodesRemaining:0,available:false}};
   return endpoint in values?route.fulfill({json:values[endpoint]}):route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  const start=async()=>{denied='';await page.goto('https://portal.test/account');await page.waitForFunction(()=>{const a=(window as any).app;return a?.installations.loaded&&a.alerts.loaded&&a.translationConsent.loaded&&a.security.loaded&&a.passkeys.loaded&&a.authenticator.loaded;}).catch(async error=>{console.log('Fixture state',await page.evaluate(()=>{const a=(window as any).app;return a?{session:a.session.state,controllers:Object.fromEntries(['installations','alerts','translationConsent','security','passkeys','authenticator'].map(k=>[k,{loaded:a[k].loaded,error:a[k].error}]))}:document.body.innerText.slice(0,300);}));throw error;});};
  for(const [target,endpoint,accountOnly] of [
   ['installations','installations',false],['backups','backups/list',false],['diagnostics','diagnostics/read',false],['usage','usage/read',false],['remote','remote-access/status',false],['translationConsent','translation-consent',false],['alerts','alerts',true],['security','sessions',true],['passkeys','passkeys',true],['authenticator','authenticator',true],
  ] as const){
   await start();denied=endpoint;
   await page.evaluate(async({target,id})=>{const a=(window as any).app,v=a[target];if(target==='backups'||target==='remote')await v.open(id);else if(target==='diagnostics')await v.download(id);else if(target==='usage'){v.organisation(id);v.refresh();await v.load();}else if(target==='translationConsent')await v.agree(id);else await v.load();}, {target,id});
   const alert=page.getByRole('alert').filter({hasText:accountOnly?c.permissionAccount:c.permissionBusiness});await alert.waitFor();assert.equal(await page.locator('.permission-actions').count(),1,'only the refused panel offers an account switch');
   const actions=alert.locator('..').locator('.permission-actions').filter({has:page.getByRole('link',{name:c.permissionBack,exact:true})}).first();
   await actions.getByRole('link',{name:c.permissionBack,exact:true}).waitFor();
   assert.equal(await actions.getByRole('button',{name:c.signout,exact:true}).isEnabled(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.PERMISSION_GUIDANCE_RECEIPT_DIR){await mkdir(process.env.PERMISSION_GUIDANCE_RECEIPT_DIR,{recursive:true});await alert.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:`${process.env.PERMISSION_GUIDANCE_RECEIPT_DIR}/${locale}-${theme}-${width}-${target}.png`,clip:{x:0,y:Math.max(0,Math.min(650,(await alert.boundingBox())!.y-25)),width,height:250}});}
   denied='';await actions.getByRole('link',{name:c.permissionBack,exact:true}).click();await page.waitForFunction(()=>(window as any).app?.installations.loaded);assert.equal(await page.getByRole('heading',{name:c.account,exact:true}).count(),1);
  }
  // Request verification keeps its separate guidance and does not offer an account switch as its diagnosis.
  await start();denied='installations';code='forbidden';await page.evaluate(async()=>{await (window as any).app.installations.load();});
  await page.getByRole('alert').filter({hasText:c.forbidden}).waitFor();assert.equal(await page.locator('.permission-actions').count(),0);
  code='permission_denied';await page.evaluate(async()=>{await (window as any).app.installations.load();});
  const actions=page.locator('.permission-actions');logoutFails=true;await actions.getByRole('button',{name:c.signout,exact:true}).click();
  await page.getByRole('alert').filter({hasText:c.logoutFailed}).waitFor();assert.equal(logoutCalls,1);assert.equal(page.url(),'https://portal.test/account');
  logoutFails=false;await actions.getByRole('button',{name:c.signout,exact:true}).click();await page.waitForURL('**/login');assert.equal(logoutCalls,2);
  assert.equal(writes.some(path=>['installations/revoke','remote-access/apply','sessions/revoke','passkeys/remove','authenticator/begin'].includes(path)),false);
 }finally{await browser.close();}
});
