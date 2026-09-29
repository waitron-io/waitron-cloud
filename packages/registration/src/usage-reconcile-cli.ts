import {Pool} from 'pg';
import {migrationNames} from './migrate.ts';
import {UsageReconciler} from './usage-metering.ts';
import {runWorkerLoop} from './worker-loop.ts';

let pool:Pool|undefined;
const stop=new AbortController(),shutdown=()=>stop.abort();
function configuredInteger(name:string,fallback:number,min:number,max:number){
 const raw=process.env[name];if(raw===undefined)return fallback;
 const value=Number(raw);if(!Number.isInteger(value)||value<min||value>max)throw Error();return value;
}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const args=process.argv.slice(2),mode=args[0];
 if(args.length!==1||!['--once','--status','--watch'].includes(mode!)||!process.env.DATABASE_URL)throw Error();
 const interval=mode==='--watch'?configuredInteger('CLOUD_USAGE_INTERVAL_MS',60000,1000,240000):60000;
 const batch=mode==='--watch'?configuredInteger('CLOUD_USAGE_BATCH_SIZE',100,1,1000):100;
 const connection=new URL(process.env.DATABASE_URL);
 // The whole pass needs a deadline, including time spent between its statements.
 connection.searchParams.set('options',`${connection.searchParams.get('options')??''} -c transaction_timeout=10000`);
 pool=new Pool({connectionString:connection.href,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
 pool.on('error',()=>{console.error('Usage database connection failed; retrying');});
 const installed=await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM schema_migrations WHERE name=ANY($1::text[])',[migrationNames]);
 if(installed.rows[0]?.count!==migrationNames.length)throw Error();
 const reconciler=new UsageReconciler(pool);
 if(mode==='--watch')await runWorkerLoop({signal:stop.signal,concurrency:1,scheduleIntervalMs:interval,pollIntervalMs:interval,
  async runOnce(){console.log(JSON.stringify(await reconciler.runOnce(batch)));return false;},
  onError(){console.error('Usage reconciliation pass failed; retrying');},
 });
 else console.log(JSON.stringify(mode==='--status'?await reconciler.status():await reconciler.runOnce()));
}catch{
 console.error('Usage reconciliation failed; check configuration, database and migrations');
 process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
