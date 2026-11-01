import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,realpath,rename,unlink} from 'node:fs/promises';
import {isAbsolute,join,normalize} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {isUuid,type ManifestEnvelope} from './manifest.ts';
import {trafficDelta,type TrafficCounter} from './traffic-counters.ts';
import {trafficEnvelopeReport,validateTrafficReport,type TrafficReport} from './traffic-report.ts';

interface State {
 version:1;processId:string;sequence:number;until:string;complete:boolean;lastDigest:string;
 counters:[string,TrafficCounter][];pending:ManifestEnvelope[];
}
interface Options {directory:string;maxBytes:number}
function unavailable():never{throw new Error('traffic_spool_unavailable');}
const missing=(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT';
function object(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function counterEntries(counters:ReadonlyMap<string,TrafficCounter>):[string,TrafficCounter][] {
 if(counters.size>128)unavailable();const result:[string,TrafficCounter][]=[];
 for(const [name,c] of counters){
  if(typeof name!=='string'||!name||name.length>256||!object(c,['ingress','egress']))unavailable();
  trafficDelta(c,c);result.push([name,{ingress:c.ingress,egress:c.egress}]);
 }
 return result.sort(([a],[b])=>a<b?-1:a>b?1:0);
}
function stateValue(value:unknown):State {
 if(!object(value,['version','processId','sequence','until','complete','lastDigest','counters','pending'])||value.version!==1||!isUuid(value.processId)
  ||!Number.isSafeInteger(value.sequence)||Number(value.sequence)<1||typeof value.until!=='string'||!Number.isFinite(Date.parse(value.until))
  ||new Date(value.until).toISOString()!==value.until||typeof value.complete!=='boolean'||typeof value.lastDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.lastDigest)
  ||!Array.isArray(value.counters)||value.counters.length>128||!Array.isArray(value.pending))unavailable();
 const counters=new Map<string,TrafficCounter>();
 for(const entry of value.counters){if(!Array.isArray(entry)||entry.length!==2||counters.has(entry[0]))unavailable();counters.set(entry[0],entry[1]);}
 counterEntries(counters);let previous=0;
 for(const envelope of value.pending){const r=trafficEnvelopeReport(envelope);
  if(r.processId!==value.processId||r.sequence<=previous||r.sequence>Number(value.sequence)||r.until>value.until)unavailable();previous=r.sequence;
 }
 return value as unknown as State;
}
function digest(envelope:ManifestEnvelope,counters:[string,TrafficCounter][]):string {
 return createHash('sha256').update(JSON.stringify([envelope.payload,envelope.signature,counters])).digest('hex');
}
/**
 * Cursor and pending envelopes share one checkpoint, so neither can advance alone.
 * maxBytes bounds that checkpoint; atomic writes and one retained partial write need at most three copies.
 */
export class TrafficSpool {
 readonly #directory:string;readonly #maxBytes:number;
 constructor(options:Options){
  if(!isAbsolute(options.directory)||normalize(options.directory)!==options.directory||!Number.isSafeInteger(options.maxBytes)||options.maxBytes<1024||options.maxBytes>67108864)unavailable();
  this.#directory=options.directory;this.#maxBytes=options.maxBytes;
 }
 async #directoryReady(){
  try{await mkdir(this.#directory,{mode:0o700});}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='EEXIST')throw error;}
  if(await realpath(this.#directory)!==this.#directory)unavailable();
  const d=await open(this.#directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const s=await d.stat();if(s.uid!==process.geteuid!()||(s.mode&0o7777)!==0o700)unavailable();}finally{await d.close();}
 }
 async #syncDirectory(){const d=await open(this.#directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await d.sync();}finally{await d.close();}}
 async #read(name:string,limit=this.#maxBytes):Promise<string|undefined>{
  let f;try{f=await open(join(this.#directory,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(missing(error))return;throw error;}
  try{
   const s=await f.stat();if(!s.isFile()||s.nlink!==1||s.uid!==process.geteuid!()||(s.mode&0o7777)!==0o600||s.size>limit)unavailable();
   const b=Buffer.alloc(limit+1);let n=0;
   while(n<b.length){const r=await f.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}
   if(n>limit)unavailable();return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n));
  }finally{await f.close();}
 }
 async #create(name:string,text:string){
  const f=await open(join(this.#directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(text);await f.sync();}finally{await f.close();}
  await this.#syncDirectory();
 }
 async #gap(){
  try{await this.#create('gap','incomplete\n');}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='EEXIST')throw error;if(await this.#read('gap',16)!=='incomplete\n')unavailable();}
 }
 async #lease():Promise<()=>Promise<void>>{
  const owner=randomUUID(),text=JSON.stringify({pid:process.pid,owner});
  for(let attempt=0;attempt<2;attempt++){
   // A recovery lease serializes dead-writer cleanup; a crashed recovery itself fails closed.
   if(await this.#read('recovery.json',1024)!==undefined)unavailable();
   try{
    await this.#create('lease.json',text);
    if(await this.#read('recovery.json',1024)!==undefined){await unlink(join(this.#directory,'lease.json'));unavailable();}
    return async()=>{if(await this.#read('lease.json',1024)!==text)unavailable();await unlink(join(this.#directory,'lease.json'));await this.#syncDirectory();};
   }catch(error){
    if(!error||typeof error!=='object'||!('code'in error)||error.code!=='EEXIST')throw error;
    await this.#create('recovery.json',text);
    try{
     const raw=await this.#read('lease.json',1024);if(raw===undefined)continue;
     const held:unknown=JSON.parse(raw);
     if(!object(held,['pid','owner'])||!Number.isSafeInteger(held.pid)||Number(held.pid)<1||typeof held.owner!=='string')unavailable();
     let dead=false;try{process.kill(Number(held.pid),0);}catch(cause){dead=!!cause&&typeof cause==='object'&&'code'in cause&&cause.code==='ESRCH';}
     if(!dead)unavailable();await this.#gap();await unlink(join(this.#directory,'lease.json'));await this.#syncDirectory();
    }finally{await unlink(join(this.#directory,'recovery.json'));await this.#syncDirectory();}
   }
  }
  return unavailable();
 }
 async #locked<T>(fn:()=>Promise<T>):Promise<T>{
  try{
   await this.#directoryReady();const release=await this.#lease();
   try{return await fn();}catch{await this.#gap();return unavailable();}finally{await release();}
  }catch{return unavailable();}
 }
 async #load():Promise<State|undefined>{
  const raw=await this.#read('checkpoint.json'),temporary=await this.#read('checkpoint.tmp');let state=raw===undefined?undefined:stateValue(JSON.parse(raw));
  if(temporary!==undefined){
   await this.#gap();let recovered:State|undefined;
   try{recovered=stateValue(JSON.parse(temporary));}catch{/* An unpublished partial write never advances the committed cursor. */}
   if(recovered){
    if(state&&(recovered.processId!==state.processId||recovered.sequence<state.sequence||recovered.sequence>state.sequence+1))unavailable();
    const checkpoint=await open(join(this.#directory,'checkpoint.tmp'),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{await checkpoint.sync();}finally{await checkpoint.close();}
    await rename(join(this.#directory,'checkpoint.tmp'),join(this.#directory,'checkpoint.json'));state=recovered;
   }else{
    if(await this.#read('interrupted.json')!==undefined)unavailable();
    await rename(join(this.#directory,'checkpoint.tmp'),join(this.#directory,'interrupted.json'));
   }
   await this.#syncDirectory();
  }
  const initialized=await this.#read('initialized',16);
  // Publication intent survives a lost checkpoint, which must never resemble an unused directory.
  if(initialized!==undefined&&initialized!=='traffic-v1\n'||!!state!==(initialized!==undefined)){await this.#gap();unavailable();}
  return state;
 }
 async #publish(state:State){
  const text=JSON.stringify(state);if(Buffer.byteLength(text)>this.#maxBytes)unavailable();
  if(await this.#read('initialized',16)===undefined)await this.#create('initialized','traffic-v1\n');
  await this.#create('checkpoint.tmp',text);
  await rename(join(this.#directory,'checkpoint.tmp'),join(this.#directory,'checkpoint.json'));await this.#syncDirectory();
 }
 async append(report:TrafficReport,envelope:ManifestEnvelope,counters:ReadonlyMap<string,TrafficCounter>):Promise<void>{
  // Snapshot before the first await: callers may reuse mutable sampling buffers immediately.
  let r:TrafficReport,e:ManifestEnvelope,entries:[string,TrafficCounter][];
  try{validateTrafficReport(report);r=JSON.parse(JSON.stringify(report));e={...envelope};
   if(!isDeepStrictEqual(r,trafficEnvelopeReport(e)))unavailable();
   entries=counterEntries(counters);
  }catch{return unavailable();}
  return this.#locked(async()=>{
   const previous=await this.#load(),lastDigest=digest(e,entries);
   if(previous){
    if(previous.processId!==r.processId)unavailable();
    if(r.sequence===previous.sequence){if(lastDigest!==previous.lastDigest)unavailable();return;}
    if(r.sequence!==previous.sequence+1||r.from<previous.until)unavailable();
   }else if(r.sequence!==1)unavailable();
   const complete=r.complete&&(!previous||previous.complete&&r.from===previous.until);
   await this.#publish({version:1,processId:r.processId,sequence:r.sequence,until:r.until,complete,lastDigest,counters:entries,pending:[...previous?.pending??[],e]});
  });
 }
 async pending():Promise<ManifestEnvelope[]>{return this.#locked(async()=>structuredClone((await this.#load())?.pending??[]));}
 async ack(processId:string,sequence:number):Promise<void>{
  return this.#locked(async()=>{
   const state=await this.#load();if(!state||processId!==state.processId||!Number.isSafeInteger(sequence)||sequence<1||sequence>state.sequence)unavailable();
   const pending=state.pending.filter(e=>trafficEnvelopeReport(e).sequence!==sequence);if(pending.length===state.pending.length)return;
   await this.#publish({...state,pending});
  });
 }
 async restore():Promise<{processId:string;sequence:number;counters:Map<string,TrafficCounter>;complete:boolean}>{
  // Local continuity is not trial coverage: the country route/process journal must also cover unsampled tails.
  try{return await this.#locked(async()=>{
   const state=await this.#load(),gap=await this.#read('gap',16);
   if(!state)return {processId:'',sequence:0,counters:new Map(),complete:false};
   return {processId:state.processId,sequence:state.sequence,counters:new Map(state.counters),complete:state.complete&&gap===undefined};
  });}catch{return {processId:'',sequence:0,counters:new Map(),complete:false};}
 }
}
