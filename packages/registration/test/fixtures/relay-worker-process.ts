import {Pool} from 'pg';
import {RelayWorker} from '../../src/relay-worker.ts';
let input='';for await(const part of process.stdin)input+=part;
const config=JSON.parse(input);config.grants.verifyOrigin=async()=>{throw new Error('unused');};
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${process.env.RELAY_TEST_SCHEMA} -c statement_timeout=5000`});
try{await new RelayWorker(pool,config).runOnce();}finally{await pool.end();}
