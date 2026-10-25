import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import {translations, type Locale} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const token = 'a'.repeat(43), password = '  A café owner password  ';
const flows = [
 {path:'/login', button:'login', fields:['email','password']},
 {path:'/signup', button:'continue', fields:['email']},
 {path:'/forgot-password', button:'sendReset', fields:['email']},
 {path:'/signup', button:'create', fields:['password','legalBusinessName'], completion:true},
 {path:'/reset-password', button:'savePassword', fields:['password'], completion:true},
] as const;
type Flow = typeof flows[number];
const nonbreakingSpace = String.fromCodePoint(0xa0);
const values = {email:nonbreakingSpace+'owner@example.es'+nonbreakingSpace, password, legalBusinessName:'Bar Pepe SL', organisationName:'Grupo Pepe'};
async function open(browser:Browser, flow:Flow, locale:Locale, theme:'light'|'dark', width:number, failure=503) {
 const page = await browser.newPage({locale, colorScheme:theme, viewport:{width,height:900}});
 page.setDefaultTimeout(3000);
 const calls:{path:string;body:unknown}[]=[], errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://portal.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
 await page.route('**/api/account/**',route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/account','');
  if(path==='/session')return route.fulfill({status:401,json:{error:'credentials_invalid'}});
  calls.push({path,body:route.request().postDataJSON()});
  if(failure===0)return route.abort('connectionreset');
  return route.fulfill({status:failure,json:{error:failure===401?'credentials_invalid':failure===429?'rate_limited':'temporarily_unavailable'}});
 });
 await page.goto(`https://portal.test${flow.path}${'completion' in flow?'#token='+token:''}`);
 await page.addStyleTag({content:styles});
 await page.addScriptTag({content:bundle.outputFiles[0]!.text});
 return {page,calls,errors};
}

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280]) {
 test(`${locale} ${theme} ${width}: correcting a field clears its own message`,async t=>{
  const browser=await chromium.launch({headless:true}),c=translations[locale];
  try {
   for(const flow of flows)await t.test(`${flow.path} ${flow.button}`,async()=>{
    const {page,calls,errors}=await open(browser,flow,locale,theme,width);
    try {
     const submit=page.getByRole('button',{name:c[flow.button],exact:true});
     await submit.click();
     const marked=()=>page.locator('input[aria-invalid=true]');
     assert.deepEqual(await marked().evaluateAll(inputs=>inputs.map(input=>input.getAttribute('name'))),[...flow.fields]);
     assert.equal(await page.locator(`input[name=${flow.fields[0]}]`).evaluate(input=>(input.getRootNode() as ShadowRoot).activeElement===input),true,'submit focuses the first bad field');
     const first=flow.fields[0], firstInput=page.locator(`input[name=${first}]`);
     await firstInput.fill(first==='email'?'still invalid':'');
     // An actual edit clears feedback, but submit must check the value again.
     if(first!=='email')await firstInput.fill('x');
     assert.equal(await firstInput.getAttribute('aria-invalid'),'false');
     assert.deepEqual(await marked().evaluateAll(inputs=>inputs.map(input=>input.getAttribute('name'))),flow.fields.slice(1),'other fields keep their messages');
     await submit.click();
     assert.equal(await firstInput.getAttribute('aria-invalid'),'true');
     assert.deepEqual(calls,[],'editing must not bypass submit checks or send requests');
     for(const field of flow.fields) {
      await page.locator(`input[name=${field}]`).fill(values[field]);
      assert.equal(await page.locator(`input[name=${field}]`).getAttribute('aria-invalid'),'false');
     }
     assert.deepEqual(await page.locator('wt-form-error-summary').evaluate(element=>(element as HTMLElement & {errors:string[]}).errors),[]);
     const other=locale==='en'?'es':'en';
     await page.getByRole('combobox').selectOption(other);
     for(const field of flow.fields)assert.equal(await page.locator(`input[name=${field}]`).inputValue(),values[field]);
     assert.deepEqual(calls,[]);
     await page.getByRole('button',{name:translations[other][flow.button],exact:true}).click();
     await page.locator('wt-form-error-summary').getByText(translations[other].unavailable,{exact:true}).waitFor();
     const expected=flow.path==='/login'?{path:'/login',body:{email:'owner@example.es',password}}:
      'completion' in flow?flow.path==='/signup'?{path:'/signup/complete',body:{token,password,legalBusinessName:'Bar Pepe SL',organisationName:'Bar Pepe SL',countryCode:'ES'}}:
       {path:'/password-reset/complete',body:{token,password,locale:other}}:
       {path:flow.path==='/signup'?'/signup/request':'/password-reset/request',body:{email:'owner@example.es',locale:other}};
     assert.deepEqual(calls,[expected]);
     assert.deepEqual(errors,[]);
    } finally {await page.close();}
   });
   await t.test('hiding organisation clears only its message',async()=>{
    const {page,calls,errors}=await open(browser,flows[3],locale,theme,width);
    try {
     const checkbox=page.getByRole('checkbox'),submit=page.getByRole('button',{name:c.create,exact:true});
     await checkbox.check();await submit.click();
     assert.equal(await page.locator('input[aria-invalid=true]').count(),3);
     await checkbox.uncheck();
     assert.equal(await page.locator('input[name=organisationName]').count(),0);
     assert.deepEqual(await page.locator('wt-form-error-summary').evaluate(element=>(element as HTMLElement & {errors:string[]}).errors),[c.passwordHelp,c.nameError]);
     assert.equal(await page.locator('input[aria-invalid=true]').count(),2);
     await page.locator('input[name=legalBusinessName]').fill(values.legalBusinessName);
     assert.deepEqual(await page.locator('wt-form-error-summary').evaluate(element=>(element as HTMLElement & {errors:string[]}).errors),[c.passwordHelp]);
     await checkbox.check();
     assert.equal(await page.locator('input[name=organisationName]').getAttribute('aria-invalid'),'false');
     await page.locator('input[name=organisationName]').fill(values.organisationName);
     await checkbox.uncheck();await checkbox.check();
     assert.equal(await page.locator('input[name=organisationName]').inputValue(),values.organisationName);
     assert.deepEqual(calls,[]);assert.deepEqual(errors,[]);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     if(process.env.FORM_ERROR_RECEIPT_DIR){await mkdir(process.env.FORM_ERROR_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.FORM_ERROR_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
    } finally {await page.close();}
   });
  } finally {await browser.close();}
 });
}

for(const locale of ['en','es'] as const)for(const failure of [401,503,429,0])test(`${locale} ${failure}: editing preserves form-level server feedback`,async()=>{
 const browser=await chromium.launch({headless:true}),c=translations[locale],flow=failure===0?flows[4]:flows[0];
 try {
  const {page,calls,errors}=await open(browser,flow,locale,'light',390,failure);
  try {
   for(const field of flow.fields)await page.locator(`input[name=${field}]`).fill(values[field]);
   await page.getByRole('button',{name:c[flow.button],exact:true}).click();
   const message=failure===401?c.credentials:failure===429?c.limited:failure===0?c.uncertain:c.unavailable;
   await page.locator('wt-form-error-summary').getByText(message,{exact:true}).waitFor();
   await page.locator('input[name=password]').fill('another long owner password');
   assert.deepEqual(await page.locator('wt-form-error-summary').evaluate(element=>(element as HTMLElement & {errors:string[]}).errors),[message]);
   assert.equal(calls.length,1,'typing does not retry a failed request');assert.deepEqual(errors,[]);
  } finally {await page.close();}
 } finally {await browser.close();}
});
