import {createRequire} from 'node:module';
import {checkConsumerSchema,loadRuntime,runtimeEnvironment} from './runtime.mjs';
import {localHealthFetch} from './operations-health.mjs';
import {operationsStatus} from '../../packages/operations/src/status.ts';

const {Pool}=createRequire(new URL('../../packages/operations/package.json',import.meta.url))('pg');
let pool;
// The collector uses the status command's implementation and defaults. Its own
// network keeps collection failures observable when the account process restarts.
try{
 const {DATABASE_URL}=runtimeEnvironment('usage',await loadRuntime('/run/local-stack'));
 pool=new Pool({connectionString:DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:10000,options:'-c default_transaction_read_only=on'});
 pool.on('error',()=>{});
 await checkConsumerSchema(pool,process.cwd());
 const snapshot=await operationsStatus(pool,{controlApiUrl:'http://account:3000',
  fetch:localHealthFetch});
 process.stdout.write(JSON.stringify(snapshot)+'\n');
}catch{console.error('Local operations inspection failed');process.exitCode=1;}
finally{try{await pool?.end();}catch{process.exitCode=1;}}
