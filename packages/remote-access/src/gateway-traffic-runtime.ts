import {createPublicKey,type KeyObject} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,opendir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {isUuid,verifyManifest,type ManifestEnvelope} from './manifest.ts';
import {type GatewayTrafficRuntimeOptions} from './gateway-traffic-runtime-options.ts';
import {TrafficChildProcess} from './traffic-child-process.ts';
import {TrafficChildJournal} from './traffic-child-journal.ts';
import {TrafficSpool} from './traffic-spool.ts';
import {sendTrafficLifetime} from './traffic-lifetime-transport.ts';
import {verifyTrafficLifecycle} from './traffic-lifecycle.ts';

interface Start {manifest:ManifestEnvelope;processId:string;startedAt:string;predecessorId:string|null;socket:string;command:string;args:readonly string[]}
interface Entry {journal:TrafficChildJournal;spool:TrafficSpool;child?:TrafficChildProcess;expiresAt?:number}
function unavailable():never{throw new Error('gateway_traffic_unavailable');}

/** Retained bytes confer retry authority only; process ownership never survives this instance. */
export class GatewayTrafficRuntime {
 readonly #options:GatewayTrafficRuntimeOptions;readonly #issuer:KeyObject;readonly #now:()=>number;
 readonly #entries=new Map<string,Entry>();#pending:Promise<void>=Promise.resolve();#ready=false;#stopping=false;#stop:Promise<void>|undefined;
 #identity:string|undefined;#withdrawals=0;
 constructor(options:GatewayTrafficRuntimeOptions,issuer:KeyObject,now:()=>number=Date.now){
  this.#options={...options,mapping:{...options.mapping}};this.#issuer=issuer;this.#now=now;
 }
 #run(operation:()=>Promise<void>):Promise<void>{
  const next=this.#pending.then(async()=>{try{await operation();}catch{unavailable();}});this.#pending=next.catch(()=>{});return next;
 }
 async #private(path:string){
  const s=await lstat(path,{bigint:true});if(!s.isDirectory()||s.uid!==BigInt(process.geteuid!())||(s.mode&0o7777n)!==0o700n||await realpath(path)!==path)unavailable();return `${s.dev}:${s.ino}`;
 }
 async #root(){
  const identity=await this.#private(this.#options.directory);if(this.#identity!==undefined&&identity!==this.#identity)unavailable();this.#identity=identity;
 }
 #entry(home:string):Entry{
  const o=this.#options;
  return {journal:new TrafficChildJournal({directory:join(home,'journal'),country:o.mapping.country,environment:o.mapping.environment,cellId:o.mapping.cellId,issuerKey:this.#issuer,reporterKey:o.reporterKey}),
   spool:new TrafficSpool({directory:join(home,'spool'),maxBytes:o.maxBytes})};
 }
 recover():Promise<void>{
  return this.#run(async()=>{
   if(this.#ready||this.#stopping)unavailable();await this.#root();
   const recovered=new Map<string,Entry>();
   for await(const d of await opendir(this.#options.directory)){
    // Test collection has a finite retained-history budget; exhaustion refuses new children rather than dropping evidence.
    if(!isUuid(d.name)||recovered.size>=128)unavailable();
    const home=join(this.#options.directory,d.name);await this.#private(home);await this.#private(join(home,'journal'));await this.#private(join(home,'spool'));
    const entry=this.#entry(home),saved=await entry.journal.restore();if(!saved)unavailable();
    const start=verifyTrafficLifecycle(saved.start,createPublicKey(this.#options.reporterKey));if(start.processId!==d.name)unavailable();
    if(!saved.end)await entry.spool.markGap();
    recovered.set(d.name,entry);
   }
   await this.#root();for(const [id,entry]of recovered)this.#entries.set(id,entry);this.#ready=true;
  });
 }
 start(input:Start):Promise<void>{
  const start=structuredClone(input),withdrawals=this.#withdrawals;
  return this.#run(async()=>{
   if(!this.#ready||this.#stopping||withdrawals!==this.#withdrawals||!isUuid(start.processId)||this.#entries.has(start.processId)||this.#entries.size>=128)unavailable();await this.#root();
   const manifest=verifyManifest(start.manifest,this.#issuer,this.#options.mapping.cellId,this.#now());
   const home=join(this.#options.directory,start.processId);
   const entry=this.#entry(home);
   const o=this.#options;
   entry.child=new TrafficChildProcess({...start,directory:join(home,'journal'),country:o.mapping.country,environment:o.mapping.environment,cellId:o.mapping.cellId,issuerKey:this.#issuer,reporterKey:o.reporterKey,
    spool:entry.spool,mapping:o.mapping,lifetimeSocket:o.lifetimeSocket,now:this.#now});
   await mkdir(home,{mode:0o700});await this.#private(home);
   await mkdir(join(home,'journal'),{mode:0o700});await mkdir(join(home,'spool'),{mode:0o700});
   // Sync ancestors too: a durable preparation is not recoverable if its new directory name disappears.
   for(const path of [home,this.#options.directory]){
    const d=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await d.sync();}finally{await d.close();}
   }
   await this.#root();
   if(withdrawals!==this.#withdrawals)unavailable();
   entry.expiresAt=manifest.expiresAt;
   this.#entries.set(start.processId,entry);
   try{await entry.child.start();}catch{await entry.child.stop();unavailable();}
  });
 }
 pid(processId:string):number|undefined{return this.#entries.get(processId)?.child?.pid;}
 /** Signalling uses captured handles immediately; persistence still drains through each child's queue. */
 withdraw():Promise<void>{
  this.#withdrawals++;
  return this.#withdraw([...this.#entries.values()]);
 }
 expire():Promise<void>{
  return this.#withdraw([...this.#entries.values()].filter(e=>e.expiresAt!==undefined&&e.expiresAt<=this.#now()));
 }
 async #withdraw(entries:Entry[]):Promise<void>{
  const results=await Promise.allSettled(entries.flatMap(e=>e.child?[e.child.withdraw()]:[]));
  if(results.some(r=>r.status==='rejected'))unavailable();
 }
 tick():Promise<void>{
  return this.#run(async()=>{
   if(!this.#ready||this.#stopping)unavailable();await this.#root();let failed=false;
   for(const entry of this.#entries.values()){
    if(entry.child?.running)try{await entry.child.sample();}catch{failed=true;}
    try{
     if(entry.child)await entry.child.flush();
     else{await entry.journal.flush(e=>sendTrafficLifetime(this.#options.lifetimeSocket,e));await entry.spool.transfer(this.#options.mapping);}
    }catch{failed=true;}
   }
   if(failed)unavailable();
  });
 }
 stop():Promise<void>{
  if(this.#stop)return this.#stop;this.#stopping=true;
  this.#stop=this.#run(async()=>{
   let failed=false;for(const entry of this.#entries.values())if(entry.child)try{await entry.child.stop();}catch{failed=true;}
   if(failed)unavailable();
  });return this.#stop;
 }
}
