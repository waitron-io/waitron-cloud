import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
const module=await import('../src/account-action-proof-controller.ts').catch(()=>undefined);
test('fresh proof state refreshes after verification, shares a window and fences late account replies',async()=>{
  assert.equal(typeof module?.AccountActionProofController,'function','shared browser proof is missing');
  const calls:string[]=[];let verified=false;
  const request=async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);return {ok:true,value:(path==='/action-proof'?{methods:['email'],freshUntil:verified?new Date(Date.now()+600000).toISOString():null}:path==='/action-proof/email'?{challengeToken:'A'.repeat(43),expiresAt:new Date(Date.now()+300000).toISOString()}:undefined) as T};};
  const c=new module!.AccountActionProofController(()=>{},request);c.account('owner');await c.load();assert.equal(await c.ensure(),false);
  await c.email();assert.equal(c.challengeToken,'A'.repeat(43));c.code='123456';verified=true;await c.verify('email');
  assert.equal(c.code,'');assert.equal(c.challengeToken,undefined);assert.equal(await c.ensure(),true);assert.equal(await c.ensure(),true);
  assert.equal(calls.filter(p=>p==='/action-proof/email/verify').length,1);
  let release!:(value:ApiResult<unknown>)=>void;
  const late=new module!.AccountActionProofController(()=>{},()=>new Promise(resolve=>{release=resolve as typeof release;}));late.account('old');const work=late.load();late.account('new');release({ok:true,value:{methods:['passkey'],freshUntil:new Date(Date.now()+600000).toISOString()}});await work;assert.equal(late.status,undefined);
});

test('shared proof rejects malformed input locally and keeps retry delays across account changes',async()=>{
 assert.ok(module);let requests=0;
 const c=new module.AccountActionProofController(()=>{},async()=>{requests++;return {ok:false,status:429,code:'rate_limited',retryAfterMs:60000};});c.account('owner');
 c.code='12345';await c.verify('app');assert.equal(requests,0);assert.equal(c.error,'factorCodeInvalid');assert.equal(c.code,'12345');
 c.code='123456';await c.verify('app');assert.equal(requests,1);assert.equal(c.error,'limited');c.account('other');await c.load();assert.equal(requests,1);
});

test('an account change during post-proof refresh cannot repaint the new account',async()=>{
 assert.ok(module);let release!:(r:ApiResult<unknown>)=>void,entered!:()=>void,redraws=0;
 const started=new Promise<void>(r=>{entered=r;});
 const c=new module.AccountActionProofController(()=>{redraws++;},async<T>(path:string):Promise<ApiResult<T>>=>path==='/action-proof'?new Promise(r=>{release=r as typeof release;entered();}):{ok:true,value:undefined as T});
 c.account('old');c.code='123456';const work=c.verify('app');await started;c.account('new');const before=redraws;
 release({ok:true,value:{methods:['app'],freshUntil:new Date(Date.now()+600000).toISOString()}});await work;
 assert.equal(c.error,undefined);assert.equal(c.status,undefined);assert.equal(redraws,before);
});

test('authorisation begun for one account cannot borrow another account fresh window',async()=>{
 assert.ok(module);let release!:(r:ApiResult<unknown>)=>void,calls=0;
 const c=new module.AccountActionProofController(()=>{},async<T>():Promise<ApiResult<T>>=>++calls===1?new Promise(r=>{release=r as typeof release;}):{ok:true,value:{methods:['app'],freshUntil:new Date(Date.now()+600000).toISOString()} as T});
 c.account('old');const work=c.ensure();c.account('new');await c.load();release({ok:true,value:{methods:['app'],freshUntil:new Date(Date.now()+600000).toISOString()}});
 assert.equal(await work,false);
});
