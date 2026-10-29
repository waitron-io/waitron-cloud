import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {startAccountServer} from '../src/server.ts';
import {createAccountApp} from '../src/app.ts';
import {fixture,fault,origin,path} from './fixtures/billing-display.ts';

async function server(t:Parameters<typeof fixture>[0],f:Awaited<ReturnType<typeof fixture>>,portal=false){
 const options={...f.options,port:0,...(portal?{portalAssets:new Map([['/index.html',{body:Buffer.from('<!doctype html><title>Cloud account</title>'),contentType:'text/html'}]])}:{})};
 const running=await startAccountServer(options);t.after(()=>running.close());return running;
}
function socket(running:Awaited<ReturnType<typeof startAccountServer>>,body:unknown,headers:Record<string,string>={},mode:'normal'|'slow'|'overflow'='normal'){
 return new Promise<Response>((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:(running.server.address() as {port:number}).port,path,method:'POST',headers:{host:'cloud.example.test','content-type':'application/json',...headers}},res=>{
   const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
   res.on('end',()=>{resolve(new Response(Buffer.concat(chunks),{status:res.statusCode!,headers:res.headers as Record<string,string>}));req.destroy();});
  });
  req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('test_socket_timeout')));
  if(mode==='slow'){req.write('{');req.flushHeaders();}
  else if(mode==='overflow'){req.write(' '.repeat(8192));req.end(' '.repeat(8193));}
  else req.end(JSON.stringify(body));
 });
}
// Caching the operation result or bypassing the adapter at the server boundary breaks these reads.
test('billing socket reauthenticates the same operation and returns new facts after an owned server restart',async t=>{
 const f=await fixture(t),envelope=f.proof();let running=await server(t,f);
 const first=await socket(running,envelope);assert.equal(first.status,200);const original=await first.json();
 assert.deepEqual(original.billing,{status:'ready',level:'registered',state:'active',period:null});
 assert.equal(first.headers.get('cache-control'),'no-store');assert.equal(first.headers.get('set-cookie'),null);assert.equal(first.headers.get('etag'),null);
 await running.close();await f.level();await delay(1);t.mock.timers.tick(1000);running=await server(t,f);
 const second=await socket(running,envelope,{'if-none-match':'"pretend-cached"','if-modified-since':'Mon, 02 Nov 2026 11:00:00 GMT'});
 assert.equal(second.status,200);const changed=await second.json();assert.deepEqual(changed.billing,{status:'ready',level:'connected',state:'active',period:null});
 assert.equal(changed.asOf,'2026-11-02T11:00:01.000Z');assert.equal(changed.accountUrl,origin+'/account');assert.equal(changed.installationId,f.installationId);assert.equal(changed.venueId,f.venueId);
 assert.ok(Buffer.byteLength(JSON.stringify(changed),'utf8')<=16384);assert.equal(second.headers.get('etag'),null);
 assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM installation_operations')).rows[0].n,0);
 await f.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installationId]);
 await fault(await socket(running,envelope),403,'revoked');
});
test('billing socket rejects a trickled request within the five-second body deadline',async t=>{
 const f=await fixture(t),running=await server(t,f),started=performance.now();
 await fault(await socket(running,undefined,{},'slow'),408,'invalid_input');
 const elapsed=performance.now()-started;assert.ok(elapsed>=4500&&elapsed<8500,'request bound: '+elapsed);
});
test('billing socket enforces streamed bytes and body encoding independently of content length',async t=>{
 const f=await fixture(t),running=await server(t,f);
 await fault(await socket(running,undefined,{},'overflow'),413,'invalid_input');
 await fault(await socket(running,f.proof(),{'content-encoding':'br'}),415,'invalid_input');
});
test('billing socket destination is the existing account page and unsafe configured origins refuse before database reads',async t=>{
 const f=await fixture(t),running=await server(t,f,true);
 const display=await socket(running,f.proof());assert.equal(display.status,200);assert.equal((await display.json()).accountUrl,origin+'/account');
 const account=await new Promise<{status:number;body:string}>((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:(running.server.address() as {port:number}).port,path:'/account',headers:{host:'cloud.example.test'}},res=>{
   let body='';res.on('data',chunk=>{body+=chunk;});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode!,body}));
  });req.on('error',reject);req.end();
 });
 assert.equal(account.status,200);assert.match(account.body,/<title>Cloud account<\/title>/);
 const queries=await f.pool.query('SELECT attempts FROM account_rate_limits ORDER BY key');
 for(const portalOrigin of ['http://cloud.example.test','https://user:password@cloud.example.test','https://cloud.example.test/path','https://cloud.example.test?venue=x','https://cloud.example.test#fragment','javascript:alert(1)'])
  assert.throws(()=>createAccountApp({...f.options,config:{...f.options.config,portalOrigin}}),/Invalid account HTTP configuration/);
 assert.deepEqual((await f.pool.query('SELECT attempts FROM account_rate_limits ORDER BY key')).rows,queries.rows);
});
