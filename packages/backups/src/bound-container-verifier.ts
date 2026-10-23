import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {backupVerificationRequestDigest,readBackupVerificationRequest,readBackupVerificationResult,type BackupVerificationRequest,type BackupVerificationResult} from './verification-protocol.ts';
import {readVerificationKey,verificationInput,type VerificationKey} from './verification-transport.ts';
import type {ReplayableObject} from './object-transfer.ts';
export interface VerifiedChildOutput {
 result:BackupVerificationResult;
 receipt:{childId:string;imageId:string;requestDigest:string;controllerScope:string;childToken:string;terminated:true;cleanupConfirmed:true};
}
export type DataRestoreVerifier=(source:ReplayableObject,key:VerificationKey,request:BackupVerificationRequest,signal:AbortSignal)=>Promise<VerifiedChildOutput>;
interface BoundController {scope:string;reclaim():Promise<void>;create(args:string[],request:BackupVerificationRequest):Promise<string>;remove(id:string,request:BackupVerificationRequest):Promise<void>;}
interface BoundContainerOptions {image:string;owner:string;controller:BoundController;memoryMiB?:number;scratchMiB?:number;}
const execute=promisify(execFile),idPattern=/^[a-f0-9]{64}$/;
async function docker(args:string[],missing?:string){
 try{return (await execute('docker',args,{timeout:10000,maxBuffer:65536})).stdout.trim();}
 catch(error){const detail=error as {code?:unknown;signal?:unknown;killed?:boolean;stderr?:string};if(missing&&detail.code===1&&!detail.signal&&!detail.killed&&[`error: no such object: ${missing}`,`error response from daemon: no such container: ${missing}`].includes(detail.stderr?.trim().toLowerCase()??''))return '';throw Error('backup.verifier_container');}
}
export async function createBoundContainerWaitronVerifier(options:BoundContainerOptions):Promise<DataRestoreVerifier>{
 const {image,owner,controller}=options,memory=options.memoryMiB??1024,scratch=options.scratchMiB??256;
 if(!/^sha256:[a-f0-9]{64}$/.test(image??'')||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(owner??'')||!controller||typeof controller.scope!=='string'||!controller.scope||!Number.isInteger(memory)||memory<128||memory>1024||!Number.isInteger(scratch)||scratch<1||scratch>256)throw Error('backup.verifier_configuration');
 let imageInfo;
 try{[imageInfo]=JSON.parse(await docker(['image','inspect',image]));if(imageInfo.Id!==image||Object.keys(imageInfo.Config.Volumes??{}).length)throw Error();}
 catch{throw Error('backup.verifier_configuration');}
 await controller.reclaim();
 return async(source,suppliedKey,supplied,signal)=>{
  let request:BackupVerificationRequest,key:VerificationKey;
  try{request=readBackupVerificationRequest(JSON.stringify(supplied));key=readVerificationKey(JSON.stringify(suppliedKey),request);}catch{throw Error('backup.verifier_input');}
  if(request.verifierImage!=='local.waitron-verifier@'+image||request.attempt.controllerScope!==controller.scope)throw Error('backup.verifier_configuration');
  if(signal.aborted)throw Error('backup.verifier_cancelled');
  const timeout=Math.min(30000,Date.parse(request.attempt.deadline)-Date.now());
  if(timeout<1)throw Error('backup.verifier_timeout');
  await controller.reclaim();
  const digest=backupVerificationRequestDigest(request),labels={'cloud.backup-verifier.owner':owner,'cloud.backup-verifier.scope':controller.scope,'cloud.backup-verifier.token':request.attempt.childToken,'cloud.backup-verifier.claim':request.attempt.claimId,'cloud.backup-verifier.request':digest,'cloud.backup-verifier.deadline':String(Date.parse(request.attempt.deadline))};
  let id:string|undefined,child:ChildProcess|undefined,closed:Promise<number|null>|undefined,input:Readable|undefined,upload:Promise<void>|undefined,failure:string|undefined,removal:Promise<void>|undefined;
  const remove=()=>removal??=(async()=>{try{await controller.remove(id!,request);if(await docker(['inspect',id!],id))throw Error();}catch{throw Error('backup.verifier_cleanup');}})();
  const stop=(code:string)=>{failure??=code;input?.destroy();if(id)remove().catch(()=>{});child?.kill('SIGKILL');};
  const abort=()=>stop('backup.verifier_cancelled');signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop('backup.verifier_timeout'),Math.max(1,Date.parse(request.attempt.deadline)-Date.now()));
  async function inspect(){
   const raw=await docker(['inspect',id!]);
   let info;
   try{[info]=JSON.parse(raw);}catch{throw Error('backup.verifier_container');}
   if(info.Id!==id||info.Image!==image||JSON.stringify(info.Config.Entrypoint)!=='["node"]'||JSON.stringify(info.Config.Cmd)!=='["/verifier/container-entry.mjs","--bound"]'||Object.entries(labels).some(([name,value])=>info.Config.Labels?.[name]!==value)||info.Config.User!=='1000:1000'||info.HostConfig.NetworkMode!=='none'||!info.HostConfig.ReadonlyRootfs||info.HostConfig.Privileged!==false||info.HostConfig.CapDrop?.length!==1||info.HostConfig.CapDrop[0]!=='ALL'||!info.HostConfig.SecurityOpt?.includes('no-new-privileges')||info.HostConfig.PidsLimit!==64||info.HostConfig.NanoCpus!==1000000000||info.HostConfig.Memory!==memory*1024*1024||info.HostConfig.MemorySwap!==memory*1024*1024||info.HostConfig.IpcMode!=='none'||info.Mounts?.length!==0||Object.keys(info.HostConfig.Tmpfs??{}).join(',')!=='/scratch'||info.HostConfig.Tmpfs['/scratch']!==`rw,noexec,nosuid,nodev,size=${scratch}m,uid=1000,gid=1000,mode=0700`||info.HostConfig.LogConfig?.Type!=='none')throw Error('backup.verifier_container');
   return info;
  }
  try{
   if(signal.aborted){stop('backup.verifier_cancelled');throw Error(failure);}
   const args=['--name','cloud-bound-verify-'+randomUUID(),'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--pids-limit','64','--cpus','1','--memory',`${memory}m`,'--memory-swap',`${memory}m`,'--ipc','none','--tmpfs',`/scratch:rw,noexec,nosuid,nodev,size=${scratch}m,uid=1000,gid=1000,mode=0700`,'--ulimit','core=0','--log-driver','none','--env','TMPDIR=/scratch','--entrypoint','node','-i',image,'/verifier/container-entry.mjs','--bound'];
   id=await controller.create(args,request);
   if(!idPattern.test(id))throw Error('backup.verifier_container');
   if(failure||signal.aborted){stop(failure??'backup.verifier_cancelled');throw Error(failure);}
   await inspect();
   if(failure)throw Error(failure);
   const attached=spawn('docker',['start','-ai',id],{stdio:['pipe','pipe','pipe']});child=attached;
   let output:Buffer[]=[],size=0,outputSize=0,attachExit:{code:number|null}|undefined,uploadFailed=false;
   const collect=(bytes:Buffer,stdout:boolean)=>{size+=bytes.length;if(stdout)outputSize+=bytes.length;if(size>65536||outputSize>32768){stop('backup.verifier_output');return;}if(stdout)output.push(bytes);};
   attached.stdout.on('data',bytes=>collect(bytes,true));attached.stderr.on('data',bytes=>collect(bytes,false));
   closed=new Promise<number|null>(resolve=>{attached.once('error',()=>stop('backup.verifier_container'));attached.once('close',resolve);});
   closed.then(code=>{attachExit={code};});
   attached.stdin.on('error',()=>{uploadFailed=true;});
   for(;;){
    const info=await inspect();if(failure)throw Error(failure);
    if(info.State.Status!=='created')break;
    if(attachExit)throw Error('backup.verifier_container');
    await delay(10);
   }
   try{input=source.open();}catch{throw Error('backup.verifier_input');}
   input.once('error',()=>stop('backup.verifier_input'));
   upload=pipeline(Readable.from(verificationInput(request,key,input)),attached.stdin).catch(()=>{uploadFailed=true;});
   const code=await closed;input.destroy();await upload;
   if(failure)throw Error(failure);
   const info=await inspect();if(failure)throw Error(failure);
   if(info.State.OOMKilled||info.State.ExitCode===73)throw Error('backup.verifier_resource');
   if(info.State.Status!=='exited'||info.State.Error||code!==info.State.ExitCode)throw Error('backup.verifier_container');
   if(info.State.ExitCode===74)throw Error('backup.verifier_timeout');
   if(![0,1].includes(info.State.ExitCode))throw Error('backup.verifier_container');
   if(info.State.ExitCode!==0)throw Error('backup.verifier_failed');
   if(uploadFailed)throw Error('backup.verifier_input');
   let result:BackupVerificationResult;
   try{result=readBackupVerificationResult(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(output)),request);}catch{throw Error('backup.verifier_output');}
   await remove();
   if(failure||signal.aborted)throw Error(failure??'backup.verifier_cancelled');
   if(Date.parse(request.attempt.deadline)<=Date.now())throw Error('backup.verifier_timeout');
   return {result,receipt:{childId:id,imageId:image,requestDigest:digest,controllerScope:controller.scope,childToken:request.attempt.childToken,terminated:true,cleanupConfirmed:true}};
  }catch(error){
   if(failure)throw Error(failure);
   if(error instanceof Error&&/^backup\.verifier_/.test(error.message))throw error;
   throw Error('backup.verifier_container');
  }finally{
   try{if(id)await remove();}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);input?.destroy();child?.kill('SIGKILL');await closed;await upload;}
  }
 };
}
