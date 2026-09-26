import {setTimeout as delay} from 'node:timers/promises';

interface WorkerLoopOptions {
  runOnce:(signal:AbortSignal)=>Promise<boolean>;
  schedule?:()=>Promise<unknown>;
  signal:AbortSignal;
  concurrency:number;
  scheduleIntervalMs:number;
  pollIntervalMs:number;
  now?:()=>number;
  wait?:(milliseconds:number,signal:AbortSignal)=>Promise<void>;
  onError?:(error:unknown)=>Promise<void>|void;
}

export async function runWorkerLoop(options:WorkerLoopOptions):Promise<void>{
  const {signal}=options;
  if(!Number.isInteger(options.concurrency)||options.concurrency<1||options.concurrency>32
    ||!Number.isInteger(options.scheduleIntervalMs)||options.scheduleIntervalMs<1
    ||!Number.isInteger(options.pollIntervalMs)||options.pollIntervalMs<1)throw new Error('invalid_worker_loop_config');
  const now=options.now??Date.now;
  const wait=options.wait??(async(milliseconds,currentSignal)=>{
    try{await delay(milliseconds,undefined,{signal:currentSignal});}
    catch(error){if(!currentSignal.aborted)throw error;}
  });
  let nextScheduleAt=Number.NEGATIVE_INFINITY;
  while(!signal.aborted){
    try{
      if(options.schedule&&now()>=nextScheduleAt){
        await options.schedule();
        nextScheduleAt=now()+options.scheduleIntervalMs;
        if(signal.aborted)break;
      }
      const batch=[];
      for(let slot=0;slot<options.concurrency;slot++)batch.push(Promise.resolve().then(()=>options.runOnce(signal)));
      const results=await Promise.allSettled(batch);
      const failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
      if(failure)throw failure.reason;
      if(signal.aborted)break;
      if(results.some(result=>result.status==='fulfilled'&&result.value))continue;
      const untilSchedule=options.schedule?Math.max(1,nextScheduleAt-now()):options.pollIntervalMs;
      await wait(Math.min(options.pollIntervalMs,untilSchedule),signal);
    }catch(error){
      if(!options.onError)throw error;
      await options.onError(error);
      if(!signal.aborted)await wait(options.pollIntervalMs,signal);
    }
  }
}
