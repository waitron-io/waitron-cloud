import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {EmailOutbox,EmailWorker} from '../../packages/registration/src/email-outbox.ts';
import {runWorkerLoop} from '../../packages/registration/src/worker-loop.ts';
import {createTestCaptureMailer} from './capture-mailer.mjs';
import {checkConsumerDatabase,loadRuntime} from '../local-stack/runtime.mjs';
import {testRuntimeEnvironment} from './runtime.mjs';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
export async function runTestEmailWorker({directory='/run/local-stack',root='/app',signal,once=false}={}){
 const config=await loadRuntime(directory),environment=testRuntimeEnvironment('email',config,process.env);
 await checkConsumerDatabase(environment.DATABASE_URL,root);
 const pool=new Pool({connectionString:environment.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});
 const stop=new AbortController(),abort=()=>stop.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();pool.on('error',abort);
 try{
  const outbox=new EmailOutbox({activeKeyId:config.email.activeKeyId,keys:config.email.keys});
  const worker=new EmailWorker(pool,outbox,createTestCaptureMailer({origin:environment.CLOUD_PORTAL_ORIGIN,port:1025}));
  if(once)return await worker.runOnce();
  await runWorkerLoop({signal:stop.signal,concurrency:4,scheduleIntervalMs:60000,pollIntervalMs:1000,runOnce:()=>worker.runOnce()});
 }finally{signal?.removeEventListener('abort',abort);await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 try{if(process.argv.length!==2)throw Error();await runTestEmailWorker({directory:process.env.LOCAL_STACK_CONFIG_DIR,signal:stop.signal});}
 catch{console.error('Test capture worker failed; check private configuration and schema');process.exitCode=1;}
 finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
