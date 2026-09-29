import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const output=resolve(process.argv[2]??'/tmp/cloud-scheduled-usage-receipt.json');
if(process.argv.length>3||!process.env.NODE_AUTH_TOKEN)throw new Error('Set NODE_AUTH_TOKEN to a package-read token');
const id=randomUUID().slice(0,8),project=`cloud-usage-proof-${id}`,tag=`usage-proof-${id}`;
const env={...process.env,LOCAL_STACK_IMAGE_TAG:tag,LOCAL_STACK_POSTGRES_PORT:'0',CLOUD_USAGE_INTERVAL_MS:'1000',CLOUD_USAGE_BATCH_SIZE:'1'};
function run(args,capture=false){return execFileSync('docker',args,{env,encoding:'utf8',timeout:600000,stdio:capture?['ignore','pipe','pipe']:'inherit'})?.trim()??'';}
const compose=(...args)=>run(['compose','-p',project,...args]);
const capture=(...args)=>run(['compose','-p',project,...args],true);
const observe=mode=>JSON.parse(capture('run','--rm','--no-deps','usage-reconciler','node','deploy/local-stack/usage-proof.mjs',mode));
async function until(check){const end=Date.now()+30000;while(Date.now()<end){const state=observe('status');if(check(state))return state;await delay(250);}throw new Error('usage proof timed out');}
let receipt,error;
try{
 compose('build','bootstrap');compose('up','-d','--no-build','usage-reconciler');compose('wait','bootstrap','migrate');
 const initial=await until(state=>state.usage.code==='current');assert.equal(initial.events,0);
 observe('seed');observe('seed');
 const automatic=await until(state=>state.events===2&&state.usage.code==='current');assert.equal(automatic.organisations,2);
 const service=capture('ps','-a','--format','json','usage-reconciler');const parsed=JSON.parse(service);assert.equal((Array.isArray(parsed)?parsed[0]:parsed).State,'running');
 compose('stop','usage-reconciler');
 const stopped=await until(state=>state.usage.code==='stale');assert.equal(stopped.events,2);
 observe('seed');await delay(1100);const waiting=observe('status');assert.equal(waiting.events,2);assert.equal(waiting.usage.code,'stale');
 compose('start','usage-reconciler');const restarted=await until(state=>state.events===3&&state.usage.code==='current');assert.equal(restarted.organisations,3);
 assert(Date.parse(restarted.usage.oldestCaughtUpAt)>Date.parse(automatic.usage.oldestCaughtUpAt));
 receipt={version:1,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',project,automatic,stopped,waiting,restarted,intervalMs:1000,batchSize:1};
}catch(cause){error=cause;try{compose('logs','--no-color','usage-reconciler');}catch{}}
finally{
 try{compose('down','--volumes','--remove-orphans');}catch(cause){error??=cause;}
 try{run(['image','rm',`waitron-cloud-local-stack:${tag}`],true);}catch(cause){error??=cause;}
}
const cleanup={};
for(const [kind,args] of Object.entries({containers:['ps','-aq'],volumes:['volume','ls','-q'],networks:['network','ls','-q']})){
 cleanup[kind]=run([...args,'--filter',`label=com.docker.compose.project=${project}`],true).split('\n').filter(Boolean).length;
}
assert.deepEqual(cleanup,{containers:0,volumes:0,networks:0});
if(error)throw error;
receipt.cleanup=cleanup;await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(`PASS scheduled usage proof: ${output}`);
