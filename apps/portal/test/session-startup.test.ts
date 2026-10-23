import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright';
import * as startup from './portal-trace.ts';

async function fixture(run:(page:Page)=>Promise<void>) {
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();page.setDefaultTimeout(500);
  await page.clock.install({time:new Date('2030-01-01T12:00:00Z')});
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:`<h1>Your account</h1><script>
   fetch('/api/account/session?token=private-query',{headers:{Authorization:'private-header'}}).then(async response=>{
    await response.text();throw new Error('private-browser-error');
   });
  </script>`}));
  await page.route('**/api/account/session?*',route=>route.fulfill({status:503,body:'private-response-body'}));
  await run(page);
 } finally {await browser.close();}
}

test('initial session miss reports request stages, safe heading and fake-clock time, then preserves the timeout',async()=>{
 assert.equal(typeof startup.waitForInitialSession,'function','initial session diagnostics must wrap the real wait');
 await fixture(async page=>{
  const reports:string[]=[];
  await assert.rejects(startup.waitForInitialSession(page,'https://portal.test',details=>reports.push(details)),{name:'TimeoutError'});
  assert.equal(reports.length,1);
  const report=JSON.parse(reports[0]!);
  assert.equal(report.stage,'initial signed-in screen');
  assert.equal(report.snapshot.heading,'Your account');
  assert.match(report.snapshot.clock,/^2030-01-01T12:00:00/);
  for(const event of ['request','response','finished']) assert.ok(report.browser.some((entry:{event:string,path:string})=>entry.event===event&&entry.path==='/api/account/session'),event);
  assert.ok(report.browser.some((entry:{event:string,status:number})=>entry.event==='response'&&entry.status===503));
  assert.ok(report.browser.some((entry:{event:string})=>entry.event==='pageerror'));
  for(const entry of report.browser) {assert.equal(typeof entry.ms,'number');if(entry.elapsed!==undefined)assert.ok(entry.elapsed>=0);}
  for(const secret of ['private-query','private-header','private-response-body','private-browser-error'])assert.equal(reports[0]!.includes(secret),false,secret);
 });
});

test('initial session success emits no failure report and keeps the page timeout',async()=>{
 assert.equal(typeof startup.waitForInitialSession,'function');
 await fixture(async page=>{
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<h1>Your account</h1><p>You are signed in to Waitron Cloud.</p>'}));
  const reports:string[]=[];
  await startup.waitForInitialSession(page,'https://portal.test',details=>reports.push(details));
  assert.deepEqual(reports,[]);
  await assert.rejects(page.getByText('missing').waitFor(),error=>error instanceof Error&&error.message.includes('Timeout 500ms exceeded'));
 });
});

test('initial session miss redacts an unexpected heading and a reporting failure cannot replace the timeout',async()=>{
 assert.equal(typeof startup.waitForInitialSession,'function');
 await fixture(async page=>{
  await page.route('https://portal.test/account',route=>route.fulfill({contentType:'text/html',body:'<h1>private-heading</h1>'}));
  let details='';
  await assert.rejects(startup.waitForInitialSession(page,'https://portal.test',value=>{details=value;throw new Error('reporter failed');}),{name:'TimeoutError'});
  assert.equal(JSON.parse(details).snapshot.heading,'other');
  assert.equal(details.includes('private-heading'),false);
 });
});

test('an unresponsive snapshot has a bounded diagnostic budget and preserves the initial timeout',async()=>{
 await fixture(async page=>{
  // Keep real navigation and locator waits; only the broken renderer's snapshot cannot answer.
  const stalled=new Proxy(page,{get(target,key){
   if(key==='evaluate')return ()=>new Promise(()=>{});
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const reports:string[]=[],started=performance.now();
  await assert.rejects(startup.waitForInitialSession(stalled,'https://portal.test',details=>reports.push(details)),{name:'TimeoutError'});
  assert.ok(performance.now()-started<2000,'500 ms wait plus 250 ms snapshot budget must finish');
  assert.equal(JSON.parse(reports[0]!).snapshot.unavailable,true);
 });
});
