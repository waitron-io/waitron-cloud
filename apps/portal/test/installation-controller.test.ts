import {validInstallation} from '../src/installation-types.ts';
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

test('one organisation is visible at a time and account changes clear selection',async()=>{
 const otherId='22345678-1234-4234-8234-123456789abc';
 const items=[{...view,overview:{organisationName:'Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}},{...view,installationId:otherId,venueId:otherId,organisationId:otherId,overview:{organisationName:'Luna',businessName:'Luna SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}}];
 const c=new InstallationController(()=>{},async<T>()=>({ok:true,value:{installations:items} as T}));c.account('owner');await c.load();
 assert.equal(c.organisations.length,2);assert.equal(c.visible.length,1);
 c.selectOrganisation(otherId);assert.equal(c.visible[0]?.organisationId,otherId);
 c.choose(otherId);c.error='unavailable';c.selectOrganisation(id);assert.equal(c.confirming,undefined);assert.equal(c.error,'unavailable');
 c.selectOrganisation('unknown');assert.equal(c.visible[0]?.organisationId,id);
 c.account(undefined);assert.deepEqual(c.visible,[]);assert.equal(c.selectedOrganisation,undefined);
});

test('overview accepts database character limits for Unicode names',()=>{
 const item={...view,services:['remote_access','continuous_backup','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',observedAt:null})),overview:{organisationName:'☀️'.repeat(100),businessName:'🌞'.repeat(200),countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}};
 assert.equal(validInstallation(item),true);item.overview.businessName+='x';assert.equal(validInstallation(item),false);
});
