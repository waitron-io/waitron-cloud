import {spawn,type ChildProcess} from 'node:child_process';
import {type KeyObject} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {type ManifestEnvelope} from './manifest.ts';
import {TrafficChildJournal} from './traffic-child-journal.ts';
import {TrafficSampler} from './traffic-sampler.ts';
import {TrafficSpool} from './traffic-spool.ts';
import {sendTrafficLifetime} from './traffic-lifetime-transport.ts';
import {validateTrafficMapping,type TrafficMapping} from './traffic-coverage.ts';

interface Options {
 directory:string;country:'ES';environment:'test';cellId:string;issuerKey:KeyObject;reporterKey:KeyObject;
 spool:TrafficSpool;manifest:ManifestEnvelope;processId:string;startedAt:string;predecessorId:string|null;
 command:string;args:readonly string[];socket:string;mapping:TrafficMapping;lifetimeSocket:string;now?:()=>number;
}
function unavailable():never{throw new Error('traffic_child_process_unavailable');}

/** Ownership exists only in the captured spawn handle. Saved lifetimes never authorize a signal or a fresh baseline. */
export class TrafficChildProcess {
 readonly #options:Options;readonly #journal:TrafficChildJournal;readonly #sampler:TrafficSampler;
 #child:ChildProcess|undefined;#exited:Promise<void>=Promise.resolve();#pending:Promise<void>=Promise.resolve();
 #attempted=false;#stopping=false;#stop:Promise<void>|undefined;
 constructor(options:Options){
  try{
   validateTrafficMapping(options.mapping);if(options.mapping.cellId!==options.cellId)unavailable();
   this.#options={...options,args:[...options.args],manifest:structuredClone(options.manifest),mapping:{...options.mapping}};
   this.#journal=new TrafficChildJournal(options);
   this.#sampler=new TrafficSampler({spool:options.spool,envelope:this.#options.manifest,issuerKey:options.issuerKey,cellId:options.cellId,
    processId:options.processId,startedAt:options.startedAt,key:options.reporterKey,fresh:true});
  }catch{unavailable();}
 }
 get running():boolean{return !!this.#child&&this.#child.exitCode===null&&this.#child.signalCode===null;}
 #run(operation:()=>Promise<void>):Promise<void>{
  const next=this.#pending.then(async()=>{try{await operation();}catch{unavailable();}});
  this.#pending=next.catch(()=>{});return next;
 }
 start():Promise<void>{
  return this.#run(async()=>{
   if(this.#attempted||this.#stopping)unavailable();this.#attempted=true;
   const o=this.#options;
   if(await this.#journal.restore()||await o.spool.cursor())unavailable();
   try{await lstat(o.socket);unavailable();}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='ENOENT')throw error;}
   await this.#journal.prepare({manifest:o.manifest,processId:o.processId,startedAt:o.startedAt,predecessorId:o.predecessorId});
   await this.#journal.claimSpawn();
   const child=spawn(o.command,[...o.args],{stdio:'ignore'});this.#child=child;
   this.#exited=new Promise<void>(resolve=>{
    const ended=()=>{
     resolve();
     // Country coverage also detects the missing tail if local gap persistence fails.
     void this.#run(()=>o.spool.markGap()).catch(()=>{});
    };
    child.once('exit',ended);child.once('error',ended);
   });
   await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  });
 }
 sample():Promise<void>{
  if(this.#stopping)return Promise.reject(new Error('traffic_child_process_unavailable'));
  return this.#run(async()=>{
   if(!this.running)unavailable();
   await this.#sampler.sampleSocket(this.#options.socket,this.#options.now);
   if(!this.running){await this.#options.spool.markGap();unavailable();}
  });
 }
 flush():Promise<void>{
  return this.#run(async()=>{
   await this.#journal.flush(envelope=>sendTrafficLifetime(this.#options.lifetimeSocket,envelope));
   await this.#options.spool.transfer(this.#options.mapping);
  });
 }
 stop():Promise<void>{
  if(this.#stop)return this.#stop;this.#stopping=true;
  const stopped=this.#run(async()=>{
   if(!this.#child)return;
   const child=this.#child;
   if(this.running){
    child.kill('SIGTERM');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([this.#exited,new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{clearTimeout(timer);}
    if(this.running)child.kill('SIGKILL');
    try{
     await Promise.race([this.#exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error()),1000);})]);
    }finally{clearTimeout(timer);}
   }
   // A pre-stop sample cannot cover bytes arriving before exit. Only independently proved quiescence may close a lifetime.
   await this.#options.spool.markGap();
  });
  // Exit can enqueue its durable gap behind the stop operation itself.
  this.#stop=stopped.then(()=>this.#pending);return this.#stop;
 }
}
