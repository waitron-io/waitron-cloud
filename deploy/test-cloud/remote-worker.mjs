import {createRequire} from 'node:module';
import {rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runWorkerLoop,parsePlanMode} from '../../packages/registration/src/index.ts';
import {runManifestWorker} from '../local-stack/manifest-worker.mjs';
import {openTestRemoteRuntime} from './remote-runtime.mjs';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
const stop=new AbortController(),shutdown=()=>stop.abort(),ready=join(tmpdir(),'test-cloud-remote-ready');let pool;
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 await rm(ready,{force:true});
 const mode=parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS),directory=process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack';
 if(mode==='existing')await runManifestWorker({directory,signal:stop.signal});
 else{
  if(!process.env.DATABASE_URL)throw Error();
  pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});pool.on('error',()=>{console.error('Test remote database unavailable');stop.abort();process.exitCode=1;});
  const {worker}=await openTestRemoteRuntime({pool,directory,mode});
  // Placement needs the committed cell, not merely a running worker process.
  await writeFile(ready,'ready\n',{mode:0o600});
  await runWorkerLoop({signal:stop.signal,concurrency:1,scheduleIntervalMs:1000,pollIntervalMs:250,schedule:()=>worker.schedule(),runOnce:signal=>worker.runOnce(signal),onError:()=>console.error('Test remote reconciliation unavailable; retrying')});
 }
}catch{console.error('Test remote worker failed; inspect private state and schema');process.exitCode=1;}
finally{await rm(ready,{force:true});try{await pool?.end();}catch{process.exitCode=1;}process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
