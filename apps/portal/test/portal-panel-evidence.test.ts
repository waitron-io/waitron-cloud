import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {portalTrace,failPortalWait} from './portal-trace.ts';

test('one throwing panel getter preserves the other panel, session and usage evidence',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<main></main>');
  for(const broken of ['recovery','remote','installations']){
   await page.evaluate(broken=>{
    const app=(window as any).app={path:'/account',session:{state:{kind:'authenticated'}},usage:{pending:true,loaded:false,waiting:0},
     recovery:{pending:false,uncertain:false,code:''},remote:{pending:false,hostnameChanged:false},installations:{loaded:true,pending:false}};
    Object.defineProperty(app,broken,{get(){throw new Error('private-getter');}});
   },broken);
   const original=new Error('original'),reports:string[]=[];
   await assert.rejects(failPortalWait(page,portalTrace(page),'panel snapshot',original,details=>reports.push(details)),error=>error===original);
   const snapshot=JSON.parse(reports[0]!).snapshot;
   assert.equal(snapshot.session,'authenticated');assert.equal(snapshot.usage.pending,true);
   assert.deepEqual(snapshot[broken],{unavailable:true});
   for(const intact of ['recovery','remote','installations'].filter(name=>name!==broken))assert.equal(snapshot[intact].pending,false);
   assert.equal(reports[0]!.includes('private-getter'),false);
  }
 }finally{await browser.close();}
});

test('panel evidence follows real controller inspection, preview and installation reads',async()=>{
 const bundle=await build({stdin:{contents:`
  import {RecoveryController} from './src/recovery-controller.ts';
  import {RemoteController} from './src/remote-controller.ts';
  import {InstallationController} from './src/installation-controller.ts';
  const id='12345678-1234-4234-8234-123456789abc';
  const recovery=new RecoveryController(()=>{},async()=>({ok:true,value:{requestId:id,state:'awaiting_owner',expiresAt:'2099-01-01T00:00:00.000Z',operation:null,operationId:null}}));
  const remote=new RemoteController(()=>{},async path=>path==='/remote-access/status'?{ok:true,value:{installationId:id,revision:1,revoked:false,names:{staff:{assigned:'staff.venue.example',current:'staff.cafe.example'},public:{assigned:'venue.example',current:'venue.example'}},service:{state:'ready',health:'healthy',observedAt:null,validUntil:null}}}:{ok:false,status:503,code:'unavailable',retryAfterMs:0});
  const installations=new InstallationController(()=>{},async()=>({ok:true,value:{installations:[]}}));
  window.app={path:'/recover',session:{state:{kind:'authenticated'}},recovery,remote,installations};
  window.ready=(async()=>{recovery.open(id);recovery.account('owner');recovery.code='00123456';await recovery.inspect();remote.account('owner');await remote.open(id);remote.edit('staff.changed.example');await remote.preview();installations.account('owner');await installations.load();})();
 `,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<main></main>');
  await page.addScriptTag({content:bundle.outputFiles[0]!.text});await page.evaluate(()=>(window as any).ready);
  const original=new Error('original'),reports:string[]=[];
  await assert.rejects(failPortalWait(page,portalTrace(page),'controller reads',original,details=>reports.push(details)),error=>error===original);
  const snapshot=JSON.parse(reports[0]!).snapshot;
  assert.deepEqual(snapshot.recovery,{pending:false,uncertain:false,codePresent:true,viewPresent:true});
  assert.deepEqual(snapshot.remote,{pending:false,viewPresent:true,confirmationPresent:false,errorPresent:true,hostnameChanged:true});
  assert.deepEqual(snapshot.installations,{loaded:true,pending:false});
  await page.evaluate(async()=>{const remote=(window as any).app.remote;remote.edit('staff.venue.example');await remote.preview();});
  await assert.rejects(failPortalWait(page,portalTrace(page),'assigned-name confirmation',original,details=>reports.push(details)),error=>error===original);
  assert.deepEqual(JSON.parse(reports[1]!).snapshot.remote,{pending:false,viewPresent:true,confirmationPresent:true,errorPresent:false,hostnameChanged:true});
  assert.equal(reports.join('').includes('00123456'),false);assert.equal(reports.join('').includes('example'),false);
 }finally{await browser.close();}
});

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
