import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {localHealthFetch} from './operations-health.mjs';

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

test('local health transport aborts a stalled account response',async()=>{
 const server=createServer(()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await assert.rejects(localHealthFetch(new URL(`http://127.0.0.1:${server.address().port}/api/health/ready`),{signal:AbortSignal.timeout(30)}));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
