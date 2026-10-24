import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import type {ApiResult} from '../src/api.ts';

const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002';
for(const failure of [
 {ok:false,status:503,code:'unavailable',retryAfterMs:0},
 {ok:true,value:{}},
] as const)test(`diagnostic ${failure.ok?'malformed reply':'503'} keeps the installation only while its error is shown`,async()=>{
 let complete!:(result:ApiResult<unknown>)=>void;
 const controller=new DiagnosticController(()=>{},<T>()=>new Promise<ApiResult<T>>(resolve=>{complete=resolve as typeof complete;}),()=>assert.fail('must not save an unavailable diagnostic'));
 controller.account('owner');
 const failed=controller.download(second);complete(failure);await failed;
 assert.equal(controller.error,'diagnosticUnavailable');assert.equal(controller.errorInstallationId,second);
 assert.equal(controller.pending,false);assert.equal(controller.selected,undefined);
 const retry=controller.download(first);
 assert.equal(controller.error,undefined);assert.equal(controller.errorInstallationId,undefined);assert.equal(controller.selected,first);
 complete(failure);await retry;
 assert.equal(controller.errorInstallationId,first);
 controller.account('other');assert.equal(controller.error,undefined);assert.equal(controller.errorInstallationId,undefined);
});

test('a delayed diagnostic failure cannot restore the old account venue',async()=>{
 let complete!:(result:ApiResult<unknown>)=>void;
 const controller=new DiagnosticController(()=>{},<T>()=>new Promise<ApiResult<T>>(resolve=>{complete=resolve as typeof complete;}),()=>assert.fail('must not save'));
 controller.account('owner');const pending=controller.download(second);controller.account('other');
 complete({ok:false,status:503,code:'unavailable',retryAfterMs:0});await pending;
 assert.equal(controller.error,undefined);assert.equal(controller.errorInstallationId,undefined);assert.equal(controller.pending,false);
});
