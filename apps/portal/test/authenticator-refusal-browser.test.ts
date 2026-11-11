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
const token='A'.repeat(43),expiresAt='2030-01-01T00:00:00.000Z';
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])
 test(`${locale} ${theme} ${width}: authenticator refusals give a usable next step`,async t=>{
  const browser=await chromium.launch({headless:true});
  try{for(const reason of ['setup_unavailable','factor_not_active','password_too_long','408','413','415'] as const)await t.test(reason,async()=>{
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(4000);
   const c=translations[locale],writes:string[]=[];let statusReads=0;
   try{
    await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**',route=>{
     const endpoint=new URL(route.request().url()).pathname.replace('/api/account','');
     if(endpoint==='/session'||endpoint==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt}});
     if(endpoint==='/authenticator'){statusReads++;return route.fulfill({json:{active:reason==='factor_not_active'&&statusReads===1,version:1,recoveryCodesRemaining:0,available:true}});}
     if(endpoint.startsWith('/authenticator/')){
      writes.push(endpoint);
      if(endpoint==='/authenticator/begin'&&reason==='setup_unavailable')return route.fulfill({json:{pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt}});
      return route.fulfill({status:reason==='408'?408:reason==='413'?413:reason==='415'?415:400,json:{error:['408','413','415'].includes(reason)?'invalid_input':reason}});
     }
     return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    await page.locator('input[name=factorPassword]').fill(reason==='password_too_long'?'x'.repeat(1025):'current password');
    if(reason==='setup_unavailable'){
     await page.getByRole('button',{name:c.factorEnable,exact:true}).click();await page.locator('input[name=factorConfirmation]').fill('123456');
     await page.locator('input[name=factorPassword]').fill('current password');await page.getByRole('button',{name:c.factorActivate,exact:true}).click();
    }else if(reason==='factor_not_active'){
     await page.locator('input[name=factorProof]').fill('123456');await page.getByRole('button',{name:c.factorRemove,exact:true}).click();
    }else await page.getByRole('button',{name:c.factorEnable,exact:true}).click();
    const message=reason==='408'?c.factorRequestInterrupted:reason==='413'?c.factorRequestSize:reason==='415'?c.factorRequestFormat:reason==='setup_unavailable'?(locale==='en'?'This setup is no longer available. Start setup again with your password and fresh codes.':'Esta configuración ya no está disponible. Empieza de nuevo con tu contraseña y códigos nuevos.')
     :reason==='factor_not_active'?(locale==='en'?'Your authenticator is no longer active. Check your settings before starting again.':'Tu autenticador ya no está activo. Comprueba la configuración antes de empezar de nuevo.')
     :(locale==='en'?'This password is too long. Enter your current account password.':'Esta contraseña es demasiado larga. Introduce la contraseña actual de tu cuenta.');
    await page.locator('.authenticator > p[role=alert]').getByText(message,{exact:true}).waitFor();
    assert.equal(await page.locator('input[name=factorPassword]').inputValue(),'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(reason==='setup_unavailable'){assert.equal(await page.locator('input[name=factorConfirmation]').count(),0);await page.getByRole('button',{name:c.factorEnable,exact:true}).waitFor();}
    if(process.env.AUTHENTICATOR_REFUSAL_RECEIPT_DIR){await mkdir(process.env.AUTHENTICATOR_REFUSAL_RECEIPT_DIR,{recursive:true});await page.locator('.authenticator').scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.AUTHENTICATOR_REFUSAL_RECEIPT_DIR}/${locale}-${theme}-${width}-${reason}.png`});}
    if(reason==='factor_not_active'||['408','413','415'].includes(reason)){
     await page.getByRole('button',{name:c.factorRefresh,exact:true}).click();await page.getByRole('button',{name:c.factorEnable,exact:true}).waitFor();
     assert.equal(await page.locator('input[name=factorProof]').count(),0);assert.equal(statusReads,2);
    }
    assert.deepEqual(writes,reason==='setup_unavailable'?['/authenticator/begin','/authenticator/activate']:reason==='factor_not_active'?['/authenticator/remove']:['/authenticator/begin']);
   }finally{await page.close();}
  });}finally{await browser.close();}
 });

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: a refused sign-in code names its verify button`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);const c=translations[locale];
  await page.route('https://portal.test/login',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/login'))return route.fulfill({status:202,json:{factorRequired:true,challengeToken:token,expiresAt}});
   if(path.endsWith('/login/factor'))return route.fulfill({status:408,json:{error:'invalid_input'}});
   return route.fulfill({status:401,json:{error:'unauthenticated'}});
  });
  await page.goto('https://portal.test/login');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.locator('input[name=email]').fill('owner@example.test');await page.locator('input[name=password]').fill('current password');await page.getByRole('button',{name:c.login,exact:true}).click();
  await page.locator('input[name=factorProof]').fill('123456');const verify=page.getByRole('button',{name:c.factorVerify,exact:true});await verify.click();
  const message=page.getByRole('alert').filter({hasText:c.requestBodyInterrupted});await message.waitFor();assert.equal(await message.getByText(`${c.requestBodyInterrupted} ${c.factorVerify}.`,{exact:true}).count(),1);assert.equal(await verify.isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.AUTHENTICATOR_REFUSAL_RECEIPT_DIR){await mkdir(process.env.AUTHENTICATOR_REFUSAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.AUTHENTICATOR_REFUSAL_RECEIPT_DIR}/${locale}-${theme}-${width}-verify.png`});}
 }finally{await browser.close();}
});
