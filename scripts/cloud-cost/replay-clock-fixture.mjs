// Only generated replay bundles use this clock; it supplies no real time or network evidence.
export function createReplayClock(instantMs) {
 if(!Number.isSafeInteger(instantMs)||instantMs<0)throw new RangeError('Invalid synthetic replay clock');
 let wall=instantMs,monotonic=0;
 const clock={
  wall:()=>wall,
  monotonic:()=>monotonic,
  advance(ms){
   if(!Number.isSafeInteger(ms)||ms<0||!Number.isSafeInteger(wall+ms)||!Number.isSafeInteger(monotonic+ms))
    throw new RangeError('Invalid synthetic replay clock');
   wall+=ms;monotonic+=ms;
  },
  async observe(observer,environment,response=()=>new Response(null,
   {headers:{date:new Date(wall).toUTCString(),'cache-control':'no-store'}})){
   if(environment!=='preproduction')throw new Error('Invalid synthetic replay clock environment');
   return observer(environment,{wall:clock.wall,monotonic:clock.monotonic,request:async()=>response()});
  },
 };
 return clock;
}

export const replayClock=createReplayClock(Date.now());
