import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
import {InstallationController} from '../src/installation-controller.ts';
import {BackupController} from '../src/backup-controller.ts';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import {UsageController} from '../src/usage-controller.ts';
import {RemoteController} from '../src/remote-controller.ts';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';
const id='20000000-0000-4000-8000-000000000001';
for(const code of ['permission_denied','forbidden'])for(const name of ['installations','backups','diagnostics','usage','remote','translation'])test(`${name}: ${code} gives the appropriate way forward`,async()=>{
 const request=async<T>():Promise<ApiResult<T>>=>({ok:false,status:403,code,retryAfterMs:0});
 const changed=()=>{};
 const expected=code==='permission_denied'?'permissionBusiness':'forbidden';
 let c:{error:unknown;pending:boolean}|undefined;
 if(name==='installations'){const v=new InstallationController(changed,request);v.account(id);v.installations=[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,services:[{service:'remote_access',state:'unconfigured',health:'unknown',failure:null,observedAt:null},{service:'continuous_backup',state:'unconfigured',health:'unknown',failure:null,observedAt:null},{service:'retained_snapshots',state:'unconfigured',health:'unknown',failure:null,observedAt:null}]}];v.confirming=id;await v.load();assert.deepEqual(v.installations,[]);assert.equal(v.confirming,undefined);c=v;}
 else if(name==='backups'){const v=new BackupController(changed,request);v.account(id);v.venueId=id;v.page={venueId:id,points:[],nextCursor:null,defaultPointId:null,continuousRecovery:{recoverableAt:'2026-01-01T00:00:00.000Z',checkedAt:'2026-01-01T00:00:00.000Z',sourceNodeId:id}};v.selectedSource='continuous';await v.load();assert.equal(v.page,undefined);assert.equal(v.selectedSource,undefined);c=v;}
 else if(name==='diagnostics'){let saved=false;const v=new DiagnosticController(changed,request,()=>{saved=true;});v.account(id);await v.download(id);assert.equal(saved,false);c=v;}
 else if(name==='usage'){const v=new UsageController(changed,request);v.account(id);v.organisation(id);v.summary={version:1,organisationId:id,storage:{currentBytes:'42',addedBytes:'42',removedBytes:'0'},transfer:{uploadedBytes:'42',restoredBytes:'0'},operations:{installationCompleted:'1',monitoringProbes:'1'},messages:{sent:'1',failed:'0',expired:'0',cancelled:'0'},latestEventAt:null,measuredThrough:null};await v.load();assert.equal(v.summary,undefined);c=v;}
 else if(name==='remote'){const v=new RemoteController(changed,request);v.account(id);v.installationId=id;v.view={installationId:id,revision:0,revoked:false,names:{staff:{assigned:'staff.example.test',current:'staff.example.test'},public:{assigned:'public.example.test',current:'public.example.test'}},service:{state:'ready',health:'unknown',observedAt:null,validUntil:null}};v.hostname='private.example.test';v.confirmation={kind:'staff',hostname:v.hostname,revision:0,records:[]};await v.load();assert.equal(v.hostname,'');assert.equal(v.view,undefined);assert.equal(v.confirmation,undefined);c=v;}
 else if(name==='translation'){const v=new TranslationConsentController(changed,request);v.account(id);v.consents=[{venueId:id,consented:true,consentedAt:'2026-01-01T00:00:00.000Z'}];v.loaded=true;await v.load();assert.deepEqual(v.consents,[]);assert.equal(v.loaded,false);c=v;}
 assert(c);assert.equal(c.error,expected);assert.equal(c.pending,false);
});
