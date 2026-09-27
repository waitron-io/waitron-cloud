import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import {requestAccountHealth} from './local-stack-compose.mjs';

test('account health probe connects over loopback with the configured authority',async()=>{
 let authority;
 const server=createServer((request,response)=>{authority=request.headers.host;response.end('{"status":"ready"}');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const address=server.address();assert(address&&typeof address==='object');
  await requestAccountHealth(address.port,'/api/health/ready');
  assert.equal(authority,'localhost:3000');
 }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('account health probe rejects a non-success response',async()=>{
 const server=createServer((_request,response)=>{response.statusCode=503;response.end('{"status":"unavailable"}');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const address=server.address();assert(address&&typeof address==='object');
  await assert.rejects(requestAccountHealth(address.port,'/api/health/ready'),/account health failed/);
 }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
