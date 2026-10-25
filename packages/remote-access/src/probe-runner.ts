import {probeTarget,type ProbeOptions,type RemoteProbeResult} from './probe.ts';
import type {RemoteProbeTarget} from './probe-targets.ts';

export type RemoteProbe=(target:RemoteProbeTarget,options:ProbeOptions)=>Promise<RemoteProbeResult>;
export interface RemoteProbeRunOptions {
 concurrency?:number;
 signal?:AbortSignal;
 result:(value:RemoteProbeResult)=>unknown;
 error?:()=>void;
}

export async function runRemoteProbes(targets:RemoteProbeTarget[],probe:RemoteProbe=probeTarget,options:RemoteProbeRunOptions):Promise<void> {
 const concurrency=options.concurrency??4;if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4||targets.length>100)throw new Error('invalid_probe_run');
 const signal=options.signal??new AbortController().signal;let next=0,failed=false,failure:unknown;
 const worker=async()=>{try{
  while(!signal.aborted&&!failed){const index=next++;if(index>=targets.length)return;let value:RemoteProbeResult;
   try{value=await probe(targets[index]!,{signal});}catch{if(!signal.aborted)options.error?.();continue;}
   if(signal.aborted||failed)return;await options.result(value);
  }
 }catch(error){if(!failed){failed=true;failure=error;}}};
 // Keep shared resources alive until every started probe and result write settles.
 await Promise.all(Array.from({length:Math.min(concurrency,targets.length)},worker));if(failed)throw failure;
}
