import {createRequire} from 'node:module';
import {spawn,execFileSync,spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {freemem,loadavg,uptime} from 'node:os';
const require=createRequire(new URL('../../packages/operations/package.json',import.meta.url));
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1,connectionTimeoutMillis:1000,statement_timeout:1000,query_timeout:1500});
let pending,stopped=false;
pool.on('error',error=>console.error(JSON.stringify({event:'observer-error',class:error.constructor.name})));
const sample=()=>{
 if(stopped||pending)return;
 pending=(async()=>{
  try{
   const {rows}=await pool.query(`SELECT pid,application_name,state,wait_event_type,wait_event,
    extract(epoch from clock_timestamp()-query_start) AS query_seconds,
    substring(query from '^[A-Za-z]+') AS verb,pg_blocking_pids(pid) AS blockers
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active'
    ORDER BY pid LIMIT 30`);
   const stats=(await pool.query(`SELECT
    (SELECT row_to_json(s) FROM pg_stat_wal s) AS wal,
    (SELECT row_to_json(s) FROM pg_stat_checkpointer s) AS checkpointer,
    (SELECT json_agg(s) FROM pg_stat_io s) AS io`)).rows[0];
   const pressure=Object.fromEntries(await Promise.all(['io','cpu','memory'].map(async kind=>[kind,await readFile('/proc/pressure/'+kind,'utf8')])));
   console.error(JSON.stringify({event:'database-sample',at:Date.now(),rows,stats,pressure,free:freemem(),load:loadavg(),uptime:uptime()}));
  }catch(error){console.error(JSON.stringify({event:'observer-refusal',class:error.constructor.name,at:Date.now()}));}
 })().finally(()=>{pending=undefined;});
};
await pool.query('SELECT pg_stat_reset_shared($1)',['io']);
await pool.query(`ALTER SYSTEM SET track_io_timing=on`);
await pool.query(`ALTER SYSTEM SET track_wal_io_timing=on`);
await pool.query('SELECT pg_reload_conf()');
const timer=setInterval(sample,1000);
sample();
const row={package:'@waitron-cloud/identity + @waitron-cloud/operations',members:['@waitron-cloud/identity','@waitron-cloud/operations'],shard:1};
console.error(JSON.stringify({event:'diagnostic-group-start',row,at:Date.now()}));
const child=spawn(process.execPath,['scripts/ci-run-package-group.mjs'],{stdio:'inherit',env:{...process.env,CI_PACKAGE_GROUP:JSON.stringify(row)}});
const result=await new Promise(resolve=>{child.once('error',error=>resolve({status:1,error:error.constructor.name}));child.once('close',(status,signal)=>resolve({status,signal}));});
sample();await pending;stopped=true;clearInterval(timer);
const port=new URL(process.env.TEST_DATABASE_URL).port;
const id=execFileSync('docker',['ps','-q','--filter','publish='+port],{encoding:'utf8',timeout:5000}).trim();
if(!/^[a-f0-9]{12,64}$/.test(id))throw new Error('owned_postgres_not_unique');
const logs=spawnSync('docker',['logs','--tail','100',id],{encoding:'utf8',timeout:5000});
console.error(JSON.stringify({event:'owned-postgres-log',at:Date.now(),stdout:logs.stdout,stderr:logs.stderr,status:logs.status}));
await pool.end();
console.error(JSON.stringify({event:'diagnostic-exit',...result}));process.exitCode=result.status??1;
