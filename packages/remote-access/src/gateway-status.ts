import {setTimeout as delay} from 'node:timers/promises';

export interface GatewayChallengeStatus {
 read(cellId:string):Promise<ReadonlySet<string>[]>;
}

export async function awaitAnswerable(status:GatewayChallengeStatus,cellIds:string[],hostname:string,
 {signal,giveUpAt,pollMs=500}:{signal:AbortSignal;giveUpAt:number;pollMs?:number}):Promise<void>{
 const timeout=new AbortController(),reason=new Error('challenge_not_answerable');
 const timer=setTimeout(()=>timeout.abort(reason),Math.max(0,giveUpAt-Date.now()));
 const stop=AbortSignal.any([signal,timeout.signal]);
 let rejectAbort!:(reason:unknown)=>void;
 const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
 const onAbort=()=>rejectAbort(stop.reason);
 stop.addEventListener('abort',onAbort,{once:true});
 try{
  for(;;){
   stop.throwIfAborted();
   if(Date.now()>=giveUpAt)throw reason;
   const cells=await Promise.race([Promise.all(cellIds.map(async id=>status.read(id).catch(()=>[]))),aborted]);
   stop.throwIfAborted();
   if(Date.now()>=giveUpAt)throw reason;
   if(cells.length&&cells.every(gateways=>gateways.length&&gateways.every(names=>names.has(hostname))))return;
   await delay(pollMs,undefined,{signal:stop});
  }
 }catch(error){
  if(stop.aborted)throw stop.reason;
  throw error;
 }finally{
  clearTimeout(timer);
  stop.removeEventListener('abort',onAbort);
 }
}
