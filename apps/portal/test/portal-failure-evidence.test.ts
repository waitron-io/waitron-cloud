import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium,type Page} from 'playwright';
import * as evidence from './portal-trace.ts';

async function fixture(run:(page:Page)=>Promise<void>){
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(300);
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<h1>private-heading</h1>'}));
  await page.goto('https://portal.test/account');
  await page.evaluate(()=>{(window as any).app={session:{state:{kind:'authenticated',accountId:'private-account'}},usage:{pending:true,loaded:false,error:undefined,waiting:0,organisationId:'private-organisation',summary:undefined}};});
  await run(page);
 }finally{await browser.close();}
}

test('a usage wait failure records an observed browser request without inventing a response and preserves the original error',async()=>{
 await fixture(async page=>{
  const trace=evidence.portalTrace(page),reports:string[]=[];
  await page.route('**/api/account/usage/read?*',route=>route.abort());
  await page.evaluate(()=>{void fetch('/api/account/usage/read?private-query',{method:'POST',body:'private-body'}).catch(()=>{});});
  await page.waitForFunction(()=>true);
  let original:unknown;try{await page.waitForFunction(()=>(window as any).app.usage.error==='limited');}catch(error){original=error;}
  assert.ok(original instanceof Error);
  assert.equal(typeof evidence.failPortalWait,'function','failed waits need bounded controller and request evidence');
  await assert.rejects(evidence.failPortalWait(page,trace,'usage rate-limit reply',original,value=>reports.push(value)),error=>error===original);
  const report=JSON.parse(reports[0]!);
  assert.equal(report.stage,'usage rate-limit reply');
  assert.deepEqual(report.snapshot.usage,{pending:true,loaded:false,error:'absent',waiting:0,organisationSelected:true,hasSummary:false});
  assert.equal(report.snapshot.session,'authenticated');
  assert.ok(report.browser.some((event:{event:string,path:string})=>event.event==='request'&&event.path==='/api/account/usage/read'));
  assert.ok(report.browser.some((event:{event:string,path:string})=>event.event==='failed'&&event.path==='/api/account/usage/read'));
  assert.equal(report.browser.some((event:{event:string})=>event.event==='response'),false);
  for(const secret of ['private-query','private-body','private-heading','private-account','private-organisation'])assert.equal(reports[0]!.includes(secret),false,secret);
 });
});

test('usage response headers do not claim body completion or an accepted controller result',async()=>{
 let release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 const server=createServer(async(request,response)=>{
  if(request.url==='/api/account/usage/read'){
   response.writeHead(429,{'content-type':'application/json'});response.flushHeaders();
   await held;response.end('{"error":"rate_limited"}');
  }else response.end('<h1>Account</h1>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(300);
  await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
  const trace=evidence.portalTrace(page);
  const headers=page.waitForResponse(response=>response.url().endsWith('/api/account/usage/read'));
  await page.evaluate(()=>{
   const usage={pending:true,loaded:false,error:undefined as string|undefined,waiting:0};
   (window as any).app={usage};
   void fetch('/api/account/usage/read',{method:'POST'}).then(async response=>{await response.json();usage.pending=false;usage.error='limited';});
  });
  await headers;
  const original=new Error('private-original'),reports:string[]=[];
  await assert.rejects(evidence.failPortalWait(page,trace,'usage rate-limit reply',original,value=>reports.push(value)),error=>error===original);
  const report=JSON.parse(reports[0]!);
  assert.ok(report.browser.some((event:{event:string,status:number})=>event.event==='response'&&event.status===429));
  assert.equal(report.browser.some((event:{event:string})=>event.event==='finished'),false);
  assert.equal(report.snapshot.usage.pending,true);assert.equal(report.snapshot.usage.error,'absent');
  assert.equal(reports[0]!.includes('private-original'),false);
  release();await page.waitForFunction(()=>(window as any).app.usage.error==='limited');
  await assert.rejects(evidence.failPortalWait(page,trace,'usage rate-limit reply',original,value=>reports.push(value)),error=>error===original);
  const completed=JSON.parse(reports[1]!);
  assert.ok(completed.browser.some((event:{event:string})=>event.event==='finished'));
  assert.equal(completed.snapshot.usage.pending,false);assert.equal(completed.snapshot.usage.error,'limited');
 }finally{release();await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('unexpected controller values and a broken reporter cannot replace the original failure',async()=>{
 await fixture(async page=>{
  await page.evaluate(()=>{(window as any).app.session.state.kind='private-state';Object.assign((window as any).app.usage,{error:'private-error',waiting:Infinity});});
  const original=new Error('original');let report='';
  await assert.rejects(evidence.failPortalWait(page,evidence.portalTrace(page),'usage retry',original,value=>{report=value;throw new Error('report failed');}),error=>error===original);
  const snapshot=JSON.parse(report).snapshot;
  assert.equal(snapshot.session,'other');assert.equal(snapshot.usage.error,'other');assert.equal(snapshot.usage.waiting,'unavailable');
  assert.equal(report.includes('private-'),false);
 });
});

test('a closed or unresponsive page has bounded failure reporting and retains the original failure',async()=>{
 await fixture(async page=>{
  const original=new Error('original');
  const stalled=new Proxy(page,{get(target,key){if(key==='evaluate')return()=>new Promise(()=>{});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  let report='';const started=performance.now();
  await assert.rejects(evidence.failPortalWait(stalled,evidence.portalTrace(page),'usage retry',original,value=>{report=value;}),error=>error===original);
  assert.ok(performance.now()-started<1500,'the diagnostic must stop after its separate 250 ms budget');
  assert.deepEqual(JSON.parse(report).snapshot,{unavailable:true});
  await page.close();
  await assert.rejects(evidence.failPortalWait(page,evidence.portalTrace(page),'usage retry',original,value=>{report=value;}),error=>error===original);
  assert.deepEqual(JSON.parse(report).snapshot,{unavailable:true});
 });
});
