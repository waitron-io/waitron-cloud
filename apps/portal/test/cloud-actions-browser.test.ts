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
const proposalFixture={id:'11111111-1111-4111-8111-111111111111',version:1,occurrence:'synthetic-incident',cell:'synthetic-cell',target:'synthetic-worker',
   actionId:'machine_drain',policy:'ask-first',proposal:'Drain the synthetic worker',evidence:'Synthetic health failure',state:'pending',effectId:'22222222-2222-4222-8222-222222222222',
   available:false,createdAt:'2026-11-16T19:00:00Z',decidedAt:null as string|null,approvalExpiresAt:null as string|null,events:[{kind:'proposed',at:'2026-11-16T19:00:00Z'}]};
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
   if(path.endsWith('/operator/actions')){reads++;assert.equal(r.request().method(),'GET');return r.fulfill(refused?{status:403,json:{error:'permission_denied'}}:{json:{actions,requests:[]}});}
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

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: exact proposals and lost-decision replies remain visible`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(3000);
  const proposed=proposalFixture;
  let requests:(typeof proposed)[]=[],decisions=0;
  await page.route('https://portal.test/operator/actions',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloud</title><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',r=>{
   const path=new URL(r.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return r.fulfill({json:session});
   if(path.endsWith('/action-proof'))return r.fulfill({json:{methods:['email'],freshUntil:'2099-01-01T00:00:00Z'}});
   if(path.endsWith('/operator/actions/requests')){
    if(!r.request().postDataJSON().occurrence)return r.fulfill({status:400,json:{error:'invalid_input'}});
    assert.deepEqual(r.request().postDataJSON(),{occurrence:'synthetic-incident',cell:'synthetic-cell',target:'synthetic-worker',actionId:'machine_drain',proposal:'Drain the synthetic worker',evidence:'Synthetic health failure'});
    assert.equal(r.request().headers()['x-csrf-token'],'synthetic-csrf');requests=[proposed];return r.fulfill({status:201,json:proposed});
   }
   if(path.endsWith('/operator/actions/decide')){
    decisions++;assert.deepEqual(r.request().postDataJSON(),{requestId:proposed.id,version:1,decision:'approved'});
    requests=[{...proposed,state:'approved',decidedAt:'2026-11-16T19:01:00Z',approvalExpiresAt:'2026-11-16T19:16:00Z',events:[...proposed.events,{kind:'approved',at:'2026-11-16T19:01:00Z'}]}];
    return r.fulfill({status:503,json:{error:'temporarily_unavailable'}});
   }
   if(path.endsWith('/operator/actions'))return r.fulfill({json:{actions,requests}});
   return r.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.context().addCookies([{name:'__Host-cloud_csrf',value:'synthetic-csrf',url:'https://portal.test',secure:true}]);
  await page.goto('https://portal.test/operator/actions');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const form=page.locator('#cloud-proposal');await form.waitFor();
  assert.equal(await form.locator('select[name=actionId]').inputValue(),'machine_drain');
  assert.equal(await page.locator('.cloud-actions > wt-form-actions').evaluate(row=>getComputedStyle(row).position),'static');
  await form.getByRole('button',{name:locale==='en'?'Save proposal':'Guardar propuesta',exact:true}).click();
  await page.getByRole('alert').getByText(locale==='en'?'Check the proposal fields.':'Revisa los campos de la propuesta.',{exact:true}).waitFor();
  for(const [name,value] of Object.entries({occurrence:'synthetic-incident',cell:'synthetic-cell',target:'synthetic-worker',proposal:'Drain the synthetic worker',evidence:'Synthetic health failure'}))await form.locator(`wt-input[name=${name}] input`).fill(value);
  await form.locator('select[name=actionId]').selectOption('machine_drain');
  await form.getByRole('button',{name:locale==='en'?'Save proposal':'Guardar propuesta',exact:true}).click();
  const proposal=page.getByRole('article');await proposal.getByText('Drain the synthetic worker',{exact:true}).waitFor();
  assert.match(await proposal.innerText(),/synthetic-cell/);assert.match(await proposal.innerText(),/synthetic-worker/);assert.match(await proposal.innerText(),/Synthetic health failure/);
  await proposal.getByRole('button',{name:locale==='en'?'Approve this proposal':'Aprobar esta propuesta',exact:true}).click();
  await proposal.getByText(locale==='en'?'Approved':'Aprobada',{exact:true}).first().waitFor();assert.equal(decisions,1);assert.equal(await form.locator('select[name=actionId]').inputValue(),'machine_drain');
  assert.equal(await proposal.getByRole('button').count(),0);assert.match(await proposal.innerText(),locale==='en'?/Approval expires/:/La aprobación caduca/);
  const approved=requests[0]!;requests=[{...approved,state:'superseded'}];
  await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();await proposal.getByText(locale==='en'?'Superseded':'Sustituida',{exact:true}).waitFor();
  assert.doesNotMatch(await proposal.innerText(),locale==='en'?/Approval expires/:/La aprobación caduca/);
  requests=[approved];await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();await proposal.getByText(locale==='en'?'Approved':'Aprobada',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:/execute|ejecutar/i}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.addScriptTag({content:axe.source});assert.deepEqual(await page.evaluate(async()=>(await (window as any).axe.run(document)).violations),[]);
  requests=[{...approved,actionId:'cloud_restart',policy:'act-and-report',state:'pending',decidedAt:null,approvalExpiresAt:null}];
  await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await proposal.getByText(locale==='en'?'Pending':'Pendiente',{exact:true}).waitFor();
  assert.equal(await proposal.getByRole('button').count(),0);
  requests=[{...requests[0]!,...{dispatchStartedAt:'2026-11-16T19:02:00Z',outcome:null}}];
  await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await proposal.getByText(locale==='en'?'Restart dispatched; awaiting confirmation':'Reinicio enviado; esperando confirmación',{exact:true}).waitFor();
  requests=[{...approved,actionId:'cloud_restart',policy:'act-and-report',state:'pending',decidedAt:null,approvalExpiresAt:null,...{outcome:{status:'confirmed'},dispatchStartedAt:'2026-11-16T19:02:00Z'}}];
  await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await proposal.getByText(locale==='en'?'Synthetic restart confirmed':'Reinicio sintético confirmado',{exact:true}).waitFor();
  assert.equal(await proposal.getByText(locale==='en'?'Pending':'Pendiente',{exact:true}).count(),0);
  if(process.env.CLOUD_ACTION_SCREENSHOTS){await mkdir(process.env.CLOUD_ACTION_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.CLOUD_ACTION_SCREENSHOTS}/decision-${locale}-${theme}-${width}.png`,fullPage:true});}
 }finally{await browser.close();}
});

