import type {Pool,PoolClient} from 'pg';

/** Connection acquisition, database work and cleanup share one processing budget. */
export async function sesFeedbackTransaction<T>(pool:Pool,action:(client:PoolClient)=>Promise<T>):Promise<T> {
 const deadline=performance.now()+5000;
 let client:PoolClient|undefined,released=false,finished=false,succeeded=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let interrupt:()=>void=()=>{};
 const failed=()=>Error('ses_feedback_processing_failed');
 const remaining=()=>Math.floor(deadline-performance.now());
 const release=(discard:boolean)=>{
  if(client&&!released){released=true;client.release(discard);}
 };
 const interrupted=new Promise<never>((_resolve,reject)=>{interrupt=()=>reject(failed());});
 const onError=()=>interrupt();
 timer=setTimeout(interrupt,Math.max(1,remaining()));
 const work=(async()=>{
  client=await pool.connect();
  // A timed-out pool request may still receive a client; it owns no new work.
  if(finished||remaining()<=0){release(true);throw failed();}
  client.on('error',onError);
  await client.query('BEGIN');
  const milliseconds=remaining();
  if(milliseconds<=0)throw failed();
  // Server cancellation also bounds COMMIT when a disconnected client cannot recall it.
  await client.query(`SELECT set_config('transaction_timeout',$1,true),
   set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)`,[`${milliseconds}ms`]);
  const result=await action(client);
  if(finished||remaining()<=0)throw failed();
  await client.query('COMMIT');
  if(finished||remaining()<=0)throw failed();
  return result;
 })();
 try{
  const result=await Promise.race([work,interrupted]);succeeded=true;return result;
 }finally{
  finished=true;clearTimeout(timer);
  // A failed connection cannot be reused while its outcome is uncertain.
  release(!succeeded);client?.removeListener('error',onError);
 }
}
