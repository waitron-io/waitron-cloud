import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import axe from 'axe-core';
import {cloudActionCatalogue} from '../../../packages/registration/src/cloud-actions.ts';

const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);window.app=new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const session={accountId:'operator',expiresAt:'2099-01-01T00:00:00Z'};
const actions=cloudActionCatalogue;
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: catalogueVisibleAfterSignin`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(4000);
  let signedIn=false,refused=false,reads=0;
  await page.route(/^https:\/\/portal.test\/(login|operator\/actions)$/,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloud</title><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',r=>{
   const path=new URL(r.request().url()).pathname;
   if(path.endsWith('/login')){signedIn=true;return r.fulfill({json:{accountId:'operator'}});}
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return r.fulfill(signedIn?{json:session}:{status:401,json:{error:'unauthenticated'}});
   if(path.endsWith('/installations'))return r.fulfill({json:{installations:[]}});
   if(path.endsWith('/operator/actions')){reads++;assert.equal(r.request().method(),'GET');return r.fulfill(refused?{status:403,json:{error:'permission_denied'}}:{json:{actions}});}
   return r.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/operator/actions');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.locator('wt-input[name=email] input').fill('operator@example.test');
  await page.locator('wt-input[name=password] input').fill('Synthetic operator password');
  await page.locator('#submit').click();
  const title=locale==='en'?'Cloud actions':'Acciones de Cloud';
  await page.getByRole('heading',{name:title,level:1}).waitFor();
  await page.getByRole('listitem').filter({hasText:locale==='en'?'Restart a failed Cloud workload in place':'Reiniciar una carga de Cloud fallida sin moverla'}).waitFor();
  assert.equal(await page.getByRole('listitem').count(),16);
  assert.match(await page.locator('main').innerText(),locale==='en'?/Ask first/:/Preguntar primero/);
  assert.match(await page.locator('main').innerText(),locale==='en'?/Act and report/:/Actuar e informar/);
  assert.equal(await page.getByRole('button',{name:/execute|ejecutar/i}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.addScriptTag({content:axe.source});assert.deepEqual(await page.evaluate(async()=>(await (window as any).axe.run(document)).violations),[]);
  if(process.env.CLOUD_ACTION_SCREENSHOTS){await mkdir(process.env.CLOUD_ACTION_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.CLOUD_ACTION_SCREENSHOTS}/${locale}-${theme}-${width}.png`,fullPage:true});}
  refused=true;await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('listitem').count(),0);assert.equal(reads,2);
  await page.getByRole('link',{name:locale==='en'?'Account overview':'Resumen de la cuenta',exact:true}).click();
  assert.equal(new URL(page.url()).pathname,'/account');
  assert.equal(await page.getByRole('link',{name:title,exact:true}).count(),0);
  await page.evaluate(()=>(window as any).app.navigate('/operator/actions'));
  await page.getByRole('alert').waitFor();assert.equal(reads,3);
 }finally{await browser.close();}
});
