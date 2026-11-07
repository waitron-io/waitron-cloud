import {Pool} from 'pg';
import {allowanceOptionsFromEnv,migrationNames,parsePlanMode} from '@waitron-cloud/registration';
import {createTestBoxTranslationWorker} from './openai-client.ts';

let pool:Pool|undefined;let failed=false;
const stop=new AbortController(),shutdown=()=>stop.abort();
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
const fail=()=>{if(!failed){console.error('Test-box translation worker failed; check trial scope, database and provider configuration');failed=true;}process.exitCode=1;stop.abort();};
try{
 const [installationId,venueId,once,...extra]=process.argv.slice(2);
 const mode=parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS);
 if(!installationId||!venueId||once!=='--once'||extra.length||mode!=='existing'||allowanceOptionsFromEnv(process.env,mode)||!process.env.DATABASE_URL)throw Error();
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});
 pool.on('connect',client=>{client.on('error',fail);});pool.on('error',fail);
 const worker=createTestBoxTranslationWorker(pool,{installationId,venueId,apiKey:process.env.CLOUD_OPENAI_API_KEY??''});
 const installed=await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM schema_migrations WHERE name=ANY($1::text[])',[migrationNames]);
 if(installed.rows[0]?.count!==migrationNames.length)throw Error();
 await worker.runOnce(stop.signal);
}catch{fail();}
finally{
 try{await pool?.end();}catch{fail();}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
