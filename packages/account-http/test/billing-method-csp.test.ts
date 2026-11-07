import assert from 'node:assert/strict';
import {test} from 'node:test';
import {portalResponse,portalErrorResponse} from '../src/portal.ts';
const assets=new Map([['/index.html',{body:Buffer.from('<!doctype html><title>Synthetic portal</title>'),contentType:'text/html'}],['/app.js',{body:Buffer.from('void 0'),contentType:'text/javascript'}]]);
const policy=(response:Response)=>response.headers.get('content-security-policy')!;
for(const enabled of [false,true])test(`portal method policy ${enabled?'enabled':'disabled'} applies to assets and every error`,()=>{
 const policies=[];
 for(const [path,method,status] of [['/account','GET',200],['/app.js','GET',200],['/account','HEAD',200],['/missing','GET',404],['/account?reference=forged','GET',400],['/account','POST',405]] as const){
  const response=portalResponse(new Request('http://localhost'+path,{method}),assets,enabled);assert.equal(response.status,status);policies.push(policy(response));
 }
 policies.push(policy(portalErrorResponse(new Request('http://localhost/account'),503,enabled)));
 for(const csp of policies){
  const directives=Object.fromEntries(csp.split(';').map(part=>part.trim().split(/\s+/)).map(([name,...values])=>[name,values]));
  assert.deepEqual(directives['form-action'],["'self'"]);assert.deepEqual(directives['frame-ancestors'],["'none'"]);assert.deepEqual(directives['object-src'],["'none'"]);assert.equal(csp.includes('*'),false);assert.equal(csp.includes('unsafe-eval'),false);
  assert.deepEqual(directives['script-src'],enabled?["'self'",'https://gateway.sumup.com']:["'self'"]);
  if(enabled){assert.ok(directives['frame-src']?.includes('https://gateway.sumup.com'));assert.ok(directives['connect-src']?.includes('https://api.sumup.com'));}
  else assert.equal(csp.includes('sumup.com'),false);
 }
 assert.equal(new Set(policies).size,1);
});

import {Pool} from 'pg';
import {EmailOutbox} from '@waitron-cloud/registration';
import {startAccountServer} from '../src/server.ts';
import {request} from 'node:http';
for(const enabled of [false,true])test(`the HTTP server propagates payment policy ${enabled} through document errors and host refusal`,async()=>{
 const pool=new Pool({connectionString:'postgres://synthetic@127.0.0.1:1/synthetic'});
 const running=await startAccountServer({pool,outbox:new EmailOutbox({activeKeyId:'test',keys:{test:'a'.repeat(64)}}),port:0,
  config:{portalOrigin:'http://localhost',production:false,rateKey:'b'.repeat(64),trustedProxyIps:[]},portalAssets:assets,planMode:'test-venue-levels',billingAccount:{accountIds:['11111111-1111-4111-8111-111111111111']},
  ...enabled?{billingMethods:{stripeAccount:'stripe-test:acct_synthetic',sumupAccount:'sumup-sandbox:MSYNTHETIC',client:{async start(){throw new Error('not called');},async verify(){throw new Error('not called');}}}}:{}});
 try{
  const address=running.server.address();assert.ok(address&&typeof address==='object');
  for(const [path,method,host,status] of [['/account','GET','localhost',200],['/app.js','GET','localhost',200],['/missing','GET','localhost',404],['/account?forged=x','GET','localhost',400],['/account','POST','localhost',405],['/account','GET','evil.example',403]] as const){
   const result=await new Promise<{status:number;policy:string}>((resolve,reject)=>{const req=request({host:'127.0.0.1',port:address.port,path,method,headers:{host}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!,policy:res.headers['content-security-policy'] as string}));});req.on('error',reject);req.end();});
   assert.equal(result.status,status);assert.equal(result.policy.includes('https://gateway.sumup.com'),enabled);
  }
 }finally{await running.close();await pool.end();}
});
