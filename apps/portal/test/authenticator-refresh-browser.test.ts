import {mockActionProof} from './action-proof-fixture.ts';
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
   const writes:{path:string;body:unknown}[]=[];let reads=0,responseWait=0,active=flow.active as boolean;
   try{
    await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**',route=>{
        const actionProof=mockActionProof(route);if(actionProof)return actionProof;
     const request=route.request(),path=new URL(request.url()).pathname.replace('/api/account','');
     if(path==='/session'||path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt}});
     if(path==='/authenticator'){reads++;return route.fulfill({json:{active,version:reads,recoveryCodesRemaining:active?8:0,available:true}});}
     if(request.method()==='POST')writes.push({path,body:request.postDataJSON()});
     if(path==='/authenticator/begin')return route.fulfill({json:{pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt}});
     if(path==='/authenticator/activate'||path==='/authenticator/remove')return route.fulfill({status:400,headers:{'Retry-After':String(responseWait)},json:{error:'invalid_input'}});
     return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    const factor=page.locator('.authenticator'),password=page.locator('input[name=factorPassword]');await factor.locator('h3').waitFor();

    if(flow.action==='activate'){
     await factor.getByRole('button',{name:flow.active?c.factorReplace:c.factorEnable,exact:true}).click();await page.locator('input[name=factorConfirmation]').waitFor();
     await page.locator('input[name=factorConfirmation]').fill('654321');
    }
    await factor.getByRole('button',{name:flow.action==='activate'?c.factorActivate:c.factorRemove,exact:true}).click();
    const guidance=locale==='en'?'Check your authenticator settings, then verify security and start again.':'Comprueba la configuración del autenticador, verifica tu seguridad y vuelve a empezar.';
    await factor.getByRole('alert').getByText(guidance,{exact:true}).waitFor();
    assert.equal(await factor.getByText(c.factorUnavailable,{exact:true}).count(),0);
    assert.equal(await password.count(),0);assert.equal(reads,1);
    const before=writes.length;active=flow.nowActive;
    const receipt=process.env.AUTHENTICATOR_REFRESH_RECEIPT_DIR;
    if(receipt){await mkdir(receipt,{recursive:true});await factor.scrollIntoViewIfNeeded();await factor.screenshot({path:`${receipt}/${locale}-${theme}-${width}-${flow.name.replaceAll(' ','-')}-refused.png`});}
    await factor.getByRole('button',{name:locale==='en'?'Check authenticator settings':'Comprobar configuración del autenticador',exact:true}).click();
    await factor.getByText(flow.nowActive?c.factorOn:c.factorOff,{exact:true}).waitFor();
    assert.equal(await page.locator('h1').evaluate(el=>el===document.activeElement),true,'refresh keeps keyboard focus on the account heading');
    assert.equal(reads,2);assert.equal(writes.length,before);assert.equal(await factor.locator('.factor-secret').count(),0);assert.equal(await page.locator('input[name=factorConfirmation]').count(),0);assert.equal(await password.count(),0);
    assert.equal(await page.locator('input[name=factorProof]').count(),0);
    const begin=factor.getByRole('button',{name:flow.nowActive?c.factorReplace:c.factorEnable,exact:true});
    await begin.click();await page.locator('input[name=factorConfirmation]').waitFor();
    assert.deepEqual(writes.at(-1),{path:'/authenticator/begin',body:{}});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(receipt){await factor.scrollIntoViewIfNeeded();await factor.screenshot({path:`${receipt}/${locale}-${theme}-${width}-${flow.name.replaceAll(' ','-')}-restarted.png`});}
    responseWait=60;await page.locator('input[name=factorConfirmation]').fill('654321');
    await factor.getByRole('button',{name:c.factorActivate,exact:true}).click();await factor.getByRole('alert').getByText(guidance,{exact:true}).waitFor();
    const refresh=factor.getByRole('button',{name:locale==='en'?'Check authenticator settings':'Comprobar configuración del autenticador',exact:true});
    assert.equal(await refresh.isDisabled(),true,'status checks respect the response retry delay');
    const after=writes.length;await refresh.evaluate(el=>(el as HTMLButtonElement).click());assert.equal(reads,2);assert.equal(writes.length,after);

   }finally{await page.close();}
  });}finally{await browser.close();}
 });
}
