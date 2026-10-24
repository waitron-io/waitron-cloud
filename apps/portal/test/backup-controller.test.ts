import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BackupController} from '../src/backup-controller.ts';
import {validBackupPage} from '../src/backup-types.ts';
import type {ApiResult} from '../src/api.ts';
const venue='12345678-1234-4234-8234-123456789abc',other='22345678-1234-4234-8234-123456789abc';
const point={id:venue,capturedAt:'2026-01-01T12:00:00.000Z',expiresAt:'2026-01-31T12:00:00.000Z',retention:'daily',verification:'verified',protection:'fallback'};
const continuous={recoverableAt:'2026-01-02T12:00:00.000Z',checkedAt:'2026-01-02T12:00:30.000Z',sourceNodeId:other};
const page={venueId:venue,points:[point],nextCursor:'next',defaultPointId:venue,continuousRecovery:continuous};
test('catalogue validates bounded public metadata and refuses malformed success responses',()=>{
 assert.equal(validBackupPage(page),true);
 for(const patch of [{points:Array(51).fill(point)},{points:[{...point,verification:'uploaded'}]},{points:[{...point,expiresAt:'bad'}]},{venueId:'bad'},
  {continuousRecovery:{...continuous,checkedAt:'bad'}},{continuousRecovery:{...continuous,sourceNodeId:'bad'}},{continuousRecovery:{...continuous,bucket:'secret'}}])assert.equal(validBackupPage({...page,...patch}),false);
 assert.equal(validBackupPage({...page,continuousRecovery:null}),true);
 assert.equal(validBackupPage({...page,readerCredentials:{accessKeyId:'secret'}}),false);
});
test('changing account or venue fences delayed catalogue replies and clears private data',async()=>{
 let finish!:(result:ApiResult<unknown>)=>void;
 const c=new BackupController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));c.account('owner');const loading=c.open(venue);c.close();finish({ok:true,value:page});await loading;assert.equal(c.page,undefined);
 const first=c.open(venue);c.account('different');finish({ok:true,value:page});await first;assert.equal(c.venueId,undefined);assert.equal(c.page,undefined);
 const second=c.open(other);finish({ok:true,value:page});await second;assert.equal(c.page,undefined);assert.equal(c.error,'unavailable');
});
test('pagination replaces the page; failures retain it and Retry-After survives reopening',async()=>{
 const calls:unknown[]=[];let mode='first';
 const c=new BackupController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return mode==='limited'?{ok:false,status:429,code:'rate_limited',retryAfterMs:60000}:mode==='failed'?{ok:false,status:503,code:'temporarily_unavailable',retryAfterMs:0}:{ok:true,value:(mode==='first'?page:{...page,points:[{...point,id:other}],nextCursor:null}) as T};});
 c.account('owner');await c.open(venue);assert.equal(c.selectedSource,'continuous');assert.equal(c.selected,venue);c.select('not-offered');assert.equal(c.selectedSource,'continuous');
 c.select(venue);assert.equal(c.selectedSource,'snapshot');
 mode='failed';await c.load(true);assert.equal(c.page?.points[0]?.id,venue);assert.equal(c.error,'unavailable');
 mode='second';await c.load(true);assert.equal(c.page?.points.length,1);assert.equal(c.page?.points[0]?.id,other);assert.equal(c.selectedSource,'snapshot');assert.deepEqual(calls.at(-1),{path:'/backups/list',body:{venueId:venue,cursor:'next'}});
 mode='limited';await c.load();assert.equal(c.error,'limited');c.close();await c.open(venue);assert.equal(calls.length,4);assert(c.waiting>0);
});

for(const {name,points,defaultPointId,expected} of [
 {name:'the next page default',points:[{...point,id:other},point],defaultPointId:other,expected:venue},
 {name:'a new page default',points:[{...point,id:other},{...point,id:'32345678-1234-4234-8234-123456789abc'}],defaultPointId:'32345678-1234-4234-8234-123456789abc',expected:'32345678-1234-4234-8234-123456789abc'},
 {name:'the first point without a page default',points:[{...point,id:other}],defaultPointId:null,expected:other},
])test(`loading older snapshots keeps a snapshot choice over ${name}`,async()=>{
 let older=false;
 const c=new BackupController(()=>{},async<T>():Promise<ApiResult<T>>=>({ok:true,value:(older?{...page,points,defaultPointId,nextCursor:null}:page) as T}));
 c.account('owner');await c.open(venue);assert.equal(c.selectedSource,'continuous');c.select(venue);
 older=true;await c.load(true);
 assert.equal(c.selectedSource,'snapshot');assert.equal(c.selected,expected);assert.ok(c.page?.points.some(p=>p.id===c.selected));
});

for(const stream of [continuous,null])test(`an empty older page clears a snapshot choice with ${stream?'continuous recovery':'no continuous recovery'}`,async()=>{
 let older=false;
 const c=new BackupController(()=>{},async<T>():Promise<ApiResult<T>>=>({ok:true,value:(older?{...page,points:[],defaultPointId:null,nextCursor:null,continuousRecovery:stream}:page) as T}));
 c.account('owner');await c.open(venue);c.select(venue);older=true;await c.load(true);
 assert.equal(c.selected,undefined);assert.equal(c.selectedSource,stream?'continuous':undefined);
});

for(const status of [401,403])test(`a ${status} older-page response clears the catalogue and both choices`,async()=>{
 let older=false;
 const c=new BackupController(()=>{},async<T>():Promise<ApiResult<T>>=>older?{ok:false,status,code:'forbidden',retryAfterMs:0}:{ok:true,value:page as T});
 c.account('owner');await c.open(venue);c.select(venue);older=true;await c.load(true);
 assert.equal(c.page,undefined);assert.equal(c.selected,undefined);assert.equal(c.selectedSource,undefined);assert.equal(c.error,status===401?'pairSession':'forbidden');
});
test('a stale continuous source falls back to the default verified snapshot on reload',async()=>{
 let fresh=true;
 const c=new BackupController(()=>{},async<T>():Promise<ApiResult<T>>=>({ok:true,value:{...page,continuousRecovery:fresh?continuous:null} as T}));
 c.account('owner');await c.open(venue);assert.equal(c.selectedSource,'continuous');fresh=false;await c.load();assert.equal(c.selectedSource,'snapshot');assert.equal(c.selected,venue);
});
