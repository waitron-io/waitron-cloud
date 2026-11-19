import {validInstallation} from '../src/installation-types.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InstallationController} from '../src/installation-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {AccountInstallation} from '../src/installation-types.ts';
const id='12345678-1234-4234-8234-123456789abc';
const view={installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,services:[],canRevoke:true};
test('stop requires an offered owner action and explicit confirmation; a lost reply remains recoverable',async()=>{
 const calls:string[]=[];let lost=true;
 const c=new InstallationController(()=>{},async<T>(path:string):Promise<ApiResult<T>>=>{calls.push(path);return path.endsWith('/remove')&&lost?{ok:false,status:0,code:'network_error',retryAfterMs:0}:{ok:true,value:(path.endsWith('/remove')?{...view,revokedAt:new Date().toISOString(),portalRemovedAt:new Date().toISOString()}:{installations:[view]}) as T};});
 c.account('owner');await c.load();await c.remove();assert.equal(calls.length,1);c.choose('unknown');await c.remove();assert.equal(calls.length,1);
 c.choose(id);await c.remove();assert.equal(c.error,'removeUncertain');assert.equal(c.confirming,id);lost=false;await c.remove();assert.ok(c.installations[0]?.revokedAt);assert.equal(c.confirming,undefined);
});
test('changing accounts fences delayed list and revoke responses and clears confirmation',async()=>{
 let finish!:(value:ApiResult<unknown>)=>void;
 const c=new InstallationController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));c.account('first');const p=c.load();c.account('second');finish({ok:true,value:{installations:[view]}});await p;assert.deepEqual(c.installations,[]);
 c.installations=[view];c.choose(id);const revoking=c.remove();c.account(undefined);finish({ok:true,value:{...view,revokedAt:new Date().toISOString(),portalRemovedAt:new Date().toISOString()}});await revoking;assert.deepEqual(c.installations,[]);assert.equal(c.confirming,undefined);
});
test('foreign replies and rate limits do not replace the selected installation or allow repeated writes',async()=>{
 let calls=0,limited=false;const c=new InstallationController(()=>{},async<T>():Promise<ApiResult<T>>=>{calls++;return limited?{ok:false,status:429,code:'rate_limited',retryAfterMs:60000}:{ok:true,value:{...view,installationId:'other',revokedAt:new Date().toISOString(),portalRemovedAt:new Date().toISOString()} as T};});
 c.account('owner');c.installations=[view];c.choose(id);await c.remove();assert.equal(c.error,'unavailable');assert.equal(c.installations[0]?.revokedAt,null);
 limited=true;await c.remove();assert.equal(c.error,'limited');await c.remove();assert.equal(calls,2);c.installations=[{...view,canRevoke:false}];c.choose(id);assert.equal(c.confirming,undefined);
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

test('Recovery still offers the venue after other portal pages hide it',async()=>{
 const stamp='2026-10-24T00:00:00.000Z',removed={...view,revokedAt:stamp,portalRemovedAt:stamp};
 const c=new InstallationController(()=>{},async<T>()=>({ok:true,value:{installations:[removed]} as T}));
 c.account('owner');await c.load();
 assert.deepEqual(c.visible,[]);assert.deepEqual(c.organisations,[]);
 c.showRecovery(true);
 assert.deepEqual(c.visible,[removed]);assert.equal(c.selectedOrganisation,id);
 c.showRecovery(false);
 assert.deepEqual(c.visible,[]);assert.equal(c.selectedOrganisation,undefined);
});

test('an explicit Venues organisation choice replaces the remembered Recovery choice',async()=>{
 const second='22345678-1234-4234-8234-123456789abc',third='32345678-1234-4234-8234-123456789abc';
 const stamp='2026-10-24T00:00:00.000Z';
 const rows=[{...view,revokedAt:stamp,portalRemovedAt:stamp},
  {...view,organisationId:second,installationId:second},{...view,organisationId:third,installationId:third}];
 const controller=new InstallationController(()=>{},async<T>()=>({ok:true,value:{installations:rows} as T}));
 controller.account('owner');await controller.load();
 controller.showRecovery(true);controller.selectOrganisation(id);
 controller.showRecovery(false);controller.selectOrganisation(third);
 controller.showRecovery(true);
 assert.equal(controller.selectedOrganisation,third);
});

test('overview accepts database character limits for Unicode names',()=>{
 const item={...view,services:['remote_access','continuous_backup','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',observedAt:null})),overview:{organisationName:'☀️'.repeat(100),businessName:'🌞'.repeat(200),countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null}};
 assert.equal(validInstallation(item),true);item.overview.businessName+='x';assert.equal(validInstallation(item),false);
});

