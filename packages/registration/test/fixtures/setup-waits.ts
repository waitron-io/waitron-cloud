import {Pool, type PoolClient} from 'pg';
import {migrate as runMigrations} from '../../src/migrate.ts';

export async function observeSetup<T>(pool:Pool,setup:()=>Promise<T>):Promise<T>{
 const observer=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1,
  application_name:'cloud-test-setup-observer',connectionTimeoutMillis:500,
  statement_timeout:500,query_timeout:750});
 const pids=new Set<number>();
 const samples:unknown[]=[];
 let unavailable=false,stopped=false,failed=false;
 let pending:Promise<void>|undefined;
 observer.on('error',()=>{unavailable=true;});
 const sample=()=>{
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
     samples.push({pid:row.pid,waitType:row.wait_event_type,waitEvent:row.wait_event,
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
 pool.on('acquire',acquire);
 const timer=setInterval(sample,100);
 try{return await setup();}
 catch(error){failed=true;throw error;}
 finally{
  stopped=true;clearInterval(timer);pool.removeListener('acquire',acquire);
  await pending;
  try{await observer.end();}catch{unavailable=true;}
  if(failed){try{console.error(JSON.stringify({event:'cloud-test-setup-waits',unavailable,samples}));}catch{}}
 }
}

export async function migrate(pool:Pool):Promise<void>{
 await observeSetup(pool,()=>runMigrations(pool));
}
