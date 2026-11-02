import {createHash,createPublicKey,type KeyObject} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import {isAbsolute,join,normalize} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {verifyManifest,type ManifestEnvelope} from './manifest.ts';
import {signTrafficLifecycle,trafficManifestDigest,verifyTrafficLifecycle,type TrafficLifecycle} from './traffic-lifecycle.ts';
import {verifyTrafficReport} from './traffic-report.ts';
import type {TrafficSpool} from './traffic-spool.ts';

interface Options {directory:string;country:'ES';environment:'test';cellId:string;issuerKey:KeyObject;reporterKey:KeyObject}
interface Preparation {manifest:ManifestEnvelope;processId:string;startedAt:string;predecessorId:string|null}
interface Saved {manifest:ManifestEnvelope;start:ManifestEnvelope;end:ManifestEnvelope|null}
function unavailable():never{throw new Error('traffic_child_journal_unavailable');}
const missing=(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT';
const digest=(e:ManifestEnvelope)=>createHash('sha256').update(JSON.stringify(e)).digest('hex')+'\n';
const object=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');

/** Immutable files retain exact retries. An interrupted write refuses recovery rather than closing an unknown lifetime. */
export class TrafficChildJournal {
 readonly #options:Options;readonly #publicKey:KeyObject;#pending:Promise<void>=Promise.resolve();#identity:string|undefined;
 constructor(options:Options){
  try{
   if(options.country!=='ES'||options.environment!=='test'||!isAbsolute(options.directory)||normalize(options.directory)!==options.directory
    ||options.reporterKey.type!=='private'||options.reporterKey.asymmetricKeyType!=='ed25519')unavailable();
   this.#publicKey=createPublicKey(options.reporterKey);
   if(this.#publicKey.export({type:'spki',format:'der'}).equals(options.issuerKey.export({type:'spki',format:'der'})))unavailable();
   this.#options={...options};
  }catch{unavailable();}
 }
 async #ready(){
  try{await mkdir(this.#options.directory,{mode:0o700});}catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='EEXIST')throw e;}
  await this.#checkDirectory();
 }
 async #checkDirectory(){
  const s=await lstat(this.#options.directory,{bigint:true}),identity=`${s.dev}:${s.ino}`;
  if(!s.isDirectory()||s.uid!==BigInt(process.geteuid!())||(s.mode&0o7777n)!==0o700n||await realpath(this.#options.directory)!==this.#options.directory
   ||this.#identity!==undefined&&this.#identity!==identity)unavailable();
  this.#identity=identity;
 }
 async #sync(){await this.#checkDirectory();const d=await open(this.#options.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await d.sync();}finally{await d.close();}await this.#checkDirectory();}
 async #read(name:string):Promise<string|undefined>{
  await this.#checkDirectory();
  let f;try{f=await open(join(this.#options.directory,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if(missing(e))return;throw e;}
  try{
   const before=await f.stat({bigint:true});
   if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.geteuid!())||(before.mode&0o7777n)!==0o600n||before.size>131072n)unavailable();
   const bytes=Buffer.alloc(131073);let size=0;
   while(size<bytes.length){const r=await f.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
   const after=await lstat(join(this.#options.directory,name),{bigint:true});
   if(size>131072||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)unavailable();
   await f.sync();await this.#checkDirectory();return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));
  }finally{await f.close();}
 }
 async #create(name:string,text:string){
  await this.#checkDirectory();
  if(Buffer.byteLength(text)>131072)unavailable();
  let f;
  try{f=await open(join(this.#options.directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='EEXIST')throw e;if(await this.#read(name)!==text)unavailable();await this.#sync();return;}
  try{await f.writeFile(text);await f.sync();}finally{await f.close();}await this.#sync();
 }
 #run<T>(operation:()=>Promise<T>):Promise<T>{
  const next=this.#pending.then(async()=>{try{await this.#ready();return await operation();}catch{return unavailable();}});
  this.#pending=next.then(()=>{},()=>{});return next;
 }
 #start(input:Preparation):TrafficLifecycle {
  const manifest=verifyManifest(input.manifest,this.#options.issuerKey,this.#options.cellId,Date.parse(input.startedAt));
  if(manifest.version!==2)unavailable();
  return {version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId:manifest.cellId,gatewayId:manifest.reporter.gatewayId,generation:manifest.reporter.generation,
   processId:input.processId,manifestDigest:trafficManifestDigest(manifest),startedAt:input.startedAt,predecessorId:input.predecessorId,endedAt:null,finalSequence:null};
 }
 async #load():Promise<Saved|undefined>{
  const [raw,endRaw,startAck,endAck]=await Promise.all(['prepared.json','end.json','start.ack','end.ack'].map(name=>this.#read(name)));
  if(raw===undefined){if(endRaw!==undefined||startAck!==undefined||endAck!==undefined)unavailable();return;}
  const value:unknown=JSON.parse(raw);if(!object(value,['version','manifest','start'])||value.version!==1)unavailable();
  const start=verifyTrafficLifecycle(value.start,this.#publicKey);
  const expected=this.#start({manifest:value.manifest as ManifestEnvelope,processId:start.processId,startedAt:start.startedAt,predecessorId:start.predecessorId});
  if(!isDeepStrictEqual(start,expected))unavailable();
  const saved:Saved={manifest:value.manifest as ManifestEnvelope,start:value.start as ManifestEnvelope,end:null};
  if(endRaw!==undefined){
   const envelope:unknown=JSON.parse(endRaw),end=verifyTrafficLifecycle(envelope,this.#publicKey);
   if(!isDeepStrictEqual(end,{...start,kind:'end',endedAt:end.endedAt,finalSequence:end.finalSequence})||end.kind!=='end')unavailable();
   saved.end=envelope as ManifestEnvelope;
  }
  if(startAck!==undefined&&startAck!==digest(saved.start)||endAck!==undefined&&(!saved.end||startAck===undefined||endAck!==digest(saved.end)))unavailable();
  return saved;
 }
 prepare(input:Preparation):Promise<ManifestEnvelope>{
  let snapshot:Preparation,start:ManifestEnvelope;
  try{snapshot=structuredClone(input);start=signTrafficLifecycle(this.#start(snapshot),this.#options.reporterKey);}catch{return Promise.reject(new Error('traffic_child_journal_unavailable'));}
  return this.#run(async()=>{
   const saved=await this.#load();if(saved&&(!isDeepStrictEqual(saved.start,start)||!isDeepStrictEqual(saved.manifest,snapshot.manifest)))unavailable();
   await this.#create('prepared.json',JSON.stringify({version:1,manifest:snapshot.manifest,start}));return structuredClone(start);
  });
 }
 restore():Promise<Saved|undefined>{return this.#run(()=>this.#load());}
 /** A durable, non-reusable claim prevents two supervisors from spawning the same signed identity. */
 claimSpawn():Promise<void>{
  return this.#run(async()=>{
   const saved=await this.#load();if(!saved||saved.end)unavailable();
   const file=await open(join(this.#options.directory,'spawn.claim'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await file.writeFile(digest(saved.start));await file.sync();}finally{await file.close();}
   await this.#sync();
  });
 }
 finish(spool:TrafficSpool,until:string):Promise<ManifestEnvelope>{
  return this.#run(async()=>{
   const saved=await this.#load();if(!saved)unavailable();
   if(saved.end){if(verifyTrafficLifecycle(saved.end,this.#publicKey).endedAt!==until)unavailable();return saved.end;}
   const start=verifyTrafficLifecycle(saved.start,this.#publicKey),cursor=await spool.cursor();
   if(!cursor||!cursor.complete||cursor.processId!==start.processId||cursor.until!==until)unavailable();
   // Close before transferring the final envelope: acknowledged counters alone cannot authenticate its reporter.
   const pending=await spool.pending(),last=pending.at(-1);if(!last)unavailable();
   const final=verifyTrafficReport(last,this.#publicKey);
   if(final.cellId!==start.cellId||final.gatewayId!==start.gatewayId||final.generation!==start.generation||final.processId!==start.processId
    ||final.sequence!==cursor.sequence||final.until!==until||final.from<start.startedAt||!final.complete)unavailable();
   const end=signTrafficLifecycle({...start,kind:'end',endedAt:until,finalSequence:cursor.sequence},this.#options.reporterKey);
   await this.#create('end.json',JSON.stringify(end));return end;
  });
 }
 async #unacknowledged(saved:Saved):Promise<ManifestEnvelope[]>{
  const pending:ManifestEnvelope[]=[];
  if(await this.#read('start.ack')===undefined)pending.push(saved.start);
  if(saved.end&&await this.#read('end.ack')===undefined)pending.push(saved.end);
  return pending;
 }
 pending():Promise<ManifestEnvelope[]>{return this.#run(async()=>{const saved=await this.#load();return saved?this.#unacknowledged(saved):[];});}
 flush(record:(envelope:ManifestEnvelope)=>Promise<void>):Promise<void>{
  return this.#run(async()=>{
   const saved=await this.#load();if(!saved)return;
   for(const envelope of await this.#unacknowledged(saved)){
    const kind=verifyTrafficLifecycle(envelope,this.#publicKey).kind;
    await record(structuredClone(envelope));
    const current=await this.#load();
    if(!current||!isDeepStrictEqual(kind==='start'?current.start:current.end,envelope))unavailable();
    await this.#create(`${kind}.ack`,digest(envelope));
   }
  });
 }
}
