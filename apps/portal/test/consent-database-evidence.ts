import {Client,type Pool} from 'pg';

// Use a separate connection so a stalled application pool cannot hide its own waiters.
export async function failConsentDatabaseWait(pool:Pool,schema:string,error:unknown,report:(details:string)=>void):Promise<never>{
 const client=new Client({...pool.options,application_name:'consent_failure_evidence',connectionTimeoutMillis:250});
 // PostgreSQL reports transport failure through both query rejection and client events.
 client.on('error',()=>{});
 let timer:ReturnType<typeof setTimeout>|undefined;
 let snapshot:object={unavailable:true};
 try{
  snapshot=await Promise.race([
   (async()=>{
    await client.connect();
    // Query text stays inside PostgreSQL; only fixed families and wait metadata leave it.
    const {rows}=await client.query(String.raw`SELECT state,wait_event_type AS "waitType",
     cardinality(pg_blocking_pids(pid)) AS "blockedBy",
     CASE WHEN state='idle' THEN 'idle'
      WHEN query ~* '\mcloud_sessions\M' THEN 'session'
      WHEN query ~* '\mtranslation_consents\M' THEN 'consent'
      ELSE 'other' END AS operation
     FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1
      AND pid<>pg_backend_pid()
     ORDER BY (wait_event_type='Lock') DESC NULLS LAST,pid LIMIT 20`,[schema]);
    return {pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount},sampleLimit:20,connections:rows};
   })(),
   new Promise<{unavailable:true}>(resolve=>{timer=setTimeout(()=>resolve({unavailable:true}),250);}),
  ]);
 }catch{}finally{
  clearTimeout(timer);
  // A completed snapshot must not wait for the peer to finish disconnecting.
  const ended=client.end().catch(()=>{});client.connection.stream.destroy();await ended;
 }
 try{report(JSON.stringify(snapshot));}catch{}
 throw error;
}
