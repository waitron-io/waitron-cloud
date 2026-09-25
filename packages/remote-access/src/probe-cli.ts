import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {probeTarget} from './probe.ts';
import {RemoteProbeObservationStore} from './probe-observations.ts';
import {runRemoteProbes} from './probe-runner.ts';
import {RemoteProbeStore} from './probe-targets.ts';

let pool:Pool|undefined;
const stop=new AbortController(),shutdown=()=>stop.abort();
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const args=process.argv.slice(2),mode=args[0];if(args.length>1||(mode&&mode!=='--once')||!process.env.DATABASE_URL)throw Error();
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
 pool.on('error',()=>{console.error('Remote probe database connection failed; stopping');process.exitCode=1;stop.abort();});
 const targets=new RemoteProbeStore(pool),observations=new RemoteProbeObservationStore(pool);
 do{
  const batch=await targets.targets(100);
  await runRemoteProbes(batch,probeTarget,{signal:stop.signal,result:async value=>{if(await observations.record(value))console.log(JSON.stringify(value));},error:()=>console.error('Remote probe failed unexpectedly; continuing')});
  if(mode==='--once')break;
  try{await delay(60000,undefined,{signal:stop.signal});}catch{if(!stop.signal.aborted)throw Error();}
 }while(!stop.signal.aborted);
}catch{
 // Database and network errors can contain addresses or credentials.
 console.error('Remote probe worker failed; check database configuration and migrations');process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
