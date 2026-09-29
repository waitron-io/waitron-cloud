import assert from 'node:assert/strict';
import {startLocalStack} from './local-stack-lifecycle.mjs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseComposeServices,requestAccountHealth,stackReadiness} from './local-stack-compose.mjs';
import {verifyLocalStackReceipt} from './verify-local-stack-receipt.mjs';

const output=resolve(process.argv[2]??'/tmp/waitron-cloud-local-stack-receipt.json');
if(process.argv.length>3||!process.env.NODE_AUTH_TOKEN)throw new Error('Set NODE_AUTH_TOKEN to a package-read token before running the local stack proof');
const id=randomUUID().slice(0,8),project=`waitron-cloud-proof-${id}`,tag=`proof-${id}`,startedAt=new Date().toISOString();
const commandEnvironment={...process.env,LOCAL_STACK_IMAGE_TAG:tag};
function run(command,args,{capture=false,timeout=600000,env=commandEnvironment}={}){const result=execFileSync(command,args,{cwd:process.cwd(),env,encoding:'utf8',timeout,stdio:capture?['ignore','pipe','pipe']:'inherit'});return result?.trim()??'';}
const compose=(...args)=>run('docker',['compose','-p',project,'--env-file','deploy/local-stack/local.env',...args]);
const composeOutput=(...args)=>run('docker',['compose','-p',project,'--env-file','deploy/local-stack/local.env',...args],{capture:true});
async function port(){const server=createServer();await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});const value=server.address().port;await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));return value;}
for(const name of ['ACCOUNT','POSTGRES','MAILPIT_SMTP','MAILPIT_UI','STORAGE','GATEWAY_TLS','GATEWAY_WIREGUARD'])commandEnvironment[`LOCAL_STACK_${name}_PORT`]=String(await port());
const required=['account','email-worker','gateway','gateway-manifest','mailpit','monitor-worker','postgres','remote-probe','storage','usage-reconciler'];
function services(){return parseComposeServices(composeOutput('ps','-a','--format','json'));}
async function waitForStack(){
 const deadline=Date.now()+120000;let latest=[];
 while(Date.now()<deadline){latest=services();const {ready,failed}=stackReadiness(latest);
  if(ready)return [...required];if(failed)throw new Error(`local stack service failed: ${failed}`);await delay(500);}
 throw new Error('local stack health timeout');
}
function migrationCount(){return Number(composeOutput('exec','-T','postgres','psql','-U','cloud','-d','cloud','-Atc','SELECT count(*) FROM schema_migrations'));}
function databaseMarker(write=false){const statement=write?'CREATE TABLE IF NOT EXISTS local_stack_proof(marker text PRIMARY KEY); INSERT INTO local_stack_proof VALUES (\'lifecycle-v1\') ON CONFLICT DO NOTHING; SELECT marker FROM local_stack_proof;':'SELECT marker FROM local_stack_proof;';return composeOutput('exec','-T','postgres','psql','-U','cloud','-d','cloud','-Atc',statement).split('\n').at(-1)==='lifecycle-v1';}
function storageMarker(mode){return JSON.parse(composeOutput('exec','-T','account','node','deploy/local-stack/storage-marker.mjs',mode)).present===true;}
function identity(){return JSON.parse(composeOutput('exec','-T','account','node','-e',"const c=JSON.parse(require('fs').readFileSync('/run/local-stack/runtime.json'));console.log(JSON.stringify(c.fingerprints))"));}
function imageId(){return run('docker',['image','inspect',`waitron-cloud-local-stack:${tag}`,'--format','{{.Id}}'],{capture:true});}
async function phase(name,start,{writeMarkers=false,upgrade=false}={}){
 const healthyServices=await waitForStack(),apiPort=commandEnvironment.LOCAL_STACK_ACCOUNT_PORT;
 for(const path of ['/api/health/live','/api/health/ready'])await requestAccountHealth(apiPort,path);
 const gateway=JSON.parse(composeOutput('exec','-T','gateway','node','-e',"console.log(require('fs').readFileSync('/state/status.json','utf8'))"));if(!gateway.ready||gateway.routes!==0)throw new Error('gateway not ready');
 const storageObject=storageMarker(writeMarkers?'put':'get'),database=databaseMarker(writeMarkers),value={name,durationMs:Date.now()-start,imageId:imageId(),migrationCount:migrationCount(),healthyServices,identity:identity(),databaseMarker:database,storageObject};
 return upgrade?{...value,rebuilt:true,recreated:true}:value;
}
function bindings(){const config=JSON.parse(composeOutput('config','--format','json'));return Object.entries(config.services).flatMap(([service,value])=>(value.ports??[]).map(port=>({service,target:Number(port.target),hostIp:port.host_ip}))).sort((a,b)=>`${a.service}:${a.target}`.localeCompare(`${b.service}:${b.target}`));}
function resources(kind){const command={containers:['ps','-aq'],networks:['network','ls','-q'],volumes:['volume','ls','-q']}[kind];return run('docker',[...command,'--filter',`label=com.docker.compose.project=${project}`],{capture:true}).split('\n').filter(Boolean).length;}
function proofImages(){try{run('docker',['image','inspect',`waitron-cloud-local-stack:${tag}`],{capture:true});return 1;}catch{return 0;}}
async function lifecycle(mode){
 let stopped=false;
 await startLocalStack(mode,{run:(args,{capture=false}={})=>{
  if(mode==='upgrade'&&args[0]==='up')assert.equal(stopped,true,'upgrade must stop the old fleet first');
  const result=capture?composeOutput(...args):compose(...args);
  if(args[0]==='stop'){assert(services().every(service=>service.State!=='running'),'old containers must be stopped');stopped=true;}
  return result;
 },waitForReady:waitForStack});
}
let receipt,error;
try{
 const installStart=Date.now();await lifecycle('up');const install=await phase('install',installStart,{writeMarkers:true});
 const restartStart=Date.now();compose('stop');compose('start');const restart=await phase('restart',restartStart);
 const upgradeStart=Date.now();await lifecycle('upgrade');const upgrade=await phase('upgrade',upgradeStart,{upgrade:true});
 receipt={schemaVersion:1,cloud:{head:run('git',['rev-parse','HEAD'],{capture:true}),dirty:run('git',['status','--porcelain'],{capture:true})!==''},project,startedAt,completedAt:'',bindings:bindings(),phases:{install,restart,upgrade},rollback:{sameSchemaOnly:true,databaseRecoveryExcluded:true,incompatibleSchemaRollbackExcluded:true},cleanup:{containers:-1,networks:-1,volumes:-1,images:-1}};
}catch(cause){error=cause;try{compose('logs','--no-color');}catch{}}
finally{try{compose('down','--volumes','--remove-orphans');}catch(cause){error??=cause;}try{if(proofImages())run('docker',['image','rm',`waitron-cloud-local-stack:${tag}`],{capture:true});}catch(cause){error??=cause;}}
if(receipt){receipt.completedAt=new Date().toISOString();receipt.cleanup={containers:resources('containers'),networks:resources('networks'),volumes:resources('volumes'),images:proofImages()};await writeFile(output,JSON.stringify(receipt,null,2)+'\n');verifyLocalStackReceipt(receipt);console.log(`PASS: local stack lifecycle receipt ${output}`);}
if(error)throw error;
