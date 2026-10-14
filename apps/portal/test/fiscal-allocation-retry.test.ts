import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fiscalHttpFixture} from '../../../packages/account-http/test/fiscal-http-fixture.ts';
import {FiscalAllocationError} from '../../../packages/fiscal-allocation/src/types.ts';
import {FiscalAllocationController} from '../src/fiscal-allocation-controller.ts';
import type {ApiResult} from '../src/api.ts';

test('a corrected refused reservation reaches the real server with a fresh operation',async()=>{
 const s=await fiscalHttpFixture();try{
  const original=s.options.continuity!;let fail=true;
  const port=await s.server({...s.options,continuity:{...original,async fence(scope,nonce){if(fail){fail=false;throw new FiscalAllocationError('continuity_unavailable');}return original.fence(scope,nonce);}}});
  const c=new FiscalAllocationController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{const response=await s.request(path.split('/').at(-1)!,body,{port}),value=await response.json();return response.ok?{ok:true,value}:{ok:false,status:response.status,code:value.error,retryAfterMs:0};});
  c.account(s.v.account);c.open(s.v.id);c.choose(s.v.input);await c.reserve(s.v.input);assert.equal(c.error,'fiscalContinuity');
  c.choose({...s.v.input,binding:{...s.v.input.binding,operatorId:'corrected-operator'}});await c.reserve(c.selection!);assert.equal(c.error,undefined);assert.equal(c.receipt?.payload.state,'reserved');assert.equal(c.receipt?.payload.binding.operatorId,'corrected-operator');assert.notEqual((c.receipt?.payload.allocation.reservationEvidence as {reservationId:string}).reservationId,s.v.input.operationId);
 }finally{await s.close();}
});
test('an untrusted response can follow an outside committed name and must retain its pending operation',async()=>{
 const s=await fiscalHttpFixture();try{
  const original=s.options.continuity!,trust=s.options.trust!,keys=new Map(trust.keys);
  const port=await s.server({...s.options,trust:{...trust,keys},continuity:{...original,async claim(input){const result=await original.claim(input);keys.clear();return result;}}});
  const c=new FiscalAllocationController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{const response=await s.request(path.split('/').at(-1)!,body,{port}),value=await response.json();return response.ok?{ok:true,value}:{ok:false,status:response.status,code:value.error,retryAfterMs:0};});
  c.account(s.v.account);c.open(s.v.id);c.choose(s.v.input);await c.reserve(s.v.input);assert(c.uncertain);assert.equal(c.pendingRequest?.input.operationId,s.v.input.operationId);
  const history=await s.a.request('history',{scope:s.v.input.scope,afterSequence:'0',nonce:'actual-commit'});assert.equal(history.events.length,1);assert.equal(history.events[0].receipt.payload.allocation.installationIdentity,'C000001');assert.equal((await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_allocations')).rows[0].n,0);
  for(const [id,value] of trust.keys)keys.set(id,value);await c.reconcile();assert.equal(c.uncertain,false);assert.equal(c.receipt?.payload.allocation.installationIdentity,'C000001');assert.equal((await s.a.request('history',{scope:s.v.input.scope,afterSequence:'0',nonce:'same-result'})).events.length,1);
 }finally{await s.close();}
});
test('another current venue owner can read an earlier receipt and consume with their own account',async()=>{
 const s=await fiscalHttpFixture();try{
  const r=await (await s.request('reserve',s.v.input)).json();const other=await s.venue();await s.f.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[other.account,s.v.organisation]);
  const c=new FiscalAllocationController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{const response=await s.request(path.split('/').at(-1)!,body,{headers:{cookie:'cloud_session='+other.session.token,'x-csrf-token':other.session.csrfToken}}),value=await response.json();return response.ok?{ok:true,value}:{ok:false,status:response.status,code:value.error,retryAfterMs:0};});
  c.account(other.account);c.open(s.v.id);await c.load(null);assert.equal(c.page?.items[0]?.payload.cloudAccountId,s.v.account);c.inspect(r);c.oldMachineOffline=true;c.noParallelRecovery=true;
  await c.consume({version:1,operationId:crypto.randomUUID(),allocationId:r.payload.allocation.allocationId,binding:s.v.input.binding,oldMachineOffline:true,oldMachineAbsent:false,noParallelRecovery:true,confirmedAt:new Date().toISOString()});assert.equal(c.error,undefined);assert.equal(c.receipt?.payload.state,'consumed');assert.equal(c.receipt?.payload.cloudAccountId,other.account);assert(c.packet);
 }finally{await s.close();}
});
