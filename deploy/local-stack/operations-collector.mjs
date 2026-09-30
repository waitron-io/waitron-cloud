import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {operationsMetrics} from '../../packages/operations/src/metrics.ts';

const execute=promisify(execFile);
const timeoutMs=30000;
export function createCollection({collect,intervalMs=60000,timeoutMs=30000,now=Date.now}){
 let sample=null,text='',attemptedAt=null,succeededAt=null,state='pending',running=false;
 function status(){
  const current=state==='current'&&now()<succeededAt+intervalMs+timeoutMs;
  return {version:1,collection:{state:state==='current'&&!current?'stale':state,
   attemptedAt:attemptedAt===null?null:new Date(attemptedAt).toISOString(),
   succeededAt:succeededAt===null?null:new Date(succeededAt).toISOString(),
   expiresAt:succeededAt===null?null:new Date(succeededAt+intervalMs+timeoutMs).toISOString()},snapshot:current?sample:null};
 }
 return {status,metrics(){
  const current=status().collection.state==='current';
  return `# TYPE waitron_cloud_collection_success gauge\nwaitron_cloud_collection_success ${current?1:0}\n`
   +`# TYPE waitron_cloud_collection_last_success_timestamp_seconds gauge\nwaitron_cloud_collection_last_success_timestamp_seconds ${(succeededAt??0)/1000}\n`
   +`# TYPE waitron_cloud_collection_last_attempt_timestamp_seconds gauge\nwaitron_cloud_collection_last_attempt_timestamp_seconds ${(attemptedAt??0)/1000}\n`
   +(current?text:'');
 },async poll(){
  if(running)return;running=true;attemptedAt=now();
  try{
   const next=await collect();
   if(next?.version!==1||!['ready','degraded','unready'].includes(next.state)||next.ready!==(next.state==='ready')||!Number.isFinite(Date.parse(next.checkedAt)))throw Error();
   const metrics=operationsMetrics(next);
   sample=next;text=metrics;succeededAt=now();state='current';
  }catch{sample=null;text='';state='failed';}
  finally{running=false;}
 }};
}

export async function serveCollection({collect,intervalMs=60000,port=9091,host='0.0.0.0',signal}){
 if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>3600000)throw Error('invalid_collection_interval');
 const collection=createCollection({collect,intervalMs,timeoutMs});
 const server=createServer((request,response)=>{
  response.setHeader('cache-control','no-store');
  if(request.method!=='GET'||!['/status','/metrics'].includes(request.url)){response.writeHead(404);response.end();return;}
  if(request.url==='/metrics'){
   response.setHeader('content-type','text/plain; version=0.0.4');response.end(collection.metrics());
  }else{
   const value=collection.status();response.statusCode=value.snapshot?200:503;
   response.setHeader('content-type','application/json');response.end(JSON.stringify(value)+'\n');
  }
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 const done=(async()=>{
  try{while(!signal.aborted){await collection.poll();await delay(intervalMs,undefined,{signal});}}
  catch(error){if(!signal.aborted)throw error;}
  finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
 })();
 return {server,done};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const controller=new AbortController();
 const stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{
  const collect=async()=>{
   const {stdout}=await execute(process.execPath,['deploy/local-stack/operations-sample.mjs'],{
    env:{PATH:process.env.PATH,HOME:'/tmp',PGOPTIONS:'-c default_transaction_read_only=on'},
    timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:65536,signal:controller.signal});
   return JSON.parse(stdout);
  };
  const {done}=await serveCollection({collect,intervalMs:Number(process.env.CLOUD_OPERATIONS_INTERVAL_MS??60000),signal:controller.signal});await done;
 }catch(error){console.error(error?.message==='invalid_collection_interval'?'Local operations collector failed; check CLOUD_OPERATIONS_INTERVAL_MS':'Local operations collector failed; check local configuration');process.exitCode=1;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
