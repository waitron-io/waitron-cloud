import assert from 'node:assert/strict';
import {verifierControlsFixture} from './test-fixtures/backup-verifier-controls.mjs';
import test from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backupVerificationRequestDigest} from '../packages/backups/src/verification-protocol.ts';
const target=JSON.parse(await readFile(new URL('../deploy/backup-verifier/target.json',import.meta.url),'utf8'));
const vector=JSON.parse(await readFile(new URL('../packages/backups/test/fixtures/verification-vector.json',import.meta.url),'utf8'));
const implementation=await import('./verify-backup-verifier-proof.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const verify=(...args)=>{assert.equal(typeof implementation.verifyBackupVerifierProof,'function','complete joint-proof validator is missing');return implementation.verifyBackupVerifierProof(...args);};
export function jointReceipt(){
 const request={...vector,target,archive:{...vector.archive,modules:Object.fromEntries(target.modules.map(m=>[m.name,m.schema]))},verifierImage:'local.waitron-verifier@sha256:'+'2'.repeat(64)};
 const requestDigest=backupVerificationRequestDigest(request);
 const value={
  version:2,runId:'joint-run-1',cloudHead:'a'.repeat(40),cloudTree:'b'.repeat(40),cloudDirty:false,
  waitronTarget:structuredClone(target),candidateImage:'sha256:'+'2'.repeat(64),publication:'unqualified',
  archive:{kind:'genuine-waitron',captureId:'capture-1',pointId:'capture-1',sourceNodeId:'node-1',sha256:'1'.repeat(64),bytes:8388608,modules:{...request.archive.modules}},
  continuous:{streamObjects:0,pointerRows:0,observations:['capture','publication','verification','admission','catalogue','approval','read','placement','recovery']},
  phases:[
   ['capture',['encrypted-archive','network-denied']],
   ['publication',['signed-publication','immutable-storage']],
   ['verification',['bound-sandbox','complete-module-checks','child-removed']],
   ['admission',['transaction-committed','current-qualification']],
   ['catalogue',['api-verified','api-default-point']],
   ['approval',['owner-v2','selected-attempt']],
   ['read',['pinned-compiled-waitron-client','target-before-placement','independent-digest']],
   ['placement',['genuine-data-placed','integrity-checked']],
   ['recovery',['ordinary-restore','separate-authority','no-activation','no-route-movement']],
   ['refusals',['alternate-target-before-placement','archive-integrity','wrong-key','authority-no-activation','malformed-output','timeout','oom','scratch','cancel','crash','uncertain-cleanup']],
  ].map(([name,checks])=>({name,state:'executed',runId:'joint-run-1',checks,reason:null})),
  verification:{request,result:{protocol:request.protocol,requestDigest,attemptToken:request.attempt.childToken,measuredArchive:{sha256:request.archive.sha256,bytes:request.archive.bytes},targetDigest:target.digest,policyDigest:target.policyDigest,modules:target.modules.map(m=>({name:m.name,semanticsVersion:1,status:'passed',checks:[{code:'data',status:'passed'}]})),status:'passed',reason:'none',activation:'not_attempted'},receipt:{childId:'3'.repeat(64),imageId:'sha256:'+'2'.repeat(64),requestDigest,controllerScope:request.attempt.controllerScope,childToken:request.attempt.childToken,terminated:true,cleanupConfirmed:true}},
  admission:{attemptId:'attempt-1',requestDigest,pointId:'capture-1',targetDigest:target.digest,verification:'verified'},
  recovery:{protocolVersion:2,pointId:'capture-1',attemptId:'attempt-1',targetDigest:target.digest,readDigest:'1'.repeat(64),readBytes:8388608,client:'pinned-compiled-waitron',placement:'executed',ordinaryRestore:'executed',activation:'not_attempted',routeMoved:false},
  cleanup:{confirmed:true,containers:0,volumes:0,networks:0,directories:0},
 };
 value.verifierControls=verifierControlsFixture(value);return value;
}
test('accepts one complete bound local scenario without calling its image published',()=>{const r=jointReceipt();assert.equal(verify(r),r);});
for(const [name,change] of [
 ['legacy callback receipt',r=>{r.version=1;}],
 ['missing genuine capture',r=>{r.archive.kind='synthetic';}],
 ['missing publication',r=>{r.phases=r.phases.filter(p=>p.name!=='publication');}],
 ['fake inventory',r=>{r.waitronTarget.modules.pop();}],
 ['missing module result',r=>{r.verification.result.modules.pop();}],
 ['missing admission',r=>{r.admission=null;}],
 ['missing recovery',r=>{r.recovery=null;}],
 ['continuous source present',r=>{r.continuous.streamObjects=1;}],
 ['continuous pointer present',r=>{r.continuous.pointerRows=1;}],
 ['continuous observation omitted',r=>{r.continuous.observations.pop();}],
 ['missing target denial',r=>{r.phases.at(-1).checks.shift();}],
 ['missing integrity denial',r=>{r.phases.at(-1).checks.splice(1,1);}],
 ['missing authority denial',r=>{r.phases.at(-1).checks.splice(3,1);}],
 ['unconfirmed cleanup',r=>{r.cleanup.confirmed=false;}],
 ['remaining child',r=>{r.cleanup.containers=1;}],
 ['candidate called published',r=>{r.publication='published';}],
 ['phase borrowed from another run',r=>{r.phases[2].runId='older-run';}],
 ['skipped phase called executed',r=>{r.phases[1].state='skipped';r.phases[1].checks=[];r.phases[1].reason='skip-is-not-evidence';}],
 ['missing executed assertion',r=>{r.phases[2].checks.pop();}],
 ['foreign image',r=>{r.verification.receipt.imageId='sha256:'+'4'.repeat(64);}],
 ['foreign request',r=>{r.verification.receipt.requestDigest='5'.repeat(64);}],
 ['foreign controller',r=>{r.verification.receipt.controllerScope='another-controller';}],
 ['foreign child token',r=>{r.verification.receipt.childToken='another-child';}],
 ['child termination unconfirmed',r=>{r.verification.receipt.terminated=false;}],
 ['child cleanup unconfirmed',r=>{r.verification.receipt.cleanupConfirmed=false;}],
 ['production archive',r=>{r.verification.request.archive.environment='production';const digest=backupVerificationRequestDigest(r.verification.request);r.verification.result.requestDigest=digest;r.verification.receipt.requestDigest=digest;r.admission.requestDigest=digest;}],
 ['archive digest substitution',r=>{r.archive.sha256='6'.repeat(64);}],
 ['archive size substitution',r=>{r.archive.bytes--;}],
 ['source identity substitution',r=>{r.archive.sourceNodeId='another-node';}],
 ['capture substitution',r=>{r.archive.captureId='another-capture';}],
 ['point substitution',r=>{r.archive.pointId='another-point';}],
 ['module map substitution',r=>{r.archive.modules.core--;}],
 ['admission substitution',r=>{r.admission.requestDigest='7'.repeat(64);}],
 ['selected attempt substitution',r=>{r.recovery.attemptId='another-attempt';}],
 ['read digest substitution',r=>{r.recovery.readDigest='8'.repeat(64);}],
 ['read size substitution',r=>{r.recovery.readBytes--;}],
 ['invented client',r=>{r.recovery.client='local-signatures';}],
 ['activation attempted',r=>{r.recovery.activation='attempted';}],
 ['route movement',r=>{r.recovery.routeMoved=true;}],
 ['secret leaked',r=>{r.recoveryKey='private';}],
])test('rejects '+name,()=>{const r=jointReceipt();change(r);assert.throws(()=>verify(r,{requireComplete:false}),undefined,name);});
test('records an ordinary fiscal refusal as incomplete and cannot certify the full proof',()=>{
 const r=jointReceipt(),phase=r.phases.find(p=>p.name==='recovery');phase.state='unavailable';phase.checks=['no-activation','no-route-movement'];phase.reason='FISCAL_RESTORE';r.recovery.ordinaryRestore='FISCAL_RESTORE';
 assert.equal(verify(r,{requireComplete:false}),r);assert.throws(()=>verify(r),/incomplete/);
});
test('records not-run placement and recovery without borrowing old success',()=>{
 const r=jointReceipt();for(const name of ['placement','recovery']){const p=r.phases.find(p=>p.name===name);p.state='not-run';p.checks=[];p.reason='separate-authority-unavailable';}r.recovery.placement='not-run';r.recovery.ordinaryRestore='not-run';
 assert.equal(verify(r,{requireComplete:false}),r);assert.throws(()=>verify(r),/incomplete/);
});
const producer=await import('./backup-verifier-proof.mjs').catch(()=>({}));
const parseRun=(...args)=>{assert.equal(typeof producer.readJointProofRun,'function','same-run proof producer is missing');return producer.readJointProofRun(...args);};
const transcript=(receipt,summary={tests:1,pass:1,fail:0,cancelled:0,skipped:0})=>'# CLOUD_BACKUP_JOINT='+JSON.stringify(receipt)+'\n'+Object.entries(summary).map(([name,value])=>'# '+name+' '+value).join('\n')+'\n';
test('proof producer preserves incomplete fiscal evidence without certifying recovery',()=>{
 const r=jointReceipt();r.phases.find(p=>p.name==='recovery').state='unavailable';r.phases.find(p=>p.name==='recovery').checks=['no-activation','no-route-movement'];r.phases.find(p=>p.name==='recovery').reason='FISCAL_RESTORE';r.recovery.ordinaryRestore='FISCAL_RESTORE';
 const actual=parseRun(transcript(r));assert.deepEqual(actual,r);assert.throws(()=>verify(actual),/incomplete/);
});
for(const [name,output,reason] of [
 ['missing same-run receipt',()=>transcript(jointReceipt()).split('\n').slice(1).join('\n'),/one same-run receipt/],
 ['skipped real scenario',()=>transcript(jointReceipt(),{tests:1,pass:0,fail:0,cancelled:0,skipped:1}),/executed scenario/],
 ['failed real scenario',()=>transcript(jointReceipt(),{tests:1,pass:0,fail:1,cancelled:0,skipped:0}),/executed scenario/],
 ['cancelled real scenario',()=>transcript(jointReceipt(),{tests:1,pass:0,fail:0,cancelled:1,skipped:0}),/executed scenario/],
 ['two borrowed receipts',()=>transcript(jointReceipt())+'# CLOUD_BACKUP_JOINT='+JSON.stringify(jointReceipt())+'\n',/one same-run receipt/],
 ['a malformed receipt',()=>transcript({version:1}),/joint proof fields/],
 ['a skip hidden beside a pass',()=>transcript(jointReceipt(),{tests:1,pass:1,fail:0,cancelled:0,skipped:1}),/executed scenario/],
 ['a failure hidden beside a pass',()=>transcript(jointReceipt(),{tests:1,pass:1,fail:1,cancelled:0,skipped:0}),/executed scenario/],
 ['a cancellation hidden beside a pass',()=>transcript(jointReceipt(),{tests:1,pass:1,fail:0,cancelled:1,skipped:0}),/executed scenario/],
 ['a second scenario',()=>transcript(jointReceipt(),{tests:2,pass:1,fail:0,cancelled:0,skipped:0}),/executed scenario/],
 ['a missing pass count',()=>transcript(jointReceipt()).replace('# pass 1\n',''),/executed scenario/],
 ['a duplicated count',()=>transcript(jointReceipt())+'# skipped 0\n',/executed scenario/],
])test('proof producer refuses '+name,()=>assert.throws(()=>parseRun(output()),reason));
test('proof producer CLI certifies separate recovery and retains the primary fiscal refusal',{skip:!process.env.TEST_CLOUD_SNAPSHOT_PROOF_IMAGE||!process.env.TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE,timeout:240000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-joint-producer-test-')),path=join(directory,'proof.json');t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=await promisify(execFile)(process.execPath,['scripts/backup-verifier-proof.mjs',path],{cwd:new URL('../',import.meta.url),env:process.env,timeout:220000,maxBuffer:2*1024*1024});
 assert.match(result.stdout,/Verified complete joint backup proof/);
 const receipt=JSON.parse(await readFile(path,'utf8'));assert.equal(receipt.version,2);assert.equal(receipt.recovery.ordinaryRestore,'FISCAL_RESTORE');assert.equal(verify(receipt,{requireComplete:false}),receipt);assert.equal(verify(receipt),receipt);
 assert.equal(receipt.recovery.activation,'not_attempted');assert.equal(receipt.recovery.routeMoved,false);
 assert.equal(receipt.authorisedRecovery.ordinaryActivation,'executed-with-separate-authority');
});
