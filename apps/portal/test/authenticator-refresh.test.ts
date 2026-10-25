import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AuthenticatorController} from '../src/authenticator-controller.ts';
import type {ApiResult} from '../src/api.ts';
const token='A'.repeat(43),expiresAt='2030-01-01T00:00:00.000Z';
const enrolled={pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt};
const active={active:true,version:1,recoveryCodesRemaining:10,available:true};
function fixture(replies:ApiResult<unknown>[]){
 const calls:{path:string;body?:Record<string,unknown>}[]=[];
 const c=new AuthenticatorController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});assert.ok(replies.length,'unexpected request');return replies.shift()! as ApiResult<T>;
 });
 c.account('owner');c.loaded=true;c.status=active;c.enrolment=enrolled;
 c.password='password';c.proofCode='123456';c.confirmation='654321';return {c,calls};
}
// Losing the management/refusal distinction would send setup-state refusals back to outage feedback.
for(const action of ['begin','activate','remove','regenerate','cancel'] as const)test(`${action}: a general refusal offers a status check without blaming a code field`,async()=>{
 const {c,calls}=fixture([{ok:false,status:400,code:'invalid_input',retryAfterMs:0}]);
 await c[action]();assert.equal(c.error,'factorCheckSettings');assert.equal(c.requiredField,undefined);
 assert.equal(calls.length,1);assert.equal(calls[0]!.path,`/authenticator/${action}`);
});
for(const nowActive of [false,true])test(`refresh discards stale setup and reads active=${nowActive} before accepting fresh authority`,async()=>{
 const status={active:nowActive,version:2,recoveryCodesRemaining:nowActive?8:0,available:true};
 const {c,calls}=fixture([{ok:true,value:status},{ok:true,value:enrolled}]);
 await c.refresh();assert.deepEqual(calls,[{path:'/authenticator',body:undefined}]);
 assert.deepEqual(c.status,status);assert.equal(c.loaded,true);assert.equal(c.enrolment,undefined);
 assert.equal(c.password,'');assert.equal(c.proofCode,'');assert.equal(c.confirmation,'');
 await c.begin();assert.equal(c.error,'requiredPassword');assert.equal(calls.length,1);
 c.password='fresh password';
 if(nowActive){await c.begin();assert.equal(c.error,'factorCodeRequired');assert.equal(calls.length,1);c.proofCode='234567';}
 await c.begin();assert.deepEqual(calls[1],{path:'/authenticator/begin',body:{password:'fresh password',...(nowActive?{proof:{kind:'totp',code:'234567'}}:{})}});
 assert.equal(c.enrolment,enrolled);
});
test('refresh failure removes stale controls and leaves status retry available',async()=>{
 const {c,calls}=fixture([{ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:0},{ok:true,value:active}]);
 await c.refresh();assert.equal(c.status,undefined);assert.equal(c.enrolment,undefined);assert.equal(c.loaded,false);assert.equal(c.error,'factorUnavailable');
 await c.load();assert.deepEqual(c.status,active);assert.equal(c.loaded,true);assert.equal(calls.length,2);
});
for(const gate of ['pending','cooldown','anonymous'] as const)test(`refresh respects ${gate} without dropping local setup`,async()=>{
 const {c,calls}=fixture([]);if(gate==='anonymous')c.account(undefined);else if(gate==='pending')c.pending=true;else c.retryAt=Date.now()+60000;
 const before={status:c.status,enrolment:c.enrolment,password:c.password};await c.refresh();assert.deepEqual(calls,[]);
 assert.deepEqual({status:c.status,enrolment:c.enrolment,password:c.password},before);
});
test('an account change fences an in-flight refresh',async()=>{
 let resolve!:(r:ApiResult<unknown>)=>void;
 const c=new AuthenticatorController(()=>{},async<T>():Promise<ApiResult<T>>=>new Promise(r=>{resolve=r as typeof resolve;}));
 c.account('owner');c.status=active;c.enrolment=enrolled;const pending=c.refresh();
 assert.equal(c.pending,true);assert.equal(c.status,undefined);assert.equal(c.enrolment,undefined);
 c.account('other');resolve({ok:true,value:active});await pending;assert.equal(c.status,undefined);assert.equal(c.loaded,false);assert.equal(c.pending,false);
});
