import {validateHeaderValue} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {migrationNames,runWorkerLoop} from '@waitron-cloud/registration';
import {createOpenAiClient,openAiBaseUrl} from './openai-client.ts';
import {TranslationWorker} from './worker.ts';
import {sweepTranslationJobs} from './retention.ts';
let pool:Pool|undefined;
let failed=false;
const stop=new AbortController(),shutdown=()=>stop.abort(),jobConcurrency=2;
async function sweepUntilReady(){
 while(!stop.signal.aborted){
  try{await sweepTranslationJobs(pool!);return;}
  catch{
   // A fatal client failure has already stopped retries and reported the outcome.
   if(failed)return;
   console.error('Translation worker cleanup failed; retrying');
   try{await delay(60000,undefined,{signal:stop.signal});}catch(error){if(!stop.signal.aborted)throw error;}
  }
 }
}
function fail(){
 if(!failed){console.error('Translation worker failed; check database, migrations and provider configuration');failed=true;}
 process.exitCode=1;stop.abort();
}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const args=process.argv.slice(2);
 if(args.length>1||(args.length===1&&args[0]!=='--once')||!process.env.DATABASE_URL||!process.env.CLOUD_OPENAI_API_KEY?.trim())throw Error();
 validateHeaderValue('authorization',`Bearer ${process.env.CLOUD_OPENAI_API_KEY}`);
 const client=createOpenAiClient({apiKey:process.env.CLOUD_OPENAI_API_KEY,baseUrl:openAiBaseUrl(process.env)});
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:jobConcurrency+2,connectionTimeoutMillis:5000,statement_timeout:10000});
 // A client can emit an error while borrowed or being discarded, outside the idle pool handler.
 pool.on('connect',client=>{client.on('error',fail);});
 pool.on('error',fail);
 const installed=await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM schema_migrations WHERE name=ANY($1::text[])',[migrationNames]);
 if(installed.rows[0]?.count!==migrationNames.length)throw Error();
 const worker=new TranslationWorker(pool,client);
 if(args[0]==='--once'){await sweepTranslationJobs(pool);await worker.runOnce(stop.signal);}
 else await runWorkerLoop({signal:stop.signal,concurrency:jobConcurrency,scheduleIntervalMs:60000,pollIntervalMs:1000,
  schedule:sweepUntilReady,runOnce:signal=>worker.runOnce(signal),onError(error){
   // A terminated query can reject before its client emits the fatal error event.
   if(stop.signal.aborted||(error as {code?:unknown}|null)?.code==='57P01')throw error;
   console.error('Translation worker pass failed; retrying');}});
}catch{
 // Provider and database errors can carry request text; operational output stays fixed.
 fail();
}finally{
 try{await pool?.end();}catch{fail();}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
