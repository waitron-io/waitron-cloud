import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.pendingSignoutApp = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const current = {id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-09-26T00:00:00Z',
  lastUsedAt: '2026-09-26T00:20:00Z', expiresAt: '2099-01-01T00:00:00Z', current: true};
type App = {session: {check(options?: {fresh?: boolean}): Promise<void>; state: {kind: string}}; navigate(path: string): void};
// Sharing a pre-revocation read would suppress the fresh check and sign-out notice.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
 const scenarios = theme === 'light' && width === 390
  ? ['current','lost-reply','expired','unavailable','navigate','new-session','older-first','rate','passive'] : ['current'];
 for (const scenario of scenarios) test(`${locale} ${theme} ${width}: ${scenario} revocation with a pending session snapshot`, async () => {
  const browser = await chromium.launch({headless: true});
  let releaseOld!:()=>void, releaseFresh!:()=>void, oldEntered!:()=>void, freshEntered!:()=>void;
  const oldReply=new Promise<void>(resolve=>{releaseOld=resolve;});
  const freshReply=new Promise<void>(resolve=>{releaseFresh=resolve;});
  const oldRequest=new Promise<void>(resolve=>{oldEntered=resolve;});
  const freshRequest=new Promise<void>(resolve=>{freshEntered=resolve;});
  try {
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}}); page.setDefaultTimeout(4000);
   const c=translations[locale]; let reads=0,ended=false;
   if(scenario==='rate')await page.clock.install({time:new Date('2030-01-01T12:00:00Z')});
   const writes:{path:string;body:unknown}[]=[];
   await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
   await page.route('**/api/account/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/account','');
    if(path==='/session'){
     const read=++reads;
     if(read===2){oldEntered();await oldReply;}
     if(read===3){freshEntered();await freshReply;}
     if(read<3)return route.fulfill({json:{accountId:'owner',expiresAt:current.expiresAt}});
     if(read===3&&scenario==='rate')return route.fulfill({status:429,headers:{'retry-after':'60'},json:{error:'rate_limited'}});
     if(read===3&&scenario==='unavailable')return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
     return route.fulfill({status:401,json:{error:scenario==='expired'?'session_expired':'unauthenticated'}});
    }
    if(path==='/session/activity')return route.fulfill({json:{accountId:'owner',expiresAt:current.expiresAt}});
    if(route.request().method()==='POST')writes.push({path,body:route.request().postDataJSON()});
    if(path==='/sessions/revoke'){ended=true;return scenario==='lost-reply'?route.abort('connectionreset'):route.fulfill({status:204});}
    if(path==='/sessions')return ended?route.fulfill({status:401,json:{error:'unauthenticated'}}):route.fulfill({json:{sessions:[current]}});
    if(path==='/passkeys')return route.fulfill({json:{passkeys:[]}});
    if(path==='/installations')return route.fulfill({json:{installations:[]}});
    if(path==='/authenticator')return route.fulfill({json:{active:false,version:0,recoveryCodesRemaining:0,available:false}});
    if(path==='/alerts')return route.fulfill({json:{enabled:false,locale}});
    if(path==='/translation-consent')return route.fulfill({json:{consents:[]}});
    return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
   });
   await page.goto('https://portal.test/account');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
   const signout=page.locator('.sessions').getByRole('button',{name:c.sessionSignOut,exact:true});await signout.waitFor();
   await page.evaluate(()=>{void(window as unknown as {pendingSignoutApp:App}).pendingSignoutApp.session.check();});await oldRequest;
   if(scenario==='passive'){
    await page.evaluate(()=>{void(window as unknown as {pendingSignoutApp:App}).pendingSignoutApp.session.check();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(reads,2,'ordinary checks still share their pending read');
    const response=page.waitForResponse('**/api/account/session');releaseOld();await response;
    assert.equal(new URL(page.url()).pathname,'/account');assert.deepEqual(writes,[]);return;
   }
   await signout.click();
   await Promise.race([freshRequest,new Promise<never>((_,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('No fresh session check after current-session revocation')),4000);
    void freshRequest.then(()=>clearTimeout(timeout));
   })]);
   assert.equal(reads,3);
   if(scenario==='older-first'){
    const response=page.waitForResponse('**/api/account/session');releaseOld();await response;
    await page.waitForFunction(()=>(window as unknown as {pendingSignoutApp:App}).pendingSignoutApp.session.state.kind==='authenticated');
    assert.equal(new URL(page.url()).pathname,'/account');
    assert.equal(await page.getByText(c.signedOut,{exact:true}).count(),0,'the old authenticated snapshot cannot confirm sign-out');
   }
   if(scenario==='navigate')await page.evaluate(()=>(window as unknown as {pendingSignoutApp:App}).pendingSignoutApp.navigate('/signup'));
   if(scenario==='new-session')await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
   releaseFresh();
   if(scenario==='unavailable'||scenario==='rate'){
    await page.getByRole('status').filter({hasText:c.sessionUnavailable}).waitFor();
    if(scenario==='rate'){
     await page.evaluate(async()=>{await(window as unknown as {pendingSignoutApp:App}).pendingSignoutApp.session.check({fresh:true});});
     assert.equal(reads,3,'fresh checks cannot bypass the server wait');
     const response=page.waitForResponse('**/api/account/session');releaseOld();await response;
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     assert.equal(await page.getByRole('status').filter({hasText:c.sessionUnavailable}).count(),1,'the older snapshot cannot replace a newer refusal');
     await page.clock.fastForward(61_000);
    }
    await page.evaluate(async()=>{await(window as unknown as {pendingSignoutApp:App}).pendingSignoutApp.session.check();});
   }
   await page.getByRole('heading',{name:scenario==='navigate'?c.signup:c.login,exact:true}).waitFor();
   const expected=scenario==='expired'?c.sessionExpired:['navigate','new-session','unavailable','rate'].includes(scenario)?undefined:c.signedOut;
   if(expected)await page.getByRole('status').getByText(expected,{exact:true}).waitFor();
   else assert.equal(await page.getByRole('status').count(),0,'stale intent cannot label another navigation, session or passive check');
   const oldResponse=['older-first','rate'].includes(scenario)?undefined:page.waitForResponse('**/api/account/session');releaseOld();if(oldResponse)await oldResponse;
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(new URL(page.url()).pathname,scenario==='navigate'?'/signup':'/login','the late authenticated snapshot cannot restore the account');
   assert.equal(await page.getByText(c.signedOut,{exact:true}).count(),expected===c.signedOut?1:0);
   assert.deepEqual(writes,[{path:'/sessions/revoke',body:{id:current.id}}],'reconciliation never repeats the revoke');
   if(scenario==='current'&&process.env.PENDING_SIGNOUT_RECEIPT_DIR){await mkdir(process.env.PENDING_SIGNOUT_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.PENDING_SIGNOUT_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});}
  }finally{releaseOld();releaseFresh();await browser.close();}
 });
}
