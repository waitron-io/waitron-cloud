import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AuthenticatorController} from '../src/authenticator-controller.ts';
import type {ApiResult} from '../src/api.ts';
const token='A'.repeat(43),expiresAt='2030-01-01T00:00:00.000Z';
const actions=['completeLogin','begin','activate','remove','regenerate'] as const;
function fixture(reply:ApiResult<unknown>={ok:false,status:400,code:'invalid_input',retryAfterMs:0}){
 const calls:{path:string;body?:Record<string,unknown>}[]=[];
 const c=new AuthenticatorController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return (path==='/session'?{ok:true,value:{accountId:'owner',expiresAt}}:reply) as ApiResult<T>;});
 c.account('owner');c.status={active:true,version:1,recoveryCodesRemaining:10,available:true};c.password='current password';c.proofCode='123456';c.confirmation='654321';
 c.challenge={factorRequired:true,challengeToken:token,expiresAt};c.enrolment={pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt};
 return {c,calls};
}
for(const action of actions)for(const kind of ['totp','recovery'] as const)test(`${action} refuses malformed ${kind} proof locally and keeps entered input`,async()=>{
 for(const code of kind==='totp'?['12345','1234567','12345a']:['ABC','a'.repeat(31),'g'.repeat(32),'12345678-12345678-12345678-1234567']){
  const {c,calls}=fixture();c.proofKind=kind;c.proofCode=code;await c[action]();
  assert.deepEqual(calls,[]);assert.equal(c.error,'factorCodeInvalid');assert.equal(c.requiredField,'proof');assert.equal(c.proofCode,code);assert.equal(c.password,'current password');assert.equal(c.pending,false);
 }
});
for(const active of [false,true])test(`activation refuses malformed new-app code with active=${active}`,async()=>{
 for(const code of ['12345','1234567','12345a','ABCDEF01-23456789-ABCDEF01-23456789']){
  const {c,calls}=fixture();c.status!.active=active;c.confirmation=code;await c.activate();
  assert.deepEqual(calls,[]);assert.equal(c.error,'factorConfirmationInvalid');assert.equal(c.requiredField,'confirmation');assert.equal(c.confirmation,code);
 }
});
for(const action of actions)for(const code of ['aBcDeF0123456789aBcDeF0123456789','aBcDeF01-23456789-aBcDeF01-23456789'])test(`${action} sends accepted recovery format ${code.includes('-')?'grouped':'compact'}`,async()=>{
 const {c,calls}=fixture();c.proofKind='recovery';c.proofCode=code;await c[action]();
 assert.equal(calls.length,1);assert.deepEqual(calls[0]!.body!.proof,{kind:'recovery',code});
});
for(const action of actions)test(`${action} keeps general feedback for server invalid_input`,async()=>{
 const {c,calls}=fixture();await c[action]();assert.equal(calls.length,1);assert.equal(c.error,action==='completeLogin'?'factorUnavailable':'factorCheckSettings');assert.equal(c.requiredField,undefined);
});
for(const action of actions)for(const gate of ['pending','cooldown'] as const)test(`${action}: malformed input cannot replace feedback during ${gate}`,async()=>{
 const {c,calls}=fixture();c.error='limited';c.requiredField='password';c.pending=gate==='pending';c.retryAt=gate==='cooldown'?Date.now()+60000:0;c.proofCode='12345';
 await c[action]();assert.deepEqual(calls,[]);assert.equal(c.error,'limited');assert.equal(c.requiredField,'password');assert.equal(c.proofCode,'12345');
});
for(const action of actions)test(`${action}: well-formed wrong codes and outages retain existing feedback`,async()=>{
 for(const reply of [{ok:false,status:403,code:'credentials_invalid',retryAfterMs:0},{ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:0}] as const){
  const {c}=fixture(reply);await c[action]();assert.equal(c.error,reply.status===403?'credentials':action==='completeLogin'?'factorLoginUncertain':'factorChangeUncertain');assert.equal(c.requiredField,undefined);
 }
});
test('password-only setup keeps general feedback for server invalid_input',async()=>{
 const {c,calls}=fixture();c.status!.active=false;c.enrolment=undefined;c.password='p'.repeat(1025);c.proofCode='';
 await c.begin();assert.deepEqual(calls,[{path:'/authenticator/begin',body:{password:'p'.repeat(1025)}}]);assert.equal(c.error,'factorCheckSettings');assert.equal(c.requiredField,undefined);assert.equal(c.enrolment,undefined);
});
