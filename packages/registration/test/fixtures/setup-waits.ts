import {loadavg} from 'node:os';
import {Pool, type PoolClient} from 'pg';
import {migrate as runMigrations} from '../../src/migrate.ts';

type Observation={attach:(pool:Pool)=>void;mark:(stage:string)=>void};
export async function observeSetup<T>(pool:Pool|undefined,setup:(observation:Observation)=>Promise<T>,
 options:{signal?:AbortSignal}={}):Promise<T>{
 const started=performance.now(),stages:{stage:string;elapsedMs:number}[]=[];
 const elapsed=()=>Math.round(performance.now()-started);
 const observer=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1,
  application_name:'cloud-test-setup-observer',connectionTimeoutMillis:500,
  statement_timeout:500,query_timeout:750});
 const pids=new Set<number>();
 const samples:unknown[]=[];
 let unavailable=false,stopped=false,failed=false,reported=false;
 let closing:Promise<void>|undefined;
 let pending:Promise<void>|undefined;
 observer.on('error',()=>{unavailable=true;});
 const sample=(latenessMs=0)=>{
  if(stopped||pending||!pids.size)return;
  pending=(async()=>{
   try{
    const {rows}=await observer.query(`SELECT a.pid,a.wait_event_type,a.wait_event,
      (pg_blocking_pids(a.pid))[1:8] AS blockers,
      (SELECT COALESCE(json_agg(l),'[]'::json) FROM
        (SELECT locktype,mode,granted,relation FROM pg_locks WHERE pid=a.pid AND NOT granted
         ORDER BY locktype,mode LIMIT 16) l) AS locks
      FROM pg_stat_activity a WHERE a.pid=ANY($1::int[]) AND a.state='active'
      ORDER BY a.pid LIMIT 8`,[[...pids]]);
    for(const row of rows){
     samples.push({elapsedMs:elapsed(),latenessMs,pid:row.pid,waitType:row.wait_event_type,waitEvent:row.wait_event,
      blockers:row.blockers,locks:row.locks});
     if(samples.length>8)samples.shift();
    }
   }catch{unavailable=true;}
  })().finally(()=>{pending=undefined;});
 };
 const acquire=(client:PoolClient)=>{
  const pid=(client as PoolClient & {processID:number}).processID;
  if(Number.isSafeInteger(pid)&&pids.size<8)pids.add(pid);
  sample();
 };
 const attach=(next:Pool)=>{
  if(stopped)return;
  pool?.removeListener('acquire',acquire);pids.clear();pool=next;pool.on('acquire',acquire);
 };
 if(pool)attach(pool);
 let nextTick=performance.now()+100,maxLateness={elapsedMs:0,latenessMs:0};
 const timer=setInterval(()=>{
  const now=performance.now(),latenessMs=Math.max(0,Math.round(now-nextTick));
  if(latenessMs>=maxLateness.latenessMs)maxLateness={elapsedMs:elapsed(),latenessMs};
  sample(latenessMs);nextTick=now+100;
 },100);
 const stop=()=>closing??=(async()=>{
  stopped=true;clearInterval(timer);pool?.removeListener('acquire',acquire);
  await pending;
  try{await observer.end();}catch{unavailable=true;}
 })();
 const report=()=>{
  if(reported)return;reported=true;
  try{console.error(JSON.stringify({event:'cloud-test-setup-waits',unavailable,samples,
   stage:stages.at(-1)?.stage,stages,elapsedMs:elapsed(),loadAverage:loadavg(),maxLateness,
   pool:pool?{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount}:undefined}));}catch{}
 };
 // A test timeout can abort while its SQL or child process remains pending.
 const abort=()=>{void stop().then(report);};
 options.signal?.addEventListener('abort',abort,{once:true});
 if(options.signal?.aborted)abort();
 try{return await setup({attach,mark(stage){
  stages.push({stage,elapsedMs:elapsed()});if(stages.length>16)stages.shift();
 }});}
 catch(error){failed=true;throw error;}
 finally{
  options.signal?.removeEventListener('abort',abort);
  await stop();if(failed)report();
 }
}

export async function migrate(pool:Pool):Promise<void>{
 await observeSetup(pool,()=>runMigrations(pool));
}
