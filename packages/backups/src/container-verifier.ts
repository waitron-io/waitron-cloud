import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import type {RestoreVerifier} from './worker.ts';
const execute=promisify(execFile),label='cloud.backup-verifier.owner';
function containerDiagnostic(error:unknown,messages:string[]){
 const detail=error as {code?:unknown;signal?:unknown;killed?:boolean;stderr?:string};
 return detail.code===1&&!detail.signal&&!detail.killed&&messages.includes(detail.stderr?.trim().toLowerCase()??'');
}
function missingContainer(error:unknown,id:string){
 return containerDiagnostic(error,[`error: no such object: ${id}`,`error response from daemon: no such container: ${id}`]);
}
async function removeContainer(name:string,waitForRemoval=false){
 const deadline=Date.now()+10000;
 for(;;){
  try{return (await execute('docker',['rm','-f',name],{timeout:Math.max(1,deadline-Date.now()),maxBuffer:65536})).stdout.trim();}
  catch(error){
   if(missingContainer(error,name))return '';
   // A sibling's removal must finish before reclamation can treat its resources as released.
   if(waitForRemoval&&Date.now()<deadline&&containerDiagnostic(error,[`error response from daemon: removal of container ${name} is already in progress`])){await delay(50);continue;}
   throw Error('backup.verifier_cleanup');
  }
 }
}
interface ContainerVerifierOptions {image:string;owner:string;memoryMiB?:number;scratchMiB?:number;controller?:{reclaim():Promise<void>;create(args:string[]):Promise<string>;remove(id:string):Promise<void>};}
async function docker(args:string[],missingId?:string){
 try{return (await execute('docker',args,{timeout:10000,maxBuffer:65536})).stdout.trim();}
 catch(error){if(missingId!==undefined&&missingContainer(error,missingId))return '';const detail=error as {code?:unknown;signal?:unknown;killed?:boolean};throw Error('backup.verifier_container',{cause:{operation:args[0],code:detail.code,signal:detail.signal,killed:detail.killed}});}
}
export async function createContainerWaitronVerifier(options:ContainerVerifierOptions):Promise<RestoreVerifier>{
 const {image,owner}=options,memory=options.memoryMiB??1024,scratch=options.scratchMiB??256;
 if(typeof image!=='string'||typeof owner!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(image)||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(owner)||!Number.isInteger(memory)||memory<128||memory>2048||!Number.isInteger(scratch)||scratch<1||scratch>512)throw Error('backup.verifier_configuration');
 // Image volumes would add writable storage outside the one quota-limited scratch mount.
 const [imageInfo]=JSON.parse(await docker(['image','inspect',image]));
 if(Object.keys(imageInfo.Config.Volumes??{}).length)throw Error('backup.verifier_configuration');
 const reclaim=async()=>{
 const expired=(await docker(['ps','-aq','--filter',`label=${label}=${owner}`])).split(/\s+/).filter(Boolean);
 for(const id of expired){
  const inspected=await docker(['inspect',id],id);
  if(!inspected)continue;
  const [info]=JSON.parse(inspected);
  // An ownership deadline fences a pass even if its process is still alive; recent results remain readable.
  const deadline=Number(info.Config.Labels?.['cloud.backup-verifier.deadline']);
  if(Number.isFinite(deadline)&&deadline<Date.now())await removeContainer(info.Id,true);
 }
 };
 const reclaimOwned=options.controller?()=>options.controller!.reclaim():reclaim;
 const removeOwned=options.controller?(id:string)=>options.controller!.remove(id):removeContainer;
 await reclaimOwned();
 return async(source,keys,point,signal)=>{
  if(signal.aborted)throw Error('backup.verifier_cancelled');
  await reclaimOwned();
  if(signal.aborted)throw Error('backup.verifier_cancelled');
  const header=JSON.stringify({recoveryKey:keys.recoveryKey,sourceNodeId:point.sourceNodeId,modules:point.modules,capturedAt:point.capturedAt})+'\n';
  if(Buffer.byteLength(header)>65536)throw Error('backup.verifier_input');
  let name='cloud-verify-'+randomUUID();
  let created=false,failure:string|undefined,removal:Promise<unknown>|undefined,attached:Promise<number|null>|undefined,child:ChildProcess|undefined;
  const stop=(code:string)=>{failure??=code;if(created)removal??=removeOwned(name);removal?.catch(()=>{});child?.kill('SIGKILL');};
  const abort=()=>stop('backup.verifier_cancelled');
  signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop('backup.verifier_timeout'),30000);
  try{
   const createArgs=['--name',name,'--label',`${label}=${owner}`,'--label',`cloud.backup-verifier.deadline=${Date.now()+60000}`,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--pids-limit','64','--cpus','1','--memory',`${memory}m`,'--memory-swap',`${memory}m`,'--ipc','none','--tmpfs',`/scratch:rw,noexec,nosuid,nodev,size=${scratch}m,uid=1000,gid=1000,mode=0700`,'--ulimit','core=0','--log-driver','none','--env','TMPDIR=/scratch','--entrypoint','node','-i',imageInfo.Id,'/verifier/container-entry.mjs'];
   if(options.controller)name=await options.controller.create(createArgs);else await docker(['create',...createArgs]);
   created=true;if(failure||signal.aborted){stop(failure??'backup.verifier_cancelled');throw Error(failure);}
   const attachedChild=spawn('docker',['start','-ai',name],{stdio:['pipe','pipe','pipe']});
   child=attachedChild;
   let output='',size=0,uploadFailed=false;
   const collect=(bytes:Buffer,stdout:boolean)=>{size+=bytes.length;if(size>65536){stop('backup.verifier_output');return;}if(stdout)output+=bytes.toString('utf8');};
   attachedChild.stdout.on('data',chunk=>collect(chunk,true));attachedChild.stderr.on('data',chunk=>collect(chunk,false));
   const closed=attached=new Promise<number|null>(resolve=>{attachedChild.once('error',()=>{stop('backup.verifier_container');resolve(null);});attachedChild.once('close',resolve);});
   let attachExit:{code:number|null}|undefined;
   closed.then(code=>{attachExit={code};});
   // Docker publishes running state after runtime startup installs its OOM watcher.
   // Keep attach and start together, but withhold archive input until that acknowledgement.
   for(;;){
    const [info]=JSON.parse(await docker(['inspect',name]));
    if(failure)throw Error(failure);
    if(info.State.Status!=='created')break;
    if(attachExit)throw Error('backup.verifier_container',{cause:{status:info.State.Status,exitCode:info.State.ExitCode,oomKilled:info.State.OOMKilled,startError:Boolean(info.State.Error),attachCode:attachExit.code,uploadFailed:false}});
    await delay(10);
   }
   const input=source.open();
   input.once('error',()=>stop('backup.verifier_input'));
   // Do not delegate throw/return to the source iterator: a broken stdin pipe is not a source-read failure.
   const upload=pipeline(Readable.from((async function*(){
    yield header;const iterator=input.iterator({destroyOnReturn:false});
    for(;;){const part=await iterator.next();if(part.done)return;yield part.value;}
   })()),attachedChild.stdin).catch(()=>{uploadFailed=true;});
   // Removing the container closes attach; the stream is then destroyed even if its source stalled.
   const attachCode=await closed;input.destroy();await upload;
   if(failure)throw Error(failure);
   const [info]=JSON.parse(await docker(['inspect',name]));
   if(failure)throw Error(failure);
   // A created container or host start error has not completed an archive check.
   if(info.State.Status!=='exited'||info.State.Error||(info.State.ExitCode===0&&attachCode!==0))throw Error('backup.verifier_container',{cause:{status:info.State.Status,exitCode:info.State.ExitCode,oomKilled:info.State.OOMKilled,startError:Boolean(info.State.Error),attachCode,uploadFailed}});
   if(info.State.OOMKilled||info.State.ExitCode===73)throw Error('backup.verifier_resource',{cause:{oomKilled:info.State.OOMKilled,exitCode:info.State.ExitCode,memoryBytes:info.HostConfig.Memory,memorySwapBytes:info.HostConfig.MemorySwap,scratch:info.HostConfig.Tmpfs,network:info.HostConfig.NetworkMode,readOnly:info.HostConfig.ReadonlyRootfs,mounts:info.Mounts}});
   // Only the entrypoint's documented exit codes attest a completed verifier outcome.
   if(![0,1,74].includes(info.State.ExitCode))throw Error('backup.verifier_container',{cause:{status:info.State.Status,exitCode:info.State.ExitCode,oomKilled:info.State.OOMKilled,startError:Boolean(info.State.Error),attachCode,uploadFailed}});
   if(uploadFailed)throw Error('backup.verifier_input');
   if(info.State.ExitCode===74)throw Error('backup.verifier_timeout');
   if(info.State.ExitCode!==0)throw Error('backup.verifier_failed');
   try{return JSON.parse(output);}catch{throw Error('backup.verifier_output');}
  }catch(error){
   if(failure)throw Error(failure);
   throw error;
  }finally{
   clearTimeout(timer);signal.removeEventListener('abort',abort);
   try{if(created||!options.controller)await (removal??removeOwned(name));}finally{child?.kill('SIGKILL');await attached;}
  }
 };
}

export {createBoundContainerWaitronVerifier,type DataRestoreVerifier,type VerifiedChildOutput} from './bound-container-verifier.ts';
