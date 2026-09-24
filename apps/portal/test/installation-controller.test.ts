import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InstallationController} from '../src/installation-controller.ts';
import type {ApiResult} from '../src/api.ts';
const id='12345678-1234-4234-8234-123456789abc';
const view={installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,services:[],canRevoke:true};
test('stop requires an offered owner action and explicit confirmation; a lost reply remains recoverable',async()=>{
 const calls:string[]=[];let lost=true;
 const c=new InstallationController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);return path.endsWith('/revoke')&&lost?{ok:false,status:0,code:'network_error',retryAfterMs:0}:{ok:true,value:(path.endsWith('/revoke')?{...view,revokedAt:new Date().toISOString()}:{installations:[view]}) as T};});
 c.account('owner');await c.load();await c.revoke();assert.equal(calls.length,1);c.choose('unknown');await c.revoke();assert.equal(calls.length,1);
 c.choose(id);await c.revoke();assert.equal(c.error,'stopUncertain');assert.equal(c.confirming,id);lost=false;await c.revoke();assert.ok(c.installations[0]?.revokedAt);assert.equal(c.confirming,undefined);
});
test('changing accounts fences delayed list and revoke responses and clears confirmation',async()=>{
 let finish!:(value:ApiResult<unknown>)=>void;
 const c=new InstallationController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));c.account('first');const p=c.load();c.account('second');finish({ok:true,value:{installations:[view]}});await p;assert.deepEqual(c.installations,[]);
 c.installations=[view];c.choose(id);const revoking=c.revoke();c.account(undefined);finish({ok:true,value:{...view,revokedAt:new Date().toISOString()}});await revoking;assert.deepEqual(c.installations,[]);assert.equal(c.confirming,undefined);
});
test('foreign replies and rate limits do not replace the selected installation or allow repeated writes',async()=>{
 let calls=0,limited=false;const c=new InstallationController(()=>{},async<T>():Promise<ApiResult<T>>=>{calls++;return limited?{ok:false,status:429,code:'rate_limited',retryAfterMs:60000}:{ok:true,value:{...view,installationId:'other',revokedAt:new Date().toISOString()} as T};});
 c.account('owner');c.installations=[view];c.choose(id);await c.revoke();assert.equal(c.error,'unavailable');assert.equal(c.installations[0]?.revokedAt,null);
 limited=true;await c.revoke();assert.equal(c.error,'limited');await c.revoke();assert.equal(calls,2);c.installations=[{...view,canRevoke:false}];c.choose(id);assert.equal(c.confirming,undefined);
});
