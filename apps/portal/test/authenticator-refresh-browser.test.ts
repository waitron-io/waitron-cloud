import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const bundle=await build({stdin:{contents:`import {applyTokens} from '@waitron-io/ui-core/tokens';import {PortalApp} from './src/app.ts';applyTokens(document.body);new PortalApp(document.querySelector('#portal'));`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const token='A'.repeat(43),expiresAt='2030-01-01T00:00:00.000Z';
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280]){
 test(`${locale} ${theme} ${width}: a refused authenticator request has a working status-refresh path`,async t=>{
  const browser=await chromium.launch({headless:true});
  try{for(const flow of [
   {name:'expired first setup',active:false,nowActive:false,action:'activate'},
   {name:'expired replacement',active:true,nowActive:true,action:'activate'},
   {name:'superseded setup',active:false,nowActive:true,action:'activate'},
   {name:'absent factor',active:true,nowActive:false,action:'remove'},
  ] as const)await t.test(flow.name,async()=>{
   const c=translations[locale],page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
   const writes:{path:string;body:unknown}[]=[];let reads=0,active=flow.active as boolean;
   try{
    await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**',route=>{
     const request=route.request(),path=new URL(request.url()).pathname.replace('/api/account','');
     if(path==='/session'||path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt}});
     if(path==='/authenticator'){reads++;return route.fulfill({json:{active,version:reads,recoveryCodesRemaining:active?8:0,available:true}});}
     if(request.method()==='POST')writes.push({path,body:request.postDataJSON()});
     if(path==='/authenticator/begin')return route.fulfill({json:{pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt}});
     if(path===`/authenticator/${flow.action}`)return route.fulfill({status:400,json:{error:'invalid_input'}});
     return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    const factor=page.locator('.authenticator'),password=page.locator('input[name=factorPassword]');await password.waitFor();
    await password.fill('old password');if(flow.active)await page.locator('input[name=factorProof]').fill('123456');
    if(flow.action==='activate'){
     await factor.getByRole('button',{name:flow.active?c.factorReplace:c.factorEnable,exact:true}).click();await page.locator('input[name=factorConfirmation]').waitFor();
     await password.fill('old password');if(flow.active)await page.locator('input[name=factorProof]').fill('234567');await page.locator('input[name=factorConfirmation]').fill('654321');
    }
    await factor.getByRole('button',{name:flow.action==='activate'?c.factorActivate:c.factorRemove,exact:true}).click();
    const guidance=locale==='en'?'Check your current authenticator settings, then start again with your password and fresh codes.':'Comprueba la configuración actual del autenticador y vuelve a empezar con tu contraseña y códigos nuevos.';
    await factor.getByRole('alert').getByText(guidance,{exact:true}).waitFor();
    assert.equal(await factor.getByText(c.factorUnavailable,{exact:true}).count(),0);
    assert.equal(await password.getAttribute('aria-invalid'),'false');assert.equal(reads,1);
    const before=writes.length;active=flow.nowActive;
    const receipt=process.env.AUTHENTICATOR_REFRESH_RECEIPT_DIR;
    if(receipt){await mkdir(receipt,{recursive:true});await factor.scrollIntoViewIfNeeded();await factor.screenshot({path:`${receipt}/${locale}-${theme}-${width}-${flow.name.replaceAll(' ','-')}-refused.png`});}
    await factor.getByRole('button',{name:locale==='en'?'Check authenticator settings':'Comprobar configuración del autenticador',exact:true}).click();
    await factor.getByText(flow.nowActive?c.factorOn:c.factorOff,{exact:true}).waitFor();
    assert.equal(reads,2);assert.equal(writes.length,before);assert.equal(await factor.locator('.factor-secret').count(),0);assert.equal(await page.locator('input[name=factorConfirmation]').count(),0);assert.equal(await password.inputValue(),'');
    if(flow.nowActive)assert.equal(await page.locator('input[name=factorProof]').inputValue(),'');
    const begin=factor.getByRole('button',{name:flow.nowActive?c.factorReplace:c.factorEnable,exact:true});
    await begin.click();await factor.getByRole('alert').getByText(c.requiredPassword,{exact:true}).waitFor();assert.equal(writes.length,before);
    await password.fill('fresh password');
    if(flow.nowActive){await begin.click();await factor.getByRole('alert').getByText(c.factorCodeRequired,{exact:true}).waitFor();assert.equal(writes.length,before);await page.locator('input[name=factorProof]').fill('345678');}
    await begin.click();await page.locator('input[name=factorConfirmation]').waitFor();
    assert.deepEqual(writes.at(-1),{path:'/authenticator/begin',body:{password:'fresh password',...(flow.nowActive?{proof:{kind:'totp',code:'345678'}}:{})}});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(receipt){await factor.scrollIntoViewIfNeeded();await factor.screenshot({path:`${receipt}/${locale}-${theme}-${width}-${flow.name.replaceAll(' ','-')}-restarted.png`});}
   }finally{await page.close();}
  });}finally{await browser.close();}
 });
}
