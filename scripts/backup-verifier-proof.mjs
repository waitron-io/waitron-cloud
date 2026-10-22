import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {bufferObject} from '../packages/backups/src/object-transfer.ts';
import {createContainerWaitronVerifier} from '../packages/backups/src/container-verifier.ts';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyBackupVerifierProof} from './verify-backup-verifier-proof.mjs';
// The older adapter's two-venue/resource contract has no target binding.
// Its result cannot certify the version 2 release receipt.
export async function runLegacyBackupVerifierProof(){
const checkout=await realpath(process.env.WAITRON_CHECKOUT??''),image=process.env.CLOUD_VERIFIER_IMAGE;
assert(image,'Set CLOUD_VERIFIER_IMAGE to your built image');
const require=createRequire(join(checkout,'apps/server/package.json')),owner='proof-'+randomUUID(),roots=[],children=[],snapshots=[];
const imageInfo=JSON.parse(execFileSync('docker',['image','inspect',image],{encoding:'utf8'}))[0];
assert.equal(imageInfo.Config.Labels['cloud.waitron-revision'],execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim());
const verify=await createContainerWaitronVerifier({image,owner}),checks=[];
try{
 for(let venue=0;venue<2;venue++){
  const root=await mkdtemp(join(tmpdir(),'cloud-integration-backup-container-'));roots.push(root);
  const server=spawn(process.execPath,['--import',require.resolve('tsx'),join(checkout,'apps/server/scripts/cloud-integration-fixture.ts')],{cwd:join(checkout,'apps/server'),env:{...process.env,CLOUD_TEST_ROOT:root,CLOUD_TEST_ORIGIN:'http://127.0.0.1:9',CLOUD_TEST_BACKUP_STATE:'1'},stdio:['ignore','pipe','pipe','ipc']});
  let logs='';for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{logs=(logs+chunk).slice(-16000);});
  const done=new Promise(resolve=>server.once('close',resolve));children.push({server,done});
  const deadline=Date.now()+30000;let ready=false;
  while(Date.now()<deadline){try{await readFile(join(root,'ready.json'));ready=true;break;}catch{}if(server.exitCode!==null)break;await delay(100);}
  assert(ready,'fixture server did not start: '+logs);
  const recoveryKey=randomBytes(32).toString('base64url');
  const capture=spawn(process.execPath,['--permission','--allow-fs-read=*','--allow-fs-write='+await realpath(root),'--allow-worker','--allow-child-process','--allow-addons','--import',require.resolve('tsx'),join(checkout,'apps/server/scripts/cloud-backup-fixture.ts')],{cwd:join(checkout,'apps/server'),env:{TMPDIR:process.env.TMPDIR,TSX_DISABLE_CACHE:'1',CLOUD_TEST_ROOT:root},stdio:['pipe','pipe','pipe']});
  let output='',errors='';capture.stdout.on('data',c=>output+=c);capture.stderr.on('data',c=>errors+=c);
  capture.stdin.end(JSON.stringify({command:'capture',recoveryKey}));const timer=setTimeout(()=>capture.kill('SIGKILL'),30000);
  const code=await new Promise(resolve=>capture.once('close',resolve));clearTimeout(timer);assert.equal(code,0,errors);
  const captured=JSON.parse(output.trim().split('\n').at(-1)),source=bufferObject(await readFile(join(root,'captured.backup.enc'))),point={sourceNodeId:captured.sourceNodeId,modules:captured.manifest.modules,capturedAt:captured.manifest.createdAt};
  server.kill('SIGTERM');await done;
  snapshots.push({source,keys:{recoveryKey},point});
 }
 const results=await Promise.all(snapshots.map(({source,keys,point})=>verify(source,keys,point,new AbortController().signal)));
 for(const result of results){assert.equal(result.integrityOk,true);assert.equal(result.networkDenied,true);assert.equal(result.outsideWriteDenied,true);assert.equal(result.cloudCredentialPresent,false);assert(result.hooks.length>0);}
 await assert.rejects(verify(snapshots[0].source,snapshots[1].keys,snapshots[1].point,new AbortController().signal),/backup.verifier_failed/);
 assert.equal((await verify(snapshots[0].source,snapshots[0].keys,snapshots[0].point,new AbortController().signal)).integrityOk,true);
 assert.equal(execFileSync('docker',['ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner],{encoding:'utf8'}).trim(),'');
 checks.push('two-real-waitron-snapshots','restore-hooks','sqlite-integrity','cross-venue-refusal','later-valid-restore','no-owned-containers');
 const result={version:1,waitronRevision:imageInfo.Config.Labels['cloud.waitron-revision'],imageId:imageInfo.Id,memoryMiB:1024,scratchMiB:256,checks,results};
 await writeFile(process.argv[2]??'/tmp/cloud-backup-verifier-proof.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 for(const {server,done} of children){server.kill('SIGTERM');await done;}
 await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})));
}
}

export function readJointProofRun(output){
 const matches=[...output.matchAll(/^# CLOUD_BACKUP_JOINT=(.*)$/gm)];
 assert.equal(matches.length,1,'proof needs one same-run receipt');
 for(const [name,want] of Object.entries({tests:1,pass:1,fail:0,cancelled:0,skipped:0})){
  const counts=[...output.matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))];
  assert.equal(counts.length,1,'proof needs an executed scenario');assert.equal(Number(counts[0][1]),want,'proof needs an executed scenario');
 }
 return verifyBackupVerifierProof(JSON.parse(matches[0][1]),{requireComplete:false});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const destination=process.argv[2]??'/tmp/cloud-backup-verifier-proof.json';
 try{
  assert(process.argv.length<=3,'Usage: node scripts/backup-verifier-proof.mjs [RECEIPT.json]');
  assert(process.env.TEST_CLOUD_SNAPSHOT_PROOF_IMAGE&&process.env.TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE,'Set TEST_CLOUD_SNAPSHOT_PROOF_IMAGE and TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE to the built local candidates');
  // A separate runner must execute its files even when a parent test launches this command.
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
  const {stdout}=await promisify(execFile)(process.execPath,['--test','--test-reporter=tap','deploy/test-cloud/snapshot-proof.test.mjs'],{cwd:new URL('../',import.meta.url),env:environment,timeout:300000,maxBuffer:2*1024*1024});
  const value=readJointProofRun(stdout);await writeFile(destination,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  verifyBackupVerifierProof(value);console.log('Verified complete joint backup proof');
 }catch(error){
  console.error(error?.message==='joint backup verification and recovery proof is incomplete'?'Saved incomplete joint evidence; ordinary recovery and remaining controls are not qualified':error instanceof assert.AssertionError?error.message:'Joint backup proof failed; no new receipt was certified');
  process.exitCode=1;
 }
}
