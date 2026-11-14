import assert from 'node:assert/strict';
import {test} from 'node:test';
import {transaction} from '@waitron-cloud/registration';
import {setGuestMenuBlocked} from '@waitron-cloud/remote-access/guest-menu';
import {guestTlsFixture} from './fixtures/guest-menu.ts';
import {startGuestMenuServer} from '../src/guest-menu-server.ts';
const host='menus.example.test',origin=`https://${host}`;

test('anonymous HTTPS serves only the stored menu with language fallback, HEAD and restrictive headers',async()=>{
 const f=await guestTlsFixture();
 let running:Awaited<ReturnType<typeof startGuestMenuServer>>|undefined;
 try{
  await f.seed();
  running=await startGuestMenuServer(f.options);
  const address=running.server.address();assert(address&&typeof address!=='string');
  const send=(path:string,method='GET',headers:Record<string,string>={})=>f.send(address.port,path,method,headers);
  const path=`/m/${f.venueId}`,es=await send(path+'?lang=es');
  assert.equal(es.status,200);assert.equal(es.body,'<h1>Menú</h1>');
  assert.equal(es.headers['content-type'],'text/html; charset=utf-8');
  assert.equal(es.headers['cache-control'],'no-store');assert.equal(es.headers['set-cookie'],undefined);
  assert.match(String(es.headers['content-security-policy']),/default-src 'none'/);
  assert.match(String(es.headers['content-security-policy']),/frame-ancestors 'none'/);
  assert.equal((await send(path+'?lang=ca')).body,'<h1>Menu</h1>');
  const head=await send(path,'HEAD');assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(Number(head.headers['content-length']),13);
  for(const suffix of ['?lang=xx','?lang=es&lang=en','?unknown=1','/extra','?lang=es&x=1'])assert.equal((await send(path+suffix)).status,400);
  assert.equal((await send(path+'/../'+f.venueId)).status,400);
  assert.equal((await send(path,'POST')).status,405);
  assert.equal((await send(path,'GET',{host:'cloud.example.test'})).status,403);
  assert.equal((await send(path,'GET',{'content-length':'1'})).status,400);
  await f.db.pool.query('UPDATE guest_menus SET pages=$2,revision=revision+1 WHERE venue_id=$1',[f.venueId,{en:'á'.repeat(1048576)}]);
  const maximum=await send(path);assert.equal(maximum.status,200);assert.equal(Buffer.byteLength(maximum.body),2097152);
  await f.db.pool.query('UPDATE guest_menus SET pages=$2,revision=revision+1 WHERE venue_id=$1',[f.venueId,{en:'á'.repeat(1048577)}]);
  assert.equal((await send(path)).status,503);
 }finally{await running?.close();await f.close();}
});

test('the guest listener refuses a third database pass without queuing and limits each source to 120 a minute',async t=>{
 const f=await guestTlsFixture();await f.seed();const running=await startGuestMenuServer(f.options);
 const address=running.server.address();assert(address&&typeof address!=='string');
 let release!:()=>void,observed!:()=>void,calls=0;
 const gate=new Promise<void>(r=>release=r),two=new Promise<void>(r=>observed=r),query=f.db.pool.query.bind(f.db.pool);
 t.mock.method(f.db.pool,'query',async(...args:any[])=>{
  const result=await (query as (...args:any[])=>Promise<any>)(...args);
  if(String(args[0]).startsWith('SELECT revision,default_language,pages')&&calls<2){if(++calls===2)observed();await gate;}
  return result;
 });
 const path='/m/'+f.venueId,pending=[f.send(address.port,path),f.send(address.port,path)];
 try{
  await two;assert.equal((await f.send(address.port,path)).status,503);assert.equal(calls,2);release();
  assert.deepEqual((await Promise.all(pending)).map(r=>r.status),[200,200]);
  for(let n=0;n<118;n++)assert.equal((await f.send(address.port,path,'HEAD')).status,200);
  const limited=await f.send(address.port,path);assert.equal(limited.status,429);assert.ok(Number(limited.headers['retry-after'])>0);
 }finally{release();await Promise.allSettled(pending);await running.close();await f.close();}
});

test('a takedown committed while the copy is buffered prevents HTML from being released',async t=>{
 const f=await guestTlsFixture();await f.seed();const running=await startGuestMenuServer(f.options);
 let release!:()=>void,observed!:()=>void;const gate=new Promise<void>(r=>release=r),buffered=new Promise<void>(r=>observed=r);
 const query=f.db.pool.query.bind(f.db.pool);let held=false;
 t.mock.method(f.db.pool,'query',async(...args:any[])=>{
  const result=await (query as (...args:any[])=>Promise<any>)(...args);
  if(!held&&String(args[0]).startsWith('SELECT revision,default_language,pages')){held=true;observed();await gate;}
  return result;
 });
 const address=running.server.address();assert(address&&typeof address!=='string');
 const reply=f.send(address.port,'/m/'+f.venueId);
 try{
  await buffered;await transaction(f.db.pool,c=>setGuestMenuBlocked(c,f.venueId,true,origin));release();
  const response=await reply;assert.equal(response.body.includes('<h1>'),false);assert.equal(response.status,404);
 }finally{release();await reply.catch(()=>{});await running.close();await f.close();}
});
