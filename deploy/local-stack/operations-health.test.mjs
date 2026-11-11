import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {localHealthFetch,readAccountRequests} from './operations-health.mjs';

test('local health transport preserves account authority and response bounds',async()=>{
 let authority,path;
 const server=createServer((request,response)=>{authority=request.headers.host;path=request.url;response.setHeader('content-length','17');response.end('{"status":"live"}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const response=await localHealthFetch(new URL(`http://127.0.0.1:${server.address().port}/api/health/live`),{signal:AbortSignal.timeout(2000)});
  assert.equal(authority,'localhost:3000');assert.equal(path,'/api/health/live');
  assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),'17');assert.equal(await response.text(),'{"status":"live"}');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('account count acquisition bounds status, redirects, body and deadline independently of health',async()=>{
 let mode='valid',requested;
 const sample={version:1,startedAt:1000,series:[]};
 const server=createServer((request,response)=>{
  if(mode==='stall'){response.writeHead(200);response.write('{');return;}
  if(mode==='redirect'){response.writeHead(302,{location:'/metrics'});response.end();return;}
  if(mode==='refused'){response.writeHead(503);response.end();return;}
  response.end(mode==='large'?' '.repeat(16385):mode==='invalid'?'{}':JSON.stringify(sample));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const fetcher=(url,options)=>{requested=url;return fetch(`http://127.0.0.1:${server.address().port}/metrics`,options);};
 try{
  assert.deepEqual(await readAccountRequests({fetcher}),sample);assert.equal(requested,'http://account:9092/metrics');
  for(mode of ['redirect','refused','large','invalid','stall'])await assert.rejects(readAccountRequests({fetcher,timeoutMs:30}),undefined,mode);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('local health transport aborts a stalled account response',async()=>{
 const server=createServer(()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await assert.rejects(localHealthFetch(new URL(`http://127.0.0.1:${server.address().port}/api/health/ready`),{signal:AbortSignal.timeout(30)}));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
