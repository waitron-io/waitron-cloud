import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AuthenticatorController} from '../src/authenticator-controller.ts';
import type {ApiResult} from '../src/api.ts';
const module = await import('../src/authenticator-controller.ts').catch(() => null);
const token='A'.repeat(43), expiresAt='2030-01-01T00:00:00.000Z';
const status={active:true,version:1,recoveryCodesRemaining:10,available:true};
const codes=Array.from({length:10},(_,i)=>i.toString(16).padStart(32,'0').toUpperCase());
const changed={status:'changed',active:true,recoveryCodes:codes};
function controller(replies: ApiResult<unknown>[], calls: {path:string;body:unknown}[] = []) {
  assert.ok(module?.AuthenticatorController,'authenticator controller is available');
  return new module.AuthenticatorController(()=>{},async <T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
    calls.push({path,body});assert.ok(replies.length,'unexpected request');return replies.shift()! as ApiResult<T>;
  });
}
const ok=(value:unknown):ApiResult<unknown>=>({ok:true,value});
const lost:ApiResult<unknown>={ok:false,status:0,code:'network_error',retryAfterMs:0};
const enrolment={pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt};
for(const kind of ['totp','recovery'] as const)for(const action of ['completeLogin','begin','activate','remove','regenerate'] as const){
  test(`${action} removes whitespace from ${kind} proof and preserves recovery hyphens`,async()=>{
    const calls:{path:string;body:unknown}[]=[];
    const c=controller([ok(action==='completeLogin'?{accountId:'owner'}:action==='begin'?enrolment:changed)],calls);
    c.account('owner');c.status=status;c.challenge={factorRequired:true,challengeToken:token,expiresAt};c.enrolment=enrolment;
    c.password=' current password ';c.proofKind=kind;
    c.proofCode=kind==='totp'?' \t123\u00a0456\n ':' ABCDEF01- 23456789-\tABCDEF01-23456789\n';c.confirmation=' \t654 321\n';
    await c[action]();
    const proof={kind,code:kind==='totp'?'123456':'ABCDEF01-23456789-ABCDEF01-23456789'};
    assert.deepEqual(calls,[{path:action==='completeLogin'?'/login/factor':`/authenticator/${action}`,body:action==='completeLogin'
      ?{challengeToken:token,proof}:{password:' current password ',proof,...(action==='activate'?{pendingToken:token,code:'654321'}:{})}}]);
    assert.equal(c.proofCode,'');assert.equal(c.confirmation,'');assert.equal(c.password,'');
  });
  test(`${action} keeps state and sends nothing for whitespace-only ${kind} proof`,async()=>{
    const calls:{path:string;body:unknown}[]=[];const c=controller([ok(changed)],calls);
    c.account('owner');c.status=status;c.challenge={factorRequired:true,challengeToken:token,expiresAt};c.enrolment=enrolment;
    c.password='current';c.proofKind=kind;c.proofCode=' \t\u00a0\n ';c.confirmation='654321';
    assert.equal(await c[action](),action==='begin'?undefined:false);
    assert.deepEqual(calls,[]);assert.equal(c.pending,false);assert.equal(c.challenge?.challengeToken,token);
    assert.equal(c.enrolment,enrolment);assert.equal(c.password,'current');assert.equal(c.confirmation,'654321');
  });
}
for(const active of [false,true])test(`activation sends nothing for blank confirmation with active factor ${active}`,async()=>{
  const calls:{path:string;body:unknown}[]=[];const c=controller([ok(changed)],calls);
  c.account('owner');c.status={...status,active};c.enrolment=enrolment;c.password='current';c.proofCode='123456';c.confirmation=' \t\u00a0\n ';
  assert.equal(await c.activate(),false);assert.deepEqual(calls,[]);assert.equal(c.pending,false);assert.equal(c.enrolment,enrolment);
});
test('first enrolment and activation need no existing-factor proof',async()=>{
  const calls:{path:string;body:unknown}[]=[];const c=controller([ok(enrolment),ok(changed)],calls);
  c.account('owner');c.status={...status,active:false};c.password='current';await c.begin();
  c.password='current';c.confirmation=' 654 321 ';await c.activate();
  assert.deepEqual(calls,[{path:'/authenticator/begin',body:{password:'current'}},
    {path:'/authenticator/activate',body:{password:'current',pendingToken:token,code:'654321'}}]);
});
test('password second step stays in memory and failed completion is never automatically retried',async()=>{
  const calls:{path:string;body:unknown}[]=[];const c=controller([ok({factorRequired:true,challengeToken:token,expiresAt}),lost],calls);
  assert.equal(await c.startLogin('owner@example.test','password'),'factor');assert.equal(c.challenge?.challengeToken,token);
  c.proofCode=codes[0]!;c.proofKind='recovery';
  assert.equal(await c.completeLogin(),'reconcile');assert.equal(c.challenge,undefined);assert.equal(c.proofCode,'');
  assert.equal(await c.completeLogin(),false);assert.equal(calls.length,2);
  assert.deepEqual(calls[1],{path:'/login/factor',body:{challengeToken:token,proof:{kind:'recovery',code:codes[0]}}});
});
test('full login success, explicit refusals and Retry-After remain distinct',async()=>{
  const c=controller([ok({accountId:'owner'}),{ok:false,status:429,code:'rate_limited',retryAfterMs:60_000}]);
  assert.equal(await c.startLogin('owner@example.test','password'),'authenticated');
  assert.equal(await c.startLogin('owner@example.test','password'),false);assert.equal(c.error,'limited');
  assert.ok(c.retryAt>Date.now()+59_000);assert.equal(await c.startLogin('owner@example.test','password'),false);
});
test('management reply remains available to the caller after self-revocation fences account state',async()=>{
  const c=controller([ok(status),ok({pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Waitron%20Cloud:owner?secret=JBSWY3DPEHPK3PXP&issuer=Waitron%20Cloud',expiresAt}),ok(changed)]);
  c.account('owner');await c.load();c.password='current';c.proofKind='recovery';c.proofCode=codes[1]!;await c.begin();
  assert.ok(c.enrolment);assert.equal(c.password,'');assert.equal(c.proofCode,'');
  c.password='current';c.proofCode=codes[2]!;c.confirmation='123456';const reply=await c.activate();
  assert.deepEqual(reply,changed);c.account(undefined);assert.deepEqual(reply,changed);
  assert.equal(c.enrolment,undefined);assert.equal(c.password,'');assert.equal(c.confirmation,'');assert.equal(c.status,undefined);
});
test('lost management reply clears authority and requires sign-in and status reconciliation',async()=>{
  const calls:{path:string;body:unknown}[]=[];const c=controller([ok(status),lost],calls);
  c.account('owner');await c.load();c.password='current';c.proofCode='123456';
  assert.equal(await c.regenerate(),'reconcile');assert.equal(c.error,'factorChangeUncertain');
  assert.equal(c.password,'');assert.equal(c.proofCode,'');assert.equal(await c.regenerate(),false);assert.equal(calls.length,2);
});
test('fencing cancels stale login, status and enrolment replies and clears all temporary input',async()=>{
  assert.ok(module?.AuthenticatorController,'authenticator controller is available');
  for(const operation of ['startLogin','load','begin'] as const){
    let resolve!:(value:ApiResult<unknown>)=>void;const c=new module.AuthenticatorController(()=>{},async<T>():Promise<ApiResult<T>>=>new Promise(r=>{resolve=r as typeof resolve;}));
    c.account('owner');c.password='secret';c.proofCode='123456';c.confirmation='654321';
    const pending=operation==='startLogin'?c.startLogin('owner@example.test','secret'):c[operation]();
    c.fence();resolve(ok(operation==='load'?status:operation==='begin'?{pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt}:{factorRequired:true,challengeToken:token,expiresAt}));await pending;
    assert.equal(c.challenge,undefined);assert.equal(c.enrolment,undefined);assert.equal(c.status,undefined);assert.equal(c.password,'');assert.equal(c.proofCode,'');assert.equal(c.confirmation,'');assert.equal(c.pending,false);
  }
});
test('cancel, removal and regeneration send fresh authority and erase pending state',async()=>{
  const calls:{path:string;body:unknown}[]=[];const enrolment={pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt};
  const c=controller([ok(status),ok(enrolment),ok(undefined),ok(changed),ok({status:'changed',active:false})],calls);
  c.account('owner');await c.load();c.password='current';c.proofCode='123456';await c.begin();await c.cancel();
  assert.equal(c.enrolment,undefined);assert.deepEqual(calls[2],{path:'/authenticator/cancel',body:{pendingToken:token}});
  c.password='fresh';c.proofKind='recovery';c.proofCode=codes[0]!;assert.deepEqual(await c.regenerate(),changed);
  assert.deepEqual(calls[3],{path:'/authenticator/regenerate',body:{password:'fresh',proof:{kind:'recovery',code:codes[0]}}});
  c.account('owner');c.status=status;c.password='fresh';c.proofCode=codes[1]!;
  assert.deepEqual(await c.remove(),{status:'changed',active:false});assert.equal(c.password,'');
});

test('a browser replay refusal after a lost committed management reply reconciles the ended session',async()=>{
  const calls:{path:string;body:unknown}[]=[];const c=controller([ok(status),{ok:false,status:403,code:'credentials_invalid',retryAfterMs:0},{ok:false,status:401,code:'unauthenticated',retryAfterMs:0}],calls);
  c.account('owner');await c.load();c.password='current';c.proofCode='123456';
  assert.equal(await c.regenerate(),'reconcile');assert.equal(c.error,'factorChangeUncertain');assert.deepEqual(calls.map(v=>v.path),['/authenticator','/authenticator/regenerate','/session']);
});
test('a refused management proof keeps a confirmed live account and never repeats the write',async()=>{
  const calls:{path:string;body:unknown}[]=[];const c=controller([ok(status),{ok:false,status:403,code:'credentials_invalid',retryAfterMs:0},ok({accountId:'owner',expiresAt})],calls);
  c.account('owner');await c.load();c.password='current';c.proofCode='123456';assert.equal(await c.remove(),false);assert.equal(c.error,'credentials');
  assert.deepEqual(calls.map(v=>v.path),['/authenticator','/authenticator/remove','/session']);
});
test('completion refusals also reconcile cookies without reusing consumed proof',async()=>{
  const c=controller([ok({factorRequired:true,challengeToken:token,expiresAt}),{ok:false,status:401,code:'credentials_invalid',retryAfterMs:0}]);
  await c.startLogin('owner@example.test','password');c.proofCode='123456';assert.equal(await c.completeLogin(),'reconcile');assert.equal(c.challenge,undefined);assert.equal(c.error,'credentials');
});

test('fencing also refuses delayed completions, active changes, cancellation and session reconciliation',async()=>{
  assert.ok(module?.AuthenticatorController,'authenticator controller is available');
  for(const operation of ['completeLogin','activate','remove','regenerate','cancel'] as const){
    let resolve!:(value:ApiResult<unknown>)=>void,changedCalls=0;const c:AuthenticatorController=new module.AuthenticatorController(()=>{changedCalls++;},async<T>():Promise<ApiResult<T>>=>new Promise(r=>{resolve=r as typeof resolve;}));
    c.account('owner');c.status=status;c.password='current';c.proofCode='123456';c.confirmation='654321';
    c.challenge={factorRequired:true,challengeToken:token,expiresAt};c.enrolment={pendingToken:token,secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP',expiresAt};
    const pending=c[operation]();c.fence();resolve(ok(operation==='completeLogin'?{accountId:'owner'}:operation==='cancel'?undefined:operation==='remove'?{status:'changed',active:false}:changed));
    const result=await pending;assert.equal(result,operation==='cancel'?undefined:false);assert.equal(c.challenge,undefined);assert.equal(c.enrolment,undefined);assert.equal(c.status,undefined);assert.equal(changedCalls,1,'stale responses cannot repaint the new view');
  }
  let resolve!:(value:ApiResult<unknown>)=>void;let calls=0;
  const c=new module.AuthenticatorController(()=>{},async<T>():Promise<ApiResult<T>>=>{
    if(calls++===0)return {ok:false,status:403,code:'credentials_invalid',retryAfterMs:0};
    return new Promise(r=>{resolve=r as typeof resolve;});
  });c.account('owner');c.status=status;c.password='current';c.proofCode='123456';const pending=c.regenerate();
  await new Promise(r=>setImmediate(r));c.fence();resolve({ok:false,status:401,code:'unauthenticated',retryAfterMs:0});assert.equal(await pending,false);assert.equal(c.error,undefined);
});

test('sign-in invalid input is a validation refusal rather than a service outage',async()=>{
  let redraws=0;
  const c=new module!.AuthenticatorController(()=>{redraws++;},async()=>({ok:false,status:400,code:'invalid_input',retryAfterMs:0}));
  assert.equal(await c.startLogin('ana..garcia@example.com','secret'),false);
  assert.equal(c.error,'invalid');assert.equal(c.pending,false);assert.equal(redraws,2);
});
