import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
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
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])for(const setupDelay of theme==='light'&&width===390?[0,1100]:[0])test(`${locale} ${theme} ${width}: cooldown uses singular only for the last second${setupDelay?' after a setup pause':''}`,async t=>{
 const browser=await chromium.launch({headless:true});
 try{await t.test('account cooldown',async()=>{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(3000);
  try{
   // The installed clock runs until paused; leave setup time before the fixed application instant.
   await page.clock.install({time:new Date('2026-10-23T12:00:01Z')});
   if(setupDelay)await delay(setupDelay);
   await page.clock.pauseAt(new Date('2026-10-24T12:00:01Z'));
   const path='/signup',c=translations[locale];
   await page.route('https://portal.test'+path,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
   await page.route('**/api/account/**',route=>{
    const endpoint=new URL(route.request().url()).pathname;
    if(endpoint.endsWith('/session')||endpoint.endsWith('/session/activity'))return route.fulfill({status:401,json:{error:'credentials_invalid'}});
    if(endpoint.endsWith('/signup/request'))return route.fulfill({status:429,headers:{'Retry-After':'2'},json:{error:'rate_limited'}});
    return route.fulfill({status:503,json:{error:'unavailable'}});
   });
   await page.goto('https://portal.test'+path);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
   {await page.locator('input[name=email]').fill('owner@example.test');await page.getByRole('button',{name:c.continue,exact:true}).click();}
   const prefix=c.cooldown,status=page.getByRole('status').filter({hasText:prefix});
   await status.waitFor();assert.equal(await status.textContent(),`${prefix} 2 ${locale==='en'?'seconds.':'segundos.'}`);
   await page.clock.runFor(1000);assert.equal(await status.textContent(),`${prefix} 1 ${locale==='en'?'second.':'segundo.'}`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.COOLDOWN_RECEIPT_DIR){await mkdir(process.env.COOLDOWN_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.COOLDOWN_RECEIPT_DIR}/${locale}-${theme}-${width}-account.png`,fullPage:true});}
   await page.clock.runFor(1000);assert.equal(await status.count(),0);
  }finally{await page.close();}
 });}finally{await browser.close();}
});
