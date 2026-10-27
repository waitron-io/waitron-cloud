import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,normalize} from 'node:path';
import {isUuid} from './manifest.ts';
import type {ForwardObservationStore} from './forward-observations.ts';

export interface ForwardReportMapping {country:'ES';environment:'test'|'production';cellId:string;file:string;writerUid:number;readerGid:number}
type Store=Pick<ForwardObservationStore,'record'|'prune'>;
const unavailable=()=>new Error('forward_report_unavailable');
export function validateForwardMapping(value:unknown):asserts value is ForwardReportMapping {
 if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();const m=value as ForwardReportMapping;
 if(Object.keys(m).sort().join(',')!=='cellId,country,environment,file,readerGid,writerUid'||m.country!=='ES'||!['test','production'].includes(m.environment)
  ||!isUuid(m.cellId)||typeof m.file!=='string'||!isAbsolute(m.file)||normalize(m.file)!==m.file
  ||!Number.isSafeInteger(m.writerUid)||m.writerUid<0||!Number.isSafeInteger(m.readerGid)||m.readerGid<0)throw unavailable();
}
export async function collectForwardReport(mapping:ForwardReportMapping,store:Store):Promise<void>{
 try{
  validateForwardMapping(mapping);if(await realpath(mapping.file)!==mapping.file)throw unavailable();
  const directory=await open(dirname(mapping.file),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const s=await directory.stat();if(s.uid!==mapping.writerUid||s.gid!==mapping.readerGid||(s.mode&0o7777)!==0o2750)throw unavailable();}finally{await directory.close();}
  const file=await open(mapping.file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let envelope:unknown;
  try{
   const s=await file.stat();if(!s.isFile()||s.nlink!==1||s.uid!==mapping.writerUid||s.gid!==mapping.readerGid||(s.mode&0o7777)!==0o640||s.size>262144)throw unavailable();
   // Read one byte beyond the bound so a growing file cannot allocate an unbounded buffer.
   const bytes=Buffer.alloc(262145);let size=0;
   while(size<bytes.length){const result=await file.read(bytes,size,bytes.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}
   if(size>262144||await realpath(mapping.file)!==mapping.file)throw unavailable();
   envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  }finally{await file.close();}
  await store.record(mapping,envelope);
 }catch{throw unavailable();}
}

/** Polls do not enqueue retries or overlap work for a cell. SQL owns the persistent write budget. */
export class ForwardReportPoller {
 readonly #mappings:ForwardReportMapping[];readonly #store:Store;readonly #log:(message:string)=>void;
 #running=new Set<string>();#polled=new Map<string,number>();#pruned=new Map<string,number>();
 constructor(mappings:ForwardReportMapping[],store:Store,log:(message:string)=>void){
  const ids=new Set<string>();for(const mapping of mappings){validateForwardMapping(mapping);if(ids.has(mapping.cellId))throw unavailable();ids.add(mapping.cellId);}
  this.#mappings=mappings.map(m=>({...m}));this.#store=store;this.#log=log;
 }
 async poll(now=Date.now()):Promise<boolean>{
  const results=await Promise.all(this.#mappings.map(async mapping=>{
   const id=mapping.cellId;if(this.#running.has(id)||now-(this.#polled.get(id)??-Infinity)<30000)return true;
   this.#running.add(id);this.#polled.set(id,now);
   try{
    if(now-(this.#pruned.get(id)??-Infinity)>=60000){this.#pruned.set(id,now);await this.#store.prune(id);}
    await collectForwardReport(mapping,this.#store);return true;
   }catch{this.#log('remote.forward_collection_failed');return false;}finally{this.#running.delete(id);}
  }));
  return results.every(Boolean);
 }
}
