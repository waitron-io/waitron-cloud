import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {freemem,loadavg,uptime} from 'node:os';
const require=createRequire(new URL('../../packages/operations/package.json',import.meta.url));
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1,connectionTimeoutMillis:1000,statement_timeout:1000,query_timeout:1500});
let pending,stopped=false;
pool.on('error',error=>console.error(JSON.stringify({event:'observer-error',class:error.constructor.name})));
const timer=setInterval(()=>{
 if(stopped||pending)return;
 pending=(async()=>{
  try{
   const {rows}=await pool.query(`SELECT pid,application_name,state,wait_event_type,wait_event,
    extract(epoch from clock_timestamp()-query_start) AS query_seconds,
    substring(query from '^[A-Za-z]+') AS verb,pg_blocking_pids(pid) AS blockers
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active'
    ORDER BY pid LIMIT 30`);
   console.error(JSON.stringify({event:'database-sample',at:Date.now(),rows,free:freemem(),load:loadavg(),uptime:uptime()}));
  }catch(error){console.error(JSON.stringify({event:'observer-refusal',class:error.constructor.name,at:Date.now()}));}
 })().finally(()=>{pending=undefined;});
},2000);
let result;
for(let attempt=1;attempt<=6;attempt++){
 console.error(JSON.stringify({event:'diagnostic-attempt',attempt,at:Date.now()}));
 const child=spawn('pnpm',['--filter','@waitron-cloud/operations','test'],{stdio:'inherit'});
 result=await new Promise(resolve=>{child.once('error',error=>resolve({status:1,error:error.constructor.name}));child.once('close',(status,signal)=>resolve({status,signal}));});
 console.error(JSON.stringify({event:'diagnostic-attempt-exit',attempt,...result,at:Date.now()}));
 if(result.status!==0)break;
}
stopped=true;clearInterval(timer);await pending;await pool.end();
console.error(JSON.stringify({event:'diagnostic-exit',...result}));process.exitCode=result.status??1;