test('remote monitoring accepts only redacted route evidence and known incidents',()=>{
 const checkedAt='2026-09-25T12:00:00.000Z',certificateNotAfter='2026-10-01T12:00:00.000Z';
 const item={...view,services:['remote_access','continuous_backup','retained_snapshots'].map(service=>({service,state:'ready',health:'healthy',observedAt:checkedAt})),monitoring:{enabled:true,fresh:true,checkedAt,incidents:[
  {kind:'public_route_failed',openedAt:checkedAt,changedAt:checkedAt},{kind:'staff_probe_stale',openedAt:checkedAt,changedAt:checkedAt},
 ],remoteChecks:{public:{status:'failed',checkedAt,certificateNotAfter},staff:{status:'healthy',checkedAt,certificateNotAfter:null}}}};
 assert.equal(validInstallation(item),true);
 assert.equal(validInstallation({...item,monitoring:{...item.monitoring,remoteChecks:undefined}}),true);
 assert.equal(validInstallation({...item,monitoring:{...item.monitoring,remoteChecks:{public:item.monitoring.remoteChecks.public}}}),false);
 for(const remoteChecks of [
  {...item.monitoring.remoteChecks,public:{...item.monitoring.remoteChecks.public,status:'degraded'}},
  {...item.monitoring.remoteChecks,public:{...item.monitoring.remoteChecks.public,checkedAt:'yesterday'}},
  {...item.monitoring.remoteChecks,public:{...item.monitoring.remoteChecks.public,failure:'timeout'}},
 ])assert.equal(validInstallation({...item,monitoring:{...item.monitoring,remoteChecks}}),false);
 assert.equal(validInstallation({...item,monitoring:{...item.monitoring,incidents:[{kind:'remote_failed',openedAt:checkedAt,changedAt:checkedAt}]}}),false);
});

for(const change of ['permission','organisation','fallback','missing','removed','unchanged'] as const)test(`refresh ${change}: stop confirmation belongs to the still offered installation and organisation`,async()=>{
 const other='22345678-1234-4234-8234-123456789abc';
 let items:AccountInstallation[]=[view];const writes:unknown[]=[];
 const c=new InstallationController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  if(body)writes.push(body);
  return {ok:true,value:(path.endsWith('/remove')?{...view,revokedAt:'2026-10-24T00:00:00.000Z',portalRemovedAt:'2026-10-24T00:00:00.000Z'}:{installations:items}) as T};
 });
 c.account('owner');await c.load();c.choose(id);assert.equal(c.confirming,id);
 items=change==='permission'?[{...view,canRevoke:false}]:change==='organisation'?[{...view,organisationId:other},{...view,installationId:other,venueId:other}]:change==='fallback'?[{...view,organisationId:other}]:change==='missing'?[]:change==='removed'?[{...view,revokedAt:'2026-10-24T00:00:00.000Z',portalRemovedAt:'2026-10-24T00:00:00.000Z'}]:[view];
 await c.load();
 assert.equal(c.selectedOrganisation,['removed','missing'].includes(change)?undefined:change==='fallback'?other:id);
 assert.equal(c.confirming,change==='unchanged'?id:undefined);
 await c.remove();assert.deepEqual(writes,change==='unchanged'?[{installationId:id}]:[]);
});

for(const [status,cause] of [[408,'Interrupted'],[413,'Size'],[415,'Format']] as const)test(`installation revoke body refusal ${status} retains confirmation`,async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];
 const c=new InstallationController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,body});return {ok:false,status,code:'invalid_input',retryAfterMs:0};
 });
 c.account('owner');c.installations=[view];c.choose(id);await c.remove();
 assert.equal(c.error,`installationsRequest${cause}`);assert.equal(c.pending,false);assert.equal(c.confirming,id);assert.equal(c.installations[0]?.revokedAt,null);
 assert.deepEqual(calls,[{path:'/installations/remove',body:{installationId:id}}]);
});

for(const kind of ['public_certificate_expiring','staff_certificate_expiring'])test('an installation reply naming '+kind+' is refused',()=>{
 const checkedAt='2026-11-01T12:00:00.000Z';
 const item={...view,services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'ready',health:'healthy',failure:null,observedAt:checkedAt})),monitoring:{enabled:true,fresh:true,checkedAt,incidents:[]}};assert.equal(validInstallation(item),true);
 assert.equal(validInstallation({...item,monitoring:{...item.monitoring,incidents:[{kind,openedAt:checkedAt,changedAt:checkedAt}]}}),false);
});
