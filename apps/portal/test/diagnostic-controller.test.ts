import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import {validDiagnosticExport,type DiagnosticExport} from '../src/diagnostic-types.ts';
import type {ApiResult} from '../src/api.ts';

const installation='12345678-1234-4234-8234-123456789abc',venue='22345678-1234-4234-8234-123456789abc';
const document=():DiagnosticExport=>({version:1,generatedAt:'2026-09-26T21:02:03.000Z',installation:{installationId:installation,venueId:venue,environment:'test',revision:4,
 access:{status:'active',lastContactAt:null,leaseExpiresAt:null},services:[
  {service:'continuous_backup',state:'ready',health:'healthy',observedAt:'2026-09-26T21:00:00.000Z'},
  {service:'remote_access',state:'ready',health:'unknown',observedAt:null},
  {service:'retained_snapshots',state:'ready',health:'healthy',observedAt:'2026-09-26T21:00:00.000Z'},
 ],backups:{latestSnapshotAt:null,verifiedSnapshotAt:null},monitoring:{enabled:true,fresh:true,checkedAt:'2026-09-26T21:00:00.000Z',incidents:[],remoteChecks:{public:null,staff:null}}}});

test('strict diagnostic validation rejects extra, malformed and secret-bearing shapes',()=>{
 assert.equal(validDiagnosticExport(document()),true);
 assert.equal(validDiagnosticExport({...document(),extra:'private'}),false);
 assert.equal(validDiagnosticExport({...document(),generatedAt:'yesterday'}),false);
 assert.equal(validDiagnosticExport({...document(),installation:{...document().installation,configuration:{secret:'private'}}}),false);
 assert.equal(validDiagnosticExport({...document(),installation:{...document().installation,services:[document().installation.services[0]]}}),false);
 assert.equal(validDiagnosticExport({...document(),installation:{...document().installation,monitoring:{...document().installation.monitoring,remoteChecks:{public:{status:'healthy',checkedAt:'bad',certificateNotAfter:null},staff:null}}}}),false);
});

test('download validates the selected installation and uses a safe stable file name',async()=>{
 const saved:Array<{value:DiagnosticExport;name:string}>=[],calls:unknown[]=[];
 const controller=new DiagnosticController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{calls.push({path,body});return {ok:true,value:document() as T};},(value,name)=>saved.push({value,name}));
 controller.account('owner');await controller.download(installation);
 assert.deepEqual(calls,[{path:'/diagnostics/read',body:{installationId:installation}}]);
 assert.deepEqual(saved,[{value:document(),name:'waitron-cloud-diagnostic-22345678-20260926T210203Z.json'}]);
 assert.equal(controller.error,undefined);assert.equal(controller.pending,false);
});

test('account changes fence delayed private documents and failed reads remain retryable',async()=>{
 let finish!:(value:ApiResult<DiagnosticExport>)=>void,calls=0;
 const controller=new DiagnosticController(()=>{},<T>()=>{calls++;return new Promise<ApiResult<T>>(resolve=>{finish=resolve as typeof finish;});},()=>assert.fail('must not save'));
 controller.account('first');const pending=controller.download(installation);controller.account('second');finish({ok:true,value:document()});await pending;
 assert.equal(controller.pending,false);assert.equal(controller.error,undefined);
 const lost=controller.download(installation);finish({ok:false,status:0,code:'network_error',retryAfterMs:0});await lost;assert.equal(controller.error,'diagnosticUnavailable');
 const retry=controller.download(installation);assert.equal(calls,3);finish({ok:false,status:403,code:'forbidden',retryAfterMs:0});await retry;assert.equal(controller.error,'forbidden');
});

test('rate limit prevents repeated downloads until Retry-After passes',async()=>{
 let calls=0;const controller=new DiagnosticController(()=>{},async<T>():Promise<ApiResult<T>>=>{calls++;return {ok:false,status:429,code:'rate_limited',retryAfterMs:60_000};},()=>{});
 controller.account('owner');await controller.download(installation);assert.equal(controller.error,'limited');assert.ok(controller.waiting>0);
 await controller.download(installation);assert.equal(calls,1);
});
