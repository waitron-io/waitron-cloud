import {randomUUID} from 'node:crypto';
import {open,readFile,rename,rm,stat,utimes} from 'node:fs/promises';

export async function claimLease(path,{staleMs=2000}={}){
 const owner=randomUUID();
 for(let attempt=0;attempt<3;attempt++){
  try{
   const handle=await open(path,'wx',0o600);try{await handle.writeFile(owner);await handle.sync();}finally{await handle.close();}
   let lost=false;const heartbeat=setInterval(()=>{void readFile(path,'utf8').then(value=>{if(value!==owner){lost=true;return;}const now=new Date();return utimes(path,now,now);}).catch(()=>{lost=true;});},Math.max(100,Math.floor(staleMs/4)));heartbeat.unref();
   return {async assertOwned(){try{if(lost||(await readFile(path,'utf8'))!==owner)throw Error();}catch{lost=true;throw new Error('local_stack.lease_lost');}},async release(){clearInterval(heartbeat);try{if((await readFile(path,'utf8'))===owner)await rm(path);}catch(error){if(!['ENOENT','EISDIR'].includes(error?.code))throw error;}}};
  }catch(error){
   if(error?.code!=='EEXIST')throw error;
   let info;try{info=await stat(path);}catch(cause){if(cause?.code==='ENOENT')continue;throw cause;}
   if(Date.now()-info.mtimeMs<=staleMs)return;
   const abandoned=`${path}.${randomUUID()}.stale`;
   try{await rename(path,abandoned);await rm(abandoned,{recursive:true,force:true});}catch(cause){if(cause?.code!=='ENOENT')throw cause;}
  }
 }
}
