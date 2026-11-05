import type {Pool} from 'pg';

// Only the explicit authority clock is controlled; PostgreSQL still executes every query and lock.
// A short deadline must begin expiring after the waiter is observed, regardless of runner pauses.
export function databaseClock(pool:Pool,time:()=>number):Pool {
 return new Proxy(pool,{get(target,name){
  if(name==='connect')return async()=>{
   const client=await target.connect();
   return new Proxy(client,{get(connection,key){
    if(key==='query')return async(sql:string,values?:unknown[])=>{
     const result=await connection.query(sql,values);
     if(sql==='SELECT clock_timestamp() AS now')return {...result,rows:[{...result.rows[0],now:new Date(time())}]};
     return result;
    };
    const value=Reflect.get(connection,key);return typeof value==='function'?value.bind(connection):value;
   }});
  };
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 }});
}
