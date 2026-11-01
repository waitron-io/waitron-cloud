import {constants,type BigIntStats} from 'node:fs';
import {lstat,open,opendir,realpath,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {isUuid} from './manifest.ts';
import {validateTrafficMapping,type TrafficMapping} from './traffic-coverage.ts';
import {trafficEnvelopeReport} from './traffic-report.ts';
import type {TrafficStore} from './traffic-store.ts';

const unavailable=():never=>{throw new Error('traffic_collection_unavailable');};
function privateFile(s:BigIntStats,m:TrafficMapping):void {
 if(!s.isFile()||s.nlink!==1n||s.uid!==BigInt(m.writerUid)||s.gid!==BigInt(m.readerGid)||(s.mode&0o7777n)!==0o640n||s.size>262144n)unavailable();
}
function sameFile(a:BigIntStats,b:BigIntStats):boolean {
 return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
function identity(name:string):{name:string;processId:string;sequence:number} {
 const parts=/^([0-9a-f-]{36})\.([1-9][0-9]{0,15})\.json$/.exec(name);
 if(!parts||!isUuid(parts[1])||!Number.isSafeInteger(Number(parts[2])))return unavailable();
 return {name,processId:parts[1],sequence:Number(parts[2])};
}

/** Removing a report acknowledges a committed receipt; an uncertain write keeps its exact signed retry. */
export async function collectTraffic(input:TrafficMapping,store:Pick<TrafficStore,'record'>):Promise<void> {
 try{
  validateTrafficMapping(input);const mapping={...input};
  const directory=await open(mapping.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{
   const initial=await directory.stat({bigint:true});
   async function checkDirectory(){
    const s=await lstat(mapping.directory,{bigint:true});
    if(!s.isDirectory()||s.dev!==initial.dev||s.ino!==initial.ino||s.uid!==BigInt(mapping.writerUid)||s.gid!==BigInt(mapping.readerGid)
     ||(s.mode&0o7777n)!==0o2750n||await realpath(mapping.directory)!==mapping.directory)unavailable();
   }
   await checkDirectory();const names:ReturnType<typeof identity>[]=[];
   const entries=await opendir(mapping.directory);
   for await(const entry of entries){if(names.length>=4096)unavailable();names.push(identity(entry.name));}
   names.sort((a,b)=>a.processId<b.processId?-1:a.processId>b.processId?1:a.sequence-b.sequence);
   for(const id of names){
    await checkDirectory();const path=join(mapping.directory,id.name);
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
     const initialFile=await file.stat({bigint:true});privateFile(initialFile,mapping);
     const bytes=Buffer.alloc(262145);let size=0;
     while(size<bytes.length){const r=await file.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
     if(size>262144)unavailable();
     const envelope:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))),report=trafficEnvelopeReport(envelope);
     if(report.processId!==id.processId||report.sequence!==id.sequence||report.cellId!==mapping.cellId)unavailable();
     async function unchanged(){
      await checkDirectory();const s=await lstat(path,{bigint:true});privateFile(s,mapping);
      if(!sameFile(initialFile,s))unavailable();
     }
     await unchanged();const receipt=await store.record({...mapping},envelope);
     if(!receipt||Object.keys(receipt).sort().join(',')!=='processId,sequence,state'||!['accepted','replay'].includes(receipt.state)
      ||receipt.processId!==id.processId||receipt.sequence!==id.sequence)unavailable();
     await unchanged();await unlink(path);await directory.sync();
    }finally{await file.close();}
   }
  }finally{await directory.close();}
 }catch{return unavailable();}
}
