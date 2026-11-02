import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {portalTrace,failPortalWait} from './portal-trace.ts';

test('panel wait evidence reports progress without recovery codes, hostnames or identifiers',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.route('https://portal.test/**',route=>route.fulfill({body:'<h1>private-heading</h1>'}));
  await page.goto('https://portal.test/recover?private-query#private-token');
  await page.evaluate(()=>{(window as any).app={path:'/recover',session:{state:{kind:'authenticated',accountId:'private-account'}},
   recovery:{pending:true,uncertain:false,code:'private-code',requestId:'private-request',view:undefined},
   remote:{pending:false,view:{installationId:'private-installation'},confirmation:{hostname:'private-hostname'},error:undefined,hostnameChanged:true},
   installations:{loaded:false,pending:true}};});
  const original=new Error('private-original'),reports:string[]=[];
  await assert.rejects(failPortalWait(page,portalTrace(page),'initial recovery code',original,details=>reports.push(details)),error=>error===original);
  const snapshot=JSON.parse(reports[0]!).snapshot;
  assert.equal(snapshot.path,'/recover');
  assert.deepEqual(snapshot.recovery,{pending:true,uncertain:false,codePresent:true,viewPresent:false});
  assert.deepEqual(snapshot.remote,{pending:false,viewPresent:true,confirmationPresent:true,errorPresent:false,hostnameChanged:true});
  assert.deepEqual(snapshot.installations,{loaded:false,pending:true});
  assert.equal(reports[0]!.includes('private-'),false);
  await page.evaluate(()=>{const app=(window as any).app;app.path='/private-path';app.recovery={pending:'private-pending',uncertain:null,code:undefined,view:{secret:'private-view'}};app.remote={pending:null,hostnameChanged:'private-changed',error:'private-error'};app.installations={};});
  await assert.rejects(failPortalWait(page,portalTrace(page),'remote changed-name review',original,details=>reports.push(details)),error=>error===original);
  const unknown=JSON.parse(reports[1]!).snapshot;
  assert.equal(unknown.path,'other');
  assert.deepEqual(unknown.recovery,{pending:'unavailable',uncertain:'unavailable',codePresent:false,viewPresent:true});
  assert.deepEqual(unknown.remote,{pending:'unavailable',viewPresent:false,confirmationPresent:false,errorPresent:true,hostnameChanged:'unavailable'});
  assert.deepEqual(unknown.installations,{loaded:'unavailable',pending:'unavailable'});
  assert.equal(reports[1]!.includes('private-'),false);
 }finally{await browser.close();}
});

test('panel traces retain static endpoint lifecycle and main-frame navigation without private URLs',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),trace=portalTrace(page);
  const paths=['/installations','/backups/list','/recovery/inspect','/recovery/approve','/recovery/replace','/recovery/close','/remote-access/status','/remote-access/dns','/remote-access/apply'];
  await page.route('https://portal.test/**',route=>route.fulfill({body:'{}',contentType:'application/json'}));
  await page.goto('https://portal.test/account?private-query#private-token');
  for(const path of paths){
   const finished=page.waitForEvent('requestfinished',request=>new URL(request.url()).pathname==='/api/account'+path);
   await page.evaluate(async path=>{await (await fetch('/api/account'+path+'?private-query',{method:'POST',body:'private-body'})).text();},path);
   await finished;
  }
  await page.evaluate(()=>new Promise<void>(resolve=>{const frame=document.createElement('iframe');frame.onload=()=>resolve();frame.src='/private-frame?private-query';document.body.append(frame);}));
  await page.goto('https://portal.test/private-navigation?private-query');
  const events=trace.events as {event:string;path:string;method?:string;status?:number}[];
  for(const path of paths){
   assert.deepEqual(events.filter(event=>event.path==='/api/account'+path).map(({event,method,status})=>({event,method,...(status===undefined?{}:{status})})),[
    {event:'request',method:'POST'},{event:'response',method:'POST',status:200},{event:'finished',method:'POST'},
   ]);
  }
  assert.deepEqual(events.filter(event=>event.event==='navigation').map(event=>event.path),['/account','other']);
  assert.equal(JSON.stringify(events).includes('private-'),false);
  for(let i=0;i<110;i++)trace.stage('bounded step');
  assert.equal(trace.events.length,100);
 }finally{await browser.close();}
});
