import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const token='A'.repeat(43),expiresAt='2030-01-01T00:00:00.000Z',password=' current password ';
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280]){
 test(`${locale} ${theme} ${width}: a malformed code is explained beside the field, not as an outage`,async t=>{
  const browser=await chromium.launch({headless:true});
  try{for(const flow of ['login','remove','activate'] as const)await t.test(flow,async()=>{
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
   const c=translations[locale],login=flow==='login',path=login?'/login':'/account';
   const message=flow==='activate'?(locale==='en'?'Enter the 6-digit code from your new app.':'Introduce el código de 6 dígitos de tu nueva aplicación.'):(locale==='en'?'Enter the 6-digit code from your app, or a recovery code.':'Introduce el código de 6 dígitos de tu aplicación o un código de recuperación.');
   const writes:{path:string;body:unknown}[]=[];let responseStatus=400;
   try{
    await page.route('https://portal.test'+path,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**',route=>{
     const request=route.request(),endpoint=new URL(request.url()).pathname.replace('/api/account','');
     if(endpoint==='/session'||endpoint==='/session/activity')return login?route.fulfill({status:401,json:{error:'credentials_invalid'}}):route.fulfill({json:{accountId:'owner',expiresAt}});
     if(endpoint==='/authenticator')return route.fulfill({json:{active:flow!=='activate',version:flow==='activate'?0:1,recoveryCodesRemaining:flow==='activate'?0:10,available:true}});
     if(request.method()==='POST')writes.push({path:endpoint,body:request.postDataJSON()});
     if(endpoint==='/login')return route.fulfill({status:202,json:{factorRequired:true,challengeToken:token,expiresAt}});
     if(endpoint==='/authenticator/begin'&&flow==='activate')return route.fulfill({json:{pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt}});
     if(endpoint==='/login/factor'||endpoint.startsWith('/authenticator/'))return route.fulfill({status:responseStatus,json:{error:responseStatus===400?'invalid_input':'credentials_invalid'}});
     return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test'+path);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    if(login){await page.locator('input[name=email]').fill('owner@example.test');await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.locator('input[name=factorProof]').waitFor();}
    else{await page.locator('input[name=factorPassword]').waitFor();if(flow==='activate'){await page.locator('input[name=factorPassword]').fill(password);await page.getByRole('button',{name:c.factorEnable,exact:true}).click();await page.locator('input[name=factorConfirmation]').waitFor();}}
    const field=page.locator(`wt-input[name=${flow==='activate'?'factorConfirmation':'factorProof'}]`),input=field.locator('input');
    const submit=page.getByRole('button',{name:login?c.factorVerify:flow==='remove'?c.factorRemove:c.factorActivate,exact:true});
    const feedback=login?page.locator('wt-form-error-summary'):page.locator('.authenticator > p[role=alert]');
    async function enter(code:string){if(!login)await page.locator('input[name=factorPassword]').fill(password);await input.fill(code);}
    writes.length=0;
    for(const code of ['12345','1234567','12345a']){
     await enter(code);await submit.click();assert.deepEqual(writes,[],'malformed input never reaches the server');
     await feedback.getByText(message,{exact:true}).waitFor();assert.equal(await field.getByText(message,{exact:true}).count(),1);assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(await input.inputValue(),code);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.AUTHENTICATOR_FORMAT_RECEIPT_DIR){await mkdir(process.env.AUTHENTICATOR_FORMAT_RECEIPT_DIR,{recursive:true});await field.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.AUTHENTICATOR_FORMAT_RECEIPT_DIR}/${locale}-${theme}-${width}-${flow}.png`});}
    if(flow!=='activate'){
     await page.getByRole('combobox',{name:c.factorProofType,exact:true}).selectOption('recovery');await enter('ABC');await submit.click();assert.deepEqual(writes,[]);await feedback.getByText(message,{exact:true}).waitFor();
     await page.getByRole('combobox',{name:c.factorProofType,exact:true}).selectOption('totp');
    }
    await enter(' \t ');await submit.click();await feedback.getByText(c.factorCodeRequired,{exact:true}).waitFor();assert.deepEqual(writes,[]);
    await enter('123 456');await submit.click();await feedback.getByText(login?c.factorUnavailable:c.factorCheckSettings,{exact:true}).waitFor();assert.equal(await field.getByText(message,{exact:true}).count(),0);assert.equal(await input.getAttribute('aria-invalid'),'false');
    const endpoint=login?'/login/factor':`/authenticator/${flow}`;
    assert.deepEqual(writes,[{path:endpoint,body:login?{challengeToken:token,proof:{kind:'totp',code:'123456'}}:flow==='remove'?{password,proof:{kind:'totp',code:'123456'}}:{password,pendingToken:token,code:'123456'}}]);
    responseStatus=403;await enter('654321');await submit.click();await feedback.getByText(c.credentials,{exact:true}).waitFor();assert.equal(await input.getAttribute('aria-invalid'),'false');assert.equal(await field.getByText(message,{exact:true}).count(),0);
   }finally{await page.close();}
  });}finally{await browser.close();}
 });
}
