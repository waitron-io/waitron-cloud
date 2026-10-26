import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
import {InstallationController} from '../src/installation-controller.ts';
import {BackupController} from '../src/backup-controller.ts';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import {UsageController} from '../src/usage-controller.ts';
import {RemoteController} from '../src/remote-controller.ts';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';
import {AlertController} from '../src/alert-controller.ts';
import {AccountSecurityController} from '../src/account-security-controller.ts';
import {PasskeyController} from '../src/passkey-controller.ts';
import {AuthenticatorController} from '../src/authenticator-controller.ts';
const id='20000000-0000-4000-8000-000000000001';
for(const code of ['permission_denied','forbidden'])for(const name of ['installations','backups','diagnostics','usage','remote','translation','alerts','sessions','passkeys','authenticator'])test(`${name}: ${code} gives the appropriate way forward`,async()=>{
 const request=async<T>():Promise<ApiResult<T>>=>({ok:false,status:403,code,retryAfterMs:0});
 const changed=()=>{};
 const accountOnly=['alerts','sessions','passkeys','authenticator'].includes(name);
 const expected=code==='permission_denied'?(accountOnly?'permissionAccount':'permissionBusiness'):'forbidden';
 let c:{error:unknown;pending:boolean};
 if(name==='installations'){const v=new InstallationController(changed,request);v.account(id);await v.load();assert.deepEqual(v.installations,[]);assert.equal(v.confirming,undefined);c=v;}
 else if(name==='backups'){const v=new BackupController(changed,request);v.account(id);await v.open(id);assert.equal(v.page,undefined);assert.equal(v.selectedSource,undefined);c=v;}
 else if(name==='diagnostics'){let saved=false;const v=new DiagnosticController(changed,request,()=>{saved=true;});v.account(id);await v.download(id);assert.equal(saved,false);c=v;}
 else if(name==='usage'){const v=new UsageController(changed,request);v.account(id);v.organisation(id);await v.load();assert.equal(v.summary,undefined);c=v;}
 else if(name==='remote'){const v=new RemoteController(changed,request);v.account(id);await v.open(id);assert.equal(v.view,undefined);assert.equal(v.confirmation,undefined);c=v;}
 else if(name==='translation'){const v=new TranslationConsentController(changed,request);v.account(id);await v.load();assert.deepEqual(v.consents,[]);assert.equal(v.loaded,false);c=v;}
 else if(name==='alerts'){const v=new AlertController(changed,request);v.account(id);await v.load();assert.equal(v.loaded,false);assert.equal(v.dirty,false);c=v;}
 else if(name==='sessions'){let ended=false;const v=new AccountSecurityController(changed,()=>{ended=true;},request);v.account(id);await v.load();assert.deepEqual(v.sessions,[]);assert.equal(ended,false);c=v;}
 else if(name==='passkeys'){const v=new PasskeyController(changed,request,{supported:async()=>false,register:async()=>{throw Error('unexpected prompt');},authenticate:async()=>{throw Error('unexpected prompt');}});v.account(id);await v.load();assert.deepEqual(v.passkeys,[]);c=v;}
 else {const v=new AuthenticatorController(changed,request);v.account(id);await v.load();assert.equal(v.status,undefined);c=v;}
 assert.equal(c.error,expected);assert.equal(c.pending,false);
});
