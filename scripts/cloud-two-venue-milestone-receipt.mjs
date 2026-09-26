import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {verifyBackupTransferReceipt} from './verify-backup-transfer-receipt.mjs';
import {verifyManagedRecoveryReceipt} from './verify-managed-recovery-receipt.mjs';
import {verifyRemoteMilestoneEvidence,verifyTwoVenueMilestoneReceipt} from './verify-two-venue-milestone-receipt.mjs';

const checks=['real-postgresql','real-waitron','real-wireguard-haproxy','real-seaweedfs-litestream','no-production-resources'];

export function composeMilestoneReceipt(transferValue,remoteValue,managedValue){
 const transfer=verifyBackupTransferReceipt(transferValue),remote=verifyRemoteMilestoneEvidence(remoteValue),managedRecovery=verifyManagedRecoveryReceipt(managedValue);
 return verifyTwoVenueMilestoneReceipt({
  version:1,
  cloudHead:transfer.cloudHead,
  waitronHead:transfer.waitronHead,
  cloudDirty:transfer.cloudDirty||remote.cloudDirty||managedRecovery.cloudDirty,
  waitronDirty:transfer.waitronDirty||remote.waitronDirty||managedRecovery.waitronDirty,
  phases:['backup-transfer','remote-access','managed-recovery'],
  transfer,remote,managedRecovery,
  measurements:{gatewayReplacementMs:remote.replacementMs,cellReconnectionMs:remote.movement.reconnectionMs,continuousRestoreMs:managedRecovery.continuous.restoreMs,snapshotRestoreMs:managedRecovery.snapshotFallback.restoreMs,replacementMs:managedRecovery.replacement.elapsedMs},
  activation:'not-performed',checks,
 });
}

async function run(script,environment){
 const child=spawn(process.execPath,[script],{cwd:resolve(new URL('..',import.meta.url).pathname),env:{...process.env,...environment},stdio:'inherit'});
 const code=await new Promise((done,fail)=>{child.once('error',fail);child.once('exit',value=>done(value??1));});
 if(code!==0)throw new Error(`${script} exited ${code}`);
}
async function readReceipt(path){return JSON.parse(await readFile(path,'utf8'));}
async function writeReceipt(path,value){
 const target=resolve(path),staged=join(dirname(target),`.${randomUUID()}.tmp`);
 try{await writeFile(staged,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(staged,target);}finally{await rm(staged,{force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert(process.env.WAITRON_CHECKOUT,'Set WAITRON_CHECKOUT');
 const root=await mkdtemp(join(tmpdir(),'cloud-two-venue-milestone-')),
  transferPath=join(root,'transfer.json'),remotePath=join(root,'remote.json'),managedPath=join(root,'managed.json');
 try{
  await run('scripts/backup-transfer-receipt.mjs',{BACKUP_TRANSFER_RECEIPT:transferPath});
  await run('scripts/test-local-remote.mjs',{REMOTE_RECEIPT:remotePath});
  await run('scripts/test-local-backups.mjs',{BACKUP_RECEIPT:managedPath});
  const result=composeMilestoneReceipt(await readReceipt(transferPath),await readReceipt(remotePath),await readReceipt(managedPath));
  if(process.env.CLOUD_MILESTONE_RECEIPT)await writeReceipt(process.env.CLOUD_MILESTONE_RECEIPT,result);
  console.log(JSON.stringify(result,null,2));
 }finally{await rm(root,{recursive:true,force:true});}
}
