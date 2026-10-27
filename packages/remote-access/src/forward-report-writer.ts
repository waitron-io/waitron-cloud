import {createHash,createPublicKey,type KeyObject} from 'node:crypto';
import {constants} from 'node:fs';
import {open,realpath,rename,unlink} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {isUuid,type ManifestEnvelope} from './manifest.ts';
import {signForwardReport,verifyForwardReport,type ForwardBinding,type ForwardCause,type ForwardObservation,type ForwardReport} from './forward-report.ts';
interface Options {directory:string;key:KeyObject;cellId:string;gatewayId:string;generation:number;readerGid:number;now?:()=>number}
interface Entry {binding:ForwardBinding;completed:number;observation?:ForwardObservation}
interface Marker {cellId:string;gatewayId:string;generation:number;key:string}
const unavailable=()=>new Error('forward_report_unavailable');
const missing=(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT';
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
function bindingCopy(b:ForwardBinding):ForwardBinding {
 return {cellId:b.cellId,gatewayId:b.gatewayId,generation:b.generation,installationId:b.installationId,venueId:b.venueId,revision:b.revision,
  routeId:b.routeId,routeBinding:b.routeBinding,manifestSequence:b.manifestSequence,manifestExpiresAt:b.manifestExpiresAt};
}
/** A single writer owns this directory; callers never await file I/O on the forwarding path. */
export class ForwardReportWriter {
 readonly #options:Options;readonly #marker:Marker;readonly #now:()=>number;
 #ready=false;#published=false;#busy=false;#entries=new Map<string,Entry>();#attempt=0;#sequence=0;#lastPublication=-Infinity;#dirty=false;
 constructor(options:Options){
  if(!isAbsolute(options.directory)||!isUuid(options.cellId)||!isUuid(options.gatewayId)||!Number.isSafeInteger(options.generation)||options.generation<1
   ||!Number.isSafeInteger(options.readerGid)||options.readerGid<0||options.key.type!=='private'||options.key.asymmetricKeyType!=='ed25519')throw unavailable();
  this.#options={...options};this.#now=options.now??Date.now;
  this.#marker={cellId:options.cellId,gatewayId:options.gatewayId,generation:options.generation,
   key:createHash('sha256').update(createPublicKey(options.key).export({type:'spki',format:'der'})).digest('hex')};
 }
 async #directory(){
  const directory=this.#options.directory;if(await realpath(directory)!==directory)throw unavailable();
  const file=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{
   const s=await file.stat();if(!s.isDirectory()||s.uid!==process.geteuid!()||s.gid!==this.#options.readerGid||(s.mode&0o7777)!==0o2750)throw unavailable();
  }finally{await file.close();}
 }
 async #read(name:string,mode:number|number[]):Promise<string|undefined>{
  let file;try{file=await open(join(this.#options.directory,name),constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);}catch(error){if(missing(error))return;throw error;}
  try{const s=await file.stat();if(!s.isFile()||s.nlink!==1||s.uid!==process.geteuid!()||s.gid!==this.#options.readerGid||(Array.isArray(mode)?!mode.includes(s.mode&0o7777):(s.mode&0o7777)!==mode)||s.size>262144)throw unavailable();
   return await file.readFile('utf8');
  }finally{await file.close();}
 }
 async #atomic(name:string,text:string,mode:number){
  if(Buffer.byteLength(text)>262144)throw unavailable();await this.#read(name,mode);
  const temporary=join(this.#options.directory,name+'.tmp');
  const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode);
  try{await file.chmod(mode);await file.writeFile(text);await file.sync();}finally{await file.close();}
  await rename(temporary,join(this.#options.directory,name));
  const directory=await open(this.#options.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await directory.sync();}finally{await directory.close();}
 }
 async restore(now:number):Promise<void>{
  this.#ready=false;
  try{
   if(!Number.isSafeInteger(now)||now<0)throw unavailable();await this.#directory();
   const rawMarker=await this.#read('initialized.json',0o600),rawReport=await this.#read('report.json',0o640);
   const markerTemporary=await this.#read('initialized.json.tmp',0o600);
   if(rawMarker===undefined){
    if(rawReport!==undefined)throw unavailable();
    if(markerTemporary!==undefined)await unlink(join(this.#options.directory,'initialized.json.tmp'));
    await this.#atomic('initialized.json',JSON.stringify({...this.#marker,published:false}),0o600);
   }else{
    const marker=JSON.parse(rawMarker) as Marker&{published:boolean};
    if(!marker||Object.keys(marker).sort().join(',')!=='cellId,gatewayId,generation,key,published'||typeof marker.published!=='boolean')throw unavailable();
    const {published,...identity}=marker;
    if(!same(identity,this.#marker)){
     // Only a trusted higher generation with a fresh key may reset a known stream.
     if(marker.cellId!==this.#marker.cellId||!isUuid(marker.gatewayId)||!Number.isSafeInteger(marker.generation)||marker.generation<1
      ||this.#marker.generation<=marker.generation||!/^[a-f0-9]{64}$/.test(marker.key)||marker.key===this.#marker.key)throw unavailable();
     if(rawReport!==undefined)await unlink(join(this.#options.directory,'report.json'));
     if(markerTemporary!==undefined)await unlink(join(this.#options.directory,'initialized.json.tmp'));
     await this.#atomic('initialized.json',JSON.stringify({...this.#marker,published:false}),0o600);
    }else{
     this.#published=published;
     // Mark publication before creating the first report so deletion cannot resemble an idle stream.
     if(published&&rawReport===undefined||!published&&rawReport!==undefined)throw unavailable();
     if(rawReport!==undefined){
      const envelope=JSON.parse(rawReport) as ManifestEnvelope;
      const issuedAt=JSON.parse(Buffer.from(envelope.payload,'base64url').toString()).issuedAt;
      const report=verifyForwardReport(envelope,createPublicKey(this.#options.key),issuedAt);
      if(report.cellId!==this.#marker.cellId||report.gatewayId!==this.#marker.gatewayId||report.generation!==this.#marker.generation||report.issuedAt>now)throw unavailable();
      this.#sequence=report.sequence;this.#lastPublication=report.issuedAt;
      for(const o of report.observations){
       if(o.expiresAt<=now){this.#dirty=true;continue;}
       this.#entries.set(o.installationId,{binding:bindingCopy(o),completed:0,observation:o});
      }
     }
     if(markerTemporary!==undefined)await unlink(join(this.#options.directory,'initialized.json.tmp'));
    }
   }
   const temporary=await this.#read('report.json.tmp',[0o640,0o600]);
   if(temporary!==undefined)await unlink(join(this.#options.directory,'report.json.tmp'));
   this.#ready=true;
  }catch{this.#entries.clear();throw unavailable();}
 }
 begin(binding:ForwardBinding,startedAt:number):(category:ForwardCause|null,observedAt:number)=>void {
  const none=()=>{};
  if(!this.#ready||binding.cellId!==this.#marker.cellId||binding.gatewayId!==this.#marker.gatewayId||binding.generation!==this.#marker.generation
   ||!Number.isSafeInteger(startedAt)||startedAt<0||startedAt>=binding.manifestExpiresAt)return none;
  let entry=this.#entries.get(binding.installationId);
  const copy=bindingCopy(binding);
  if(!entry||!same(entry.binding,copy)){
   if(!entry&&this.#entries.size>=64)return none;
   if([...this.#entries.values()].some(other=>other!==entry&&other.binding.venueId===copy.venueId))return none;
   entry={binding:copy,completed:0,observation:entry?.observation};this.#entries.set(copy.installationId,entry);
  }
  const slot=entry,ordinal=++this.#attempt;let completed=false;
  return (category,observedAt)=>{
   if(completed)return;completed=true;
   const now=this.#now();
   if(!this.#ready||this.#entries.get(copy.installationId)!==slot||ordinal<=slot.completed||!Number.isSafeInteger(observedAt)
    ||observedAt<startedAt||observedAt>now+5000||now>=copy.manifestExpiresAt||observedAt>=copy.manifestExpiresAt||copy.manifestExpiresAt>observedAt+600000)return;
   slot.completed=ordinal;slot.observation={...copy,observationSequence:0,category,observedAt,expiresAt:Math.min(observedAt+300000,copy.manifestExpiresAt)};this.#dirty=true;
  };
 }
 async flush(now:number):Promise<void>{
  if(!this.#ready||this.#busy||!Number.isSafeInteger(now)||now<0||now-this.#lastPublication<30000)return;
  this.#busy=true;
  try{
   for(const [id,entry] of this.#entries){if(entry.binding.manifestExpiresAt<=now||entry.observation&&entry.observation.expiresAt<=now){if(entry.observation)this.#dirty=true;this.#entries.delete(id);}}
   if(!this.#dirty)return;
   // Clock skew must defer unrepresentable evidence without disabling future reporting.
   if([...this.#entries.values()].some(entry=>entry.observation&&entry.observation.observedAt>now+5000))return;
   const sequence=this.#sequence+1;
   const snapshot=[...this.#entries.values()].flatMap(entry=>entry.observation?[{entry,original:entry.observation,value:{...entry.observation,observationSequence:entry.observation.observationSequence||sequence}}]:[]);
   const report:ForwardReport={version:1,audience:'waitron-cloud-public-forward-report',cellId:this.#marker.cellId,gatewayId:this.#marker.gatewayId,generation:this.#marker.generation,sequence,issuedAt:now,observations:snapshot.map(o=>o.value)};
   const text=JSON.stringify(signForwardReport(report,this.#options.key));
   await this.#directory();
   if(!this.#published){await this.#atomic('initialized.json',JSON.stringify({...this.#marker,published:true}),0o600);this.#published=true;}
   await this.#atomic('report.json',text,0o640);
   this.#sequence=sequence;this.#lastPublication=now;this.#dirty=false;
   for(const item of snapshot){if(item.entry.observation===item.original)item.entry.observation=item.value;}
   // A completion during fsync belongs to the next bounded snapshot.
   if([...this.#entries.values()].some(entry=>entry.observation?.observationSequence===0))this.#dirty=true;
  }catch{this.#ready=false;this.#entries.clear();}
  finally{this.#busy=false;}
 }
}
