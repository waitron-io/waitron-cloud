import {Pool} from 'pg';
import {migrationNames} from './migrate.ts';
import {UsageReconciler} from './usage-metering.ts';

let pool:Pool|undefined;
try{
 const args=process.argv.slice(2),mode=args[0];
 if(args.length!==1||!['--once','--status'].includes(mode!)||!process.env.DATABASE_URL)throw Error();
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
 const installed=await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM schema_migrations WHERE name=ANY($1::text[])',[migrationNames]);
 if(installed.rows[0]?.count!==migrationNames.length)throw Error();
 const reconciler=new UsageReconciler(pool);
 console.log(JSON.stringify(mode==='--status'?await reconciler.status():await reconciler.runOnce()));
}catch{
 console.error('Usage reconciliation failed; check database and migrations');
 process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}
}