test('response validation admits every pending proposal beyond fifty',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(4000);
  const requests=Array.from({length:52},(_,i)=>({...proposalFixture,id:'11111111-1111-4111-8111-'+String(i).padStart(12,'0'),occurrence:'synthetic-incident-'+i}));
  await page.route('https://portal.test/operator/actions',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Cloud</title><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',r=>{
   const path=new URL(r.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return r.fulfill({json:session});
   if(path.endsWith('/operator/actions'))return r.fulfill({json:{actions,requests}});
   return r.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/operator/actions');await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByRole('article').nth(51).waitFor();assert.equal(await page.getByRole('article').count(),52);
 }finally{await browser.close();}
});

for(const locale of ['en','es'] as const)test(`${locale}: operator notice delivery remains visible`,async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const theme of ['light','dark'] as const)for(const width of [390,1280]){
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(3000);
  let noticeStatus='failed';
  await page.route('https://portal.test/operator/actions',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloud</title><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**',r=>{
   const path=new URL(r.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return r.fulfill({json:session});
   if(path.endsWith('/operator/actions'))return r.fulfill({json:{actions,requests:[{...proposalFixture,events:[...proposalFixture.events,{kind:'notice',at:proposalFixture.createdAt,noticeStatus}]}]}});
   return r.fulfill({status:503,json:{error:'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test/operator/actions');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const article=page.getByRole('article');await article.waitFor();
  const failed=locale==='en'?'Notice not delivered':'Aviso no entregado';assert.match(await article.innerText(),new RegExp(failed));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.addScriptTag({content:axe.source});assert.deepEqual(await page.evaluate(async()=>(await (window as any).axe.run(document)).violations),[]);
  if(process.env.CLOUD_ACTION_SCREENSHOTS){await mkdir(process.env.CLOUD_ACTION_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.CLOUD_ACTION_SCREENSHOTS}/notice-${locale}-${theme}-${width}.png`,fullPage:true});}
  noticeStatus='sent';await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await article.getByText(locale==='en'?'Notice sent':'Aviso enviado',{exact:false}).waitFor();assert.doesNotMatch(await article.innerText(),new RegExp(failed));
  await page.close();
 }}finally{await browser.close();}
});
