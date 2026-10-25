import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
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
const token='A'.repeat(43),expiresAt='2030-01-01T00:00:00.000Z',password=' current password ';
const flows=[
 {action:'login',active:true,missing:'proof'},
 {action:'begin',active:false,missing:'password'},
 {action:'begin',active:true,missing:'password'},
 {action:'begin',active:true,missing:'proof'},
 {action:'remove',active:true,missing:'password'},
 {action:'remove',active:true,missing:'proof'},
 {action:'regenerate',active:true,missing:'password'},
 {action:'regenerate',active:true,missing:'proof'},
 {action:'activate',active:false,missing:'password'},
 {action:'activate',active:false,missing:'confirmation'},
 {action:'activate',active:true,missing:'proof'},
 {action:'activate',active:true,missing:'confirmation'},
] as const;
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280]){
 test(`${locale} ${theme} ${width}: blank authenticator input gives feedback and can be corrected`,async t=>{
  const browser=await chromium.launch({headless:true});
  try{for(const flow of flows)await t.test(`${flow.action} active=${flow.active} missing=${flow.missing}`,async()=>{
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(3000);
   const c=translations[locale],login=flow.action==='login',path=login?'/login':'/account';
   const writes:{path:string;body:unknown}[]=[];
   try{
    await page.route('https://portal.test'+path,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**',route=>{
     const request=route.request(),endpoint=new URL(request.url()).pathname.replace('/api/account','');
     if(endpoint==='/session'||endpoint==='/session/activity')return login?route.fulfill({status:401,json:{error:'credentials_invalid'}}):route.fulfill({json:{accountId:'owner',expiresAt}});
     if(endpoint==='/authenticator')return route.fulfill({json:{active:flow.active,version:flow.active?1:0,recoveryCodesRemaining:flow.active?10:0,available:true}});
     if(request.method()==='POST')writes.push({path:endpoint,body:request.postDataJSON()});
     if(endpoint==='/login')return route.fulfill({status:202,json:{factorRequired:true,challengeToken:token,expiresAt}});
     if(endpoint==='/authenticator/begin'&&flow.action==='activate')return route.fulfill({json:{pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt}});
     if(endpoint==='/login/factor'||endpoint.startsWith('/authenticator/'))return route.fulfill({status:403,json:{error:'credentials_invalid'}});
     return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test'+path);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    if(login){
     await page.locator('input[name=email]').fill('owner@example.test');await page.locator('input[name=password]').fill(password);
     await page.getByRole('button',{name:c.login,exact:true}).click();await page.locator('input[name=factorProof]').waitFor();
    }else{
     await page.locator('input[name=factorPassword]').waitFor();
     if(flow.action==='activate'){
      await page.locator('input[name=factorPassword]').fill(password);
      if(flow.active)await page.locator('input[name=factorProof]').fill('123456');
      await page.getByRole('button',{name:flow.active?c.factorReplace:c.factorEnable,exact:true}).click();
      await page.locator('input[name=factorConfirmation]').waitFor();
     }
     await page.locator('input[name=factorPassword]').fill(flow.missing==='password'?'':password);
     if(flow.action==='activate')await page.locator('input[name=factorConfirmation]').fill(flow.missing==='confirmation'?' \t ':'654 321');
    }
    if(flow.active)await page.locator('input[name=factorProof]').fill(flow.missing==='proof'?' \t ':'123 456');
    writes.length=0;
    const label=login?c.factorVerify:flow.action==='begin'?(flow.active?c.factorReplace:c.factorEnable):flow.action==='remove'?c.factorRemove:flow.action==='regenerate'?c.factorRegenerate:c.factorActivate;
    await page.getByRole('button',{name:label,exact:true}).click();
    const message=flow.missing==='password'?c.requiredPassword:locale==='en'?'Enter your code.':'Introduce tu código.';
    const feedback=login?page.locator('wt-form-error-summary'):page.locator('.authenticator > p[role=alert]');
    await feedback.getByText(message,{exact:true}).waitFor();
    assert.equal(await feedback.getByText(message,{exact:true}).count(),1);assert.deepEqual(writes,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.AUTHENTICATOR_REQUIRED_RECEIPT_DIR&&((login)||(flow.action==='begin'&&!flow.active)||(flow.action==='activate'&&!flow.active&&flow.missing==='confirmation'))){
     await mkdir(process.env.AUTHENTICATOR_REQUIRED_RECEIPT_DIR,{recursive:true});
     await page.screenshot({path:`${process.env.AUTHENTICATOR_REQUIRED_RECEIPT_DIR}/${locale}-${theme}-${width}-${flow.action}.png`,fullPage:true});
    }
    const field=flow.missing==='password'?'factorPassword':flow.missing==='confirmation'?'factorConfirmation':'factorProof';
    const invalid=page.locator(`wt-input[name=${field}]`);
    assert.equal(await invalid.evaluate(element=>(element as HTMLElement & {error:string}).error),message);
    assert.equal(await invalid.locator('input').getAttribute('aria-invalid'),'true');
    assert.equal(await invalid.getByText(message,{exact:true}).count(),1);
    for(const other of ['factorPassword','factorProof','factorConfirmation'].filter(name=>name!==field)){
     const input=page.locator(`wt-input[name=${other}]`);
     if(await input.count())assert.equal(await input.evaluate(element=>(element as HTMLElement & {error:string}).error),'');
    }
    await page.locator(`input[name=${field}]`).fill(flow.missing==='password'?password:flow.missing==='confirmation'?'654 321':'123 456');
    const endpoint=login?'/login/factor':`/authenticator/${flow.action}`;
    const reply=page.waitForResponse('**/api/account'+endpoint);await page.getByRole('button',{name:label,exact:true}).click();await reply;
    assert.deepEqual(writes,[{path:endpoint,body:login?{challengeToken:token,proof:{kind:'totp',code:'123456'}}:{password,...(flow.active?{proof:{kind:'totp',code:'123456'}}:{}),...(flow.action==='activate'?{pendingToken:token,code:'654321'}:{})}}]);
    await feedback.getByText(c.credentials,{exact:true}).waitFor();assert.equal(await feedback.getByText(message,{exact:true}).count(),0);
    for(const input of await page.locator('.authenticator wt-input, wt-input[name=factorProof]').all()){
     assert.equal(await input.evaluate(element=>(element as HTMLElement & {error:string}).error),'');
     assert.equal(await input.locator('input').getAttribute('aria-invalid'),'false');
    }
   }finally{await page.close();}
  });}finally{await browser.close();}
 });
}
