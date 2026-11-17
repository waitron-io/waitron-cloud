import {Pool} from 'pg';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cloudActionDemoEnabled} from './cloud-action-worker.ts';
let pool:Pool|undefined;
try{
 const args=process.argv.slice(2),mode=args[0]??'--status';
 if(!cloudActionDemoEnabled(process.env)||args.length>1||!['--fail','--status'].includes(mode)||!process.env.DATABASE_URL)throw Error();
 pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:10000});
 const schemaModule=new URL('../../../deploy/local-stack/runtime.mjs',import.meta.url).href;
 const {checkConsumerSchema}=await import(schemaModule);
 await checkConsumerSchema(pool,fileURLToPath(new URL('../../../',import.meta.url)));
 if(mode==='--fail'){
  await writeFile(join(process.env.CLOUD_ACTION_DEMO_DIR??'/run/cloud-action-demo','fail'),'fail',{mode:0o600,flag:'wx'});
  console.log('Synthetic workload failure queued');
 }else{
  const rows=await pool.query('SELECT id,effect_id,dispatch_started_at,outcome FROM cloud_action_requests ORDER BY created_at DESC LIMIT 50');
  console.log(JSON.stringify(rows.rows));
 }
}catch{console.error('Synthetic action command refused; check explicit demo mode, schema and private configuration');process.exitCode=1;}
finally{try{await pool?.end();}catch{process.exitCode=1;}}
