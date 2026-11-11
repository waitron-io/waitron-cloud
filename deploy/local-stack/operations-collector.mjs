import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {operationsMetrics} from '../../packages/operations/src/metrics.ts';
import {formatRequestMetrics} from '../../packages/account-http/src/request-metrics.ts';
import {readAccountRequests} from './operations-health.mjs';
import {parseFailureRules,createFailureRules} from './account-failure-rules.mjs';

const execute=promisify(execFile);
const timeoutMs=30000;
export function createCollection({collect,collectRequests=async()=>null,intervalMs=60000,timeoutMs=30000,now=Date.now,failureRules=null}){
 let sample=null,text='',attemptedAt=null,succeededAt=null,state='pending',running=false,requestsAvailable=false;
 const rules=failureRules?createFailureRules(failureRules,{intervalMs,timeoutMs}):null;
 let rulesAt=null,rulesAvailable=false;
 let rows=Object.keys(failureRules?.failureTargets??{}).flatMap(group=>['fast','slow'].map(rule=>({group,rule,ready:false,breached:null})));
 function ruleMetrics(){
  if(!rules)return '';
  const fresh=rulesAvailable&&now()<rulesAt+intervalMs+timeoutMs+2000;
  const readyLines=[],breachLines=[];
  for(const row of rows){
   const labels=`group="${row.group}",rule="${row.rule}"`,ready=fresh&&row.ready;
   readyLines.push(`waitron_cloud_account_failure_rule_ready{${labels}} ${ready?1:0}\n`);
   if(ready)breachLines.push(`waitron_cloud_account_failure_rule_breached{${labels}} ${row.breached?1:0}\n`);
  }
  return '# TYPE waitron_cloud_account_failure_rule_ready gauge\n'+readyLines.join('')
   +'# TYPE waitron_cloud_account_failure_rule_breached gauge\n'+breachLines.join('');
 }
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
   +`# TYPE waitron_cloud_account_requests_available gauge\nwaitron_cloud_account_requests_available ${current&&requestsAvailable?1:0}\n`
   +(current?text:'')+ruleMetrics();
 },async poll(){
  if(running)return;running=true;attemptedAt=now();
  let nextSample=null,nextText='',nextState='failed';
  try{
   const next=await collect();
   if(next?.version!==1||!['ready','degraded','unready'].includes(next.state)||next.ready!==(next.state==='ready')||!Number.isFinite(Date.parse(next.checkedAt)))throw Error();
   nextSample=next;nextText=operationsMetrics(next);nextState='current';
  }catch{}
  try{
   const counts=await collectRequests(),readAt=now();
   const metrics=formatRequestMetrics(counts);
   if(rules){rows=rules.update(counts,readAt);rulesAt=readAt;rulesAvailable=true;}
   nextText+=metrics;requestsAvailable=true;
  }catch{requestsAvailable=false;rulesAvailable=false;}
  finally{
   sample=nextSample;text=nextText;state=nextState;
   if(state==='current')succeededAt=now();running=false;
  }
 }};
}

export async function serveCollection({collect,collectRequests,intervalMs=60000,port=9091,host='0.0.0.0',signal,failureRules}){
 if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>3600000)throw Error('invalid_collection_interval');
 const config=parseFailureRules(failureRules,intervalMs);
 const collection=createCollection({collect,collectRequests,intervalMs,timeoutMs,failureRules:config});
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
  const {done}=await serveCollection({collect,collectRequests:readAccountRequests,failureRules:process.env.CLOUD_ACCOUNT_FAILURE_RULES,intervalMs:Number(process.env.CLOUD_OPERATIONS_INTERVAL_MS??60000),signal:controller.signal});await done;
 }catch(error){console.error(error?.message==='invalid_collection_interval'?'Local operations collector failed; check CLOUD_OPERATIONS_INTERVAL_MS':error?.message==='invalid_account_failure_rules'?'Local operations collector failed; check CLOUD_ACCOUNT_FAILURE_RULES':'Local operations collector failed; check local configuration');process.exitCode=1;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
