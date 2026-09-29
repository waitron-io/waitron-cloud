import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import {parseComposeServices,requestAccountHealth,stackReadiness} from './local-stack-compose.mjs';

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

test('Compose status parser accepts newline-delimited service records',()=>{
 const services=parseComposeServices('{"Service":"account","State":"running","Health":"healthy"}\n{"Service":"email-worker","State":"running","Health":""}\n');
 assert.deepEqual(services.map(({Service})=>Service),['account','email-worker']);
});

test('stack readiness separates healthy long-running services from successful jobs',()=>{
 const longRunning=['account','email-worker','gateway','gateway-manifest','mailpit','monitor-worker','postgres','remote-probe','storage','usage-reconciler'];
 const healthy=new Set(['account','gateway','mailpit','postgres','storage']);
 const services=longRunning.map(Service=>({Service,State:'running',Health:healthy.has(Service)?'healthy':'',ExitCode:0}));
 for(const Service of ['bootstrap','migrate'])services.push({Service,State:'exited',Health:'',ExitCode:0});
 assert.deepEqual(stackReadiness(services),{ready:true,failed:undefined});
 services.find(({Service})=>Service==='account').Health='starting';assert.equal(stackReadiness(services).ready,false);
 services.find(({Service})=>Service==='migrate').ExitCode=1;assert.equal(stackReadiness(services).failed,'migrate');
});

test('stack readiness refuses an exited usage worker even after a successful pass',()=>{
 const names=['account','email-worker','gateway','gateway-manifest','mailpit','monitor-worker','postgres','remote-probe','storage'];
 const services=names.map(Service=>({Service,State:'running',Health:'healthy'}));
 services.push({Service:'usage-reconciler',State:'exited',Health:''});
 assert.equal(stackReadiness(services).ready,false);
});

test('stack readiness requires successful bootstrap and migration, including already exited jobs',()=>{
 const names=['account','email-worker','gateway','gateway-manifest','mailpit','monitor-worker','postgres','remote-probe','storage','usage-reconciler'];
 const services=names.map(Service=>({Service,State:'running',Health:'healthy',ExitCode:0}));
 assert.equal(stackReadiness(services).ready,false);
 services.push({Service:'bootstrap',State:'exited',Health:'',ExitCode:0},{Service:'migrate',State:'running',Health:'',ExitCode:0});
 assert.equal(stackReadiness(services).ready,false);
 services.at(-1).State='exited';assert.equal(stackReadiness(services).ready,true);
 services.at(-1).ExitCode=1;assert.deepEqual(stackReadiness(services),{ready:false,failed:'migrate'});
});
