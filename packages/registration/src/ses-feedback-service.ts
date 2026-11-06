import {SesFeedbackWorker} from './ses-feedback-worker.ts';
import {runWorkerLoop} from './worker-loop.ts';

type ConsumerOptions=ConstructorParameters<typeof SesFeedbackWorker>[0]&{
 signal:AbortSignal;once?:boolean;sample?:()=>unknown;
 onStatus?:(status:ReturnType<SesFeedbackWorker['status']>)=>void;
};

/** Own the supplied pool and queue for this explicitly started consumer. */
export async function runSesFeedbackConsumer(options:ConsumerOptions):Promise<void> {
 const worker=new SesFeedbackWorker(options),stop=new AbortController();
 const signal=AbortSignal.any([options.signal,stop.signal]);
 let closed=false,failed=false,expired=false,failure:string|undefined;
 let graceTimer:ReturnType<typeof setTimeout>|undefined,cleanupTimer:ReturnType<typeof setTimeout>|undefined;
 let expire:()=>void=()=>{};
 const grace=new Promise<never>((_resolve,reject)=>{expire=()=>{expired=true;reject(Error('ses_feedback_shutdown_failed'));};});
 const close=()=>{if(!closed){closed=true;try{options.queue.close();}catch{failed=true;}}};
 const onStop=()=>{close();graceTimer=setTimeout(expire,20000);};
 signal.addEventListener('abort',onStop,{once:true});if(signal.aborted)onStop();
 const onPoolError=()=>{failed=true;stop.abort();};options.pool.on('error',onPoolError);
 const publish=()=>{
  let sample:unknown;try{sample=options.sample?.();}catch{}
  try{options.onStatus?.(worker.status(sample));}catch{failed=true;stop.abort();}
 };
 const runOnce=async()=>{try{return await worker.runOnce(signal);}finally{publish();}};
 try{
  publish();
  const running=(async()=>{
   if(signal.aborted)return;
   if(options.once){
    // Every started slot settles before a one-shot failure can release its pool.
    const results=await Promise.allSettled([Promise.resolve().then(runOnce),Promise.resolve().then(runOnce)]);
    if(results.some(r=>r.status==='rejected')&&!signal.aborted)throw Error();
   }else await runWorkerLoop({signal,concurrency:2,scheduleIntervalMs:1000,pollIntervalMs:1000,
    runOnce,onError:()=>publish()});
  })();
  await Promise.race([running,grace]);
 }catch{failure=expired?'ses_feedback_shutdown_failed':'ses_feedback_consumer_failed';stop.abort();}
 finally{
  close();
  try{
   // Cleanup shares any running shutdown deadline, rather than adding to it.
   await Promise.race([Promise.resolve().then(()=>options.pool.end()),grace,
    new Promise<never>((_resolve,reject)=>{cleanupTimer=setTimeout(()=>reject(Error()),5000);})]);
  }catch{failure??=expired?'ses_feedback_shutdown_failed':'ses_feedback_cleanup_failed';}
  clearTimeout(cleanupTimer);clearTimeout(graceTimer);
  signal.removeEventListener('abort',onStop);options.pool.removeListener('error',onPoolError);publish();
 }
 if(failure||failed)throw Error(failure??'ses_feedback_consumer_failed');
}
