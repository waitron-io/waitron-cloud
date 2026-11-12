import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8'),id='12345678-1234-4234-8234-123456789abc';
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: Remove requires the shared window and retains refusal and cooldown feedback`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}}),c=translations[locale];page.setDefaultTimeout(4000);
  const writes:{path:string;body:unknown}[]=[];let fresh=false,limited=false;
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const request=route.request(),path=new URL(request.url()).pathname.replace('/api/account','');
   if(path==='/session'||path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt:'2099-01-01T00:00:00Z'}});
   if(path==='/action-proof')return route.fulfill({json:{methods:['email'],freshUntil:fresh?'2099-01-01T00:00:00Z':null}});
   if(path==='/passkeys')return route.fulfill({json:{passkeys:[{id,createdAt:'2026-10-24T12:00:00Z',lastUsedAt:null}]}});
   if(path==='/authenticator')return route.fulfill({json:{active:false,version:0,recoveryCodesRemaining:0,available:true}});
   if(request.method()==='POST')writes.push({path,body:request.postDataJSON()});
   if(path==='/passkeys/remove')return limited?route.fulfill({status:429,headers:{'retry-after':'60'},json:{error:'rate_limited'}}):route.fulfill({status:403,json:{error:'credentials_invalid'}});
   return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const section=page.locator('.passkeys'),remove=section.getByRole('button',{name:c.passkeyRemove,exact:true}),add=section.getByRole('button',{name:c.passkeyAdd,exact:true});
  await remove.click();await page.waitForFunction(()=>document.activeElement?.id==='action-proof-heading');assert.deepEqual(writes,[]);
  assert.equal(await page.locator('input[name=passkeyPassword]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  fresh=true;await remove.click();await section.getByRole('alert').getByText(c.actionProofUnavailable,{exact:true}).waitFor();assert.deepEqual(writes,[{path:'/passkeys/remove',body:{id}}]);
  limited=true;await remove.click();await section.getByRole('alert').getByText(c.limited,{exact:true}).waitFor();assert.equal(writes.length,2);assert.equal(await remove.isDisabled(),true);assert.equal(await add.isDisabled(),true);
 }finally{await browser.close();}
});
