import {Pool} from 'pg';
import {operationsMetrics} from './metrics.ts';
import {operationsStatus} from './status.ts';

let pool:Pool|undefined;
function optionalInteger(name:string){const raw=process.env[name];if(raw===undefined)return;const value=Number(raw);if(!Number.isInteger(value))throw new Error('invalid_operations_configuration');return value;}
try{
 const args=process.argv.slice(2),mode=args[0];
 if(args.length>1||(mode&&!['--ready','--metrics'].includes(mode))||!process.env.DATABASE_URL||!process.env.CLOUD_CONTROL_API_URL)throw new Error('invalid_operations_configuration');
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});
 pool.on('error',()=>{});
 const snapshot=await operationsStatus(pool,{controlApiUrl:process.env.CLOUD_CONTROL_API_URL,
  probeTimeoutMs:optionalInteger('CLOUD_OPERATIONS_PROBE_TIMEOUT_MS'),queueWarningSeconds:optionalInteger('CLOUD_OPERATIONS_QUEUE_WARNING_SECONDS'),
  evidenceStaleSeconds:optionalInteger('CLOUD_OPERATIONS_EVIDENCE_STALE_SECONDS'),snapshotStaleSeconds:optionalInteger('CLOUD_OPERATIONS_SNAPSHOT_STALE_SECONDS'),
  reconciliationStaleSeconds:optionalInteger('CLOUD_OPERATIONS_RECONCILIATION_STALE_SECONDS')});
 process.stdout.write(mode==='--metrics'?operationsMetrics(snapshot):JSON.stringify(snapshot)+'\n');
 if(mode==='--ready'&&!snapshot.ready)process.exitCode=2;
}catch{
 console.error('Cloud operations status failed; check database, migrations and health URL');process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}
}
