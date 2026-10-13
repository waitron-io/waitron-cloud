import {Pool} from 'pg';
import {EmailOutbox} from './email-outbox.ts';
import {MonitorWorker,monitorStatus} from './monitoring.ts';
import {monitorConfigFromEnv} from './monitor-config.ts';
import {runWorkerLoop} from './worker-loop.ts';
let pool:Pool|undefined;
const stop=new AbortController(),shutdown=()=>stop.abort();
const workerConcurrency=4;
class MonitorConfigurationError extends Error{}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const args=process.argv.slice(2),mode=args[0];
 if(args.length>1||(mode&&!['--once','--status'].includes(mode))||!process.env.DATABASE_URL)throw Error();
 let monitorConfig;try{monitorConfig=monitorConfigFromEnv(process.env);}catch{throw new MonitorConfigurationError();}
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:workerConcurrency+1,connectionTimeoutMillis:5000,statement_timeout:10000});
 pool.on('error',()=>{console.error('Monitor database connection failed; retrying');});
 await pool.query('SELECT checked_at,next_check_at FROM venue_monitors LIMIT 0');
 if(mode==='--status')console.log(JSON.stringify(await monitorStatus(pool)));
 else{
  if(!process.env.CLOUD_EMAIL_KEYS||!process.env.CLOUD_EMAIL_ACTIVE_KEY_ID)throw Error();
  const outbox=new EmailOutbox({activeKeyId:process.env.CLOUD_EMAIL_ACTIVE_KEY_ID,keys:JSON.parse(process.env.CLOUD_EMAIL_KEYS)});
  const worker=new MonitorWorker(pool,outbox,monitorConfig);
  if(mode==='--once'){
   await worker.schedule();await worker.runOnce();console.log(JSON.stringify(await worker.status()));
  }else await runWorkerLoop({signal:stop.signal,concurrency:workerConcurrency,scheduleIntervalMs:60000,pollIntervalMs:1000,
   schedule:()=>worker.schedule(),runOnce:()=>worker.runOnce(),onError:()=>{console.error('Monitor observation failed; retrying');}});
 }
}catch(error){
 // Database and configuration errors may contain private values.
 console.error(error instanceof MonitorConfigurationError?'Monitor failed; check remote monitoring threshold configuration':'Monitor failed; check database migrations and email key configuration');process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
