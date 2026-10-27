import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {readBackupVerificationRequest,readBackupVerificationResult,type BackupVerificationRequest} from './verification-protocol.ts';
const memoryEventNames=['low','high','max','oom','oom_kill','oom_group_kill'] as const;
function memoryEvents(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const result:Record<string,number>={};
 for(const key of memoryEventNames){
  const count=(value as Record<string,unknown>)[key];
  if(count===undefined)continue;
  if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0)return null;
  result[key]=count;
 }
 return Object.keys(result).length?result:null;
}
export function readVerifierMemoryEvents(){
 try{
  const text=readFileSync('/sys/fs/cgroup/memory.events','utf8'),values:Record<string,number>={};
  if(text.length>4096)return null;
  for(const line of text.trim().split('\n')){
   const [key,count,...extra]=line.trim().split(/\s+/);
   if(!key||!memoryEventNames.includes(key as typeof memoryEventNames[number]))continue;
   if(extra.length||!/^\d+$/.test(count??'')||Object.hasOwn(values,key))return null;
   values[key]=Number(count);
  }
  return memoryEvents(values);
 }catch{return null;}
}
export function verifierResourceDiagnostic(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const raw=value as Record<string,any>,detail=raw.child;
 const pid=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:null;
 const child=detail&&pid(detail.childPid)!==null&&(detail.childExitCode===null||Number.isInteger(detail.childExitCode)&&detail.childExitCode>=0&&detail.childExitCode<=255)&&(detail.childSignal===null||['SIGKILL','SIGABRT','SIGXCPU','SIGXFSZ'].includes(detail.childSignal))&&['fatalHeap','scratchFull','fileLimit'].every(key=>typeof detail[key]==='boolean')?
  {childPid:detail.childPid,childExitCode:detail.childExitCode,childSignal:detail.childSignal,fatalHeap:detail.fatalHeap,scratchFull:detail.scratchFull,fileLimit:detail.fileLimit}:null;
 return {entryPid:pid(raw.entryPid),entryReason:['scratch_full','child_resource'].includes(raw.entryReason)?raw.entryReason:null,child,memoryBefore:memoryEvents(raw.memoryBefore),memoryAfter:memoryEvents(raw.memoryAfter)};
}
export function readVerifierResourceDiagnostic(text:string){
 // Container output is advisory: only Docker state decides the resource refusal.
 const prefix='backup.verifier_resource_detail ';
 const line=text.split('\n').findLast(line=>line.startsWith(prefix));
 if(!line)return null;
 try{return verifierResourceDiagnostic(JSON.parse(line.slice(prefix.length)));}catch{return null;}
}
function fatalHeapDetector(){
 const prefix='fatal error: ';
 let matched=0,fatalLine=false,tail='',found=false;
 return (text:string)=>{
  if(found)return true;
  for(const character of text){
   if(character==='\n'){matched=0;fatalLine=false;tail='';continue;}
   if(!fatalLine){
    if(matched>=0){
     if(character.toLowerCase()!==prefix[matched])matched=-1;
     else if(++matched===prefix.length)fatalLine=true;
    }
   }else if(character==='\r'){fatalLine=false;matched=-1;tail='';}
   else{
    // The longest heap phrase is 18 characters; retain its boundary without rescanning the line.
    tail=(tail+character).slice(-18);
    if(/heap out of memory|heap limit/i.test(tail)){found=true;return true;}
   }
  }
  return false;
 };
}
interface VerifierLimits {cpuSeconds?:number;maxFileBytes?:number;maxOpenFiles?:number;heapMiB?:number;}
export async function runNodeVerifier(args:string[],options:{input?:unknown;inputStream?:AsyncIterable<Uint8Array>;boundRequest?:BackupVerificationRequest;timeoutMs?:number;signal?:AbortSignal;cwd?:string;readablePaths?:string[];writablePaths?:string[];allowWorker?:boolean;limits?:VerifierLimits}):Promise<unknown>{
 const timeout=options.timeoutMs??30000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>30000)throw Error('backup.verifier_configuration');
 if(!process.allowedNodeEnvironmentFlags.has('--allow-net'))throw Error('backup.verifier_configuration');
 if(args.some(arg=>/^--(?:(?:experimental-)?permission|allow-)/.test(arg)))throw Error('backup.verifier_configuration');
 const cpuSeconds=options.limits?.cpuSeconds??25,maxFileBytes=options.limits?.maxFileBytes??512*1024*1024,maxOpenFiles=options.limits?.maxOpenFiles??128,heapMiB=options.limits?.heapMiB??512;
 if(!Number.isInteger(cpuSeconds)||cpuSeconds<1||cpuSeconds>30||!Number.isInteger(maxFileBytes)||maxFileBytes<512||maxFileBytes>512*1024*1024||!Number.isInteger(maxOpenFiles)||maxOpenFiles<32||maxOpenFiles>128||!Number.isInteger(heapMiB)||heapMiB<16||heapMiB>512)throw Error('backup.verifier_configuration');
 let input:string|undefined;
 try{
  if(options.inputStream){if(options.input!==undefined||typeof options.inputStream[Symbol.asyncIterator]!=='function')throw Error();}
  else{input=JSON.stringify(options.input);if(!input||Buffer.byteLength(input)>65536)throw Error();}
  if(options.boundRequest)options={...options,boundRequest:readBackupVerificationRequest(JSON.stringify(options.boundRequest))};
 }catch{throw Error('backup.verifier_input');}
 if(options.signal?.aborted)throw Error('backup.verifier_cancelled');
 return new Promise((resolve,reject)=>{
  const permissions=['--permission',...(options.readablePaths??[]).map(path=>'--allow-fs-read='+path),...(options.writablePaths??[]).map(path=>'--allow-fs-write='+path),...(options.allowWorker?['--allow-worker']:[])];
  const nodeArgs=['--max-old-space-size='+heapMiB,...permissions,...args];
  const limits='ulimit -c 0; ulimit -t "$1"; ulimit -f "$2"; ulimit -n "$3"; shift 3; exec "$@"';
  // macOS sh measures `ulimit -f` in KiB; Linux sh uses 512-byte blocks.
  const fileLimitUnit=process.platform==='darwin'?1024:512;
  const child=spawn('/bin/sh',['-c',limits,'verifier-limits',String(cpuSeconds),String(Math.ceil(maxFileBytes/fileLimitUnit)),String(maxOpenFiles),process.execPath,...nodeArgs],{cwd:options.cwd,env:{TSX_DISABLE_CACHE:'1'},detached:true,stdio:['pipe','pipe','pipe']});
  let output:Buffer[]=[],errors='',size=0,outputSize=0,failure:string|undefined,closed=false,inputSource:Readable|undefined;
  let upload:Promise<void>|undefined;
  const detectsFatalHeap=fatalHeapDetector();
  const kill=()=>{if(closed)return;try{if(child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* The process may already have exited. */}};
  const fail=(code:string)=>{failure??=code;kill();inputSource?.destroy();};
  const abort=()=>fail('backup.verifier_cancelled');options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>fail('backup.verifier_timeout'),timeout);
  const collect=(bytes:Buffer,stdout:boolean)=>{
   size+=bytes.length;if(stdout)outputSize+=bytes.length;
   if(size>65536||options.boundRequest&&outputSize>32768){fail('backup.verifier_output');return;}
   if(stdout)output.push(bytes);else{
    const text=bytes.toString('utf8');errors+=text;
    // Fatal heap exhaustion is final; kernel crash collection can delay process exit past the watchdog.
    if(detectsFatalHeap(text))fail('backup.verifier_resource');
   }
  };
  child.stdout.on('data',bytes=>collect(bytes,true));child.stderr.on('data',bytes=>collect(bytes,false));
  child.on('error',()=>fail('backup.verifier_failed'));child.stdin.on('error',()=>fail('backup.verifier_input'));
  // Wait for process close after killing it; callers may then remove the private restore directory.
  child.on('close',async(code,signal)=>{
   kill();closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   inputSource?.destroy();await upload;
   const resourceSignal=signal==='SIGXCPU'||signal==='SIGXFSZ'||signal==='SIGKILL'||signal==='SIGABRT';
   // Node reports macOS file-limit failures as EFBIG and V8 heap exhaustion in stderr before exiting.
   const resourceError=/\b(?:EFBIG|ENOSPC)\b|heap out of memory|reached heap limit|ineffective mark-compacts near heap limit/i.test(errors);
   if(failure||code!==0){
    const reason=failure??(resourceSignal||resourceError?'backup.verifier_resource':'backup.verifier_failed');
    reject(Error(reason,reason==='backup.verifier_resource'?{cause:{childPid:child.pid??null,childExitCode:code,childSignal:signal,fatalHeap:failure==='backup.verifier_resource',scratchFull:/\bENOSPC\b/.test(errors),fileLimit:/\bEFBIG\b/.test(errors)}}:undefined));return;
   }
   try{
    const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(output));
    resolve(options.boundRequest?readBackupVerificationResult(raw,options.boundRequest):JSON.parse(raw));
   }catch{reject(Error('backup.verifier_output'));}
  });
  if(options.inputStream){
   inputSource=Readable.from(options.inputStream);
   upload=pipeline(inputSource,child.stdin).catch(()=>{fail('backup.verifier_input');});
  }else child.stdin.end(input);
  if(options.signal?.aborted)abort();
 });
}
