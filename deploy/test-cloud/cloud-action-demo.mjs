import {fork} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {cloudActionDemoEnabled,CloudActionWorker} from '../../packages/registration/src/cloud-action-worker.ts';
import {proposeCloudAction} from '../../packages/registration/src/cloud-action-store.ts';
import {cloudActionCatalogue} from '../../packages/registration/src/cloud-actions.ts';
import {transaction} from '../../packages/registration/src/transaction.ts';
import {runWorkerLoop} from '../../packages/registration/src/worker-loop.ts';

export async function openSyntheticWorkload(directory,environment={}){
 if(!cloudActionDemoEnabled(environment))throw Error('cloud_action_demo_disabled');
 await mkdir(directory,{recursive:true,mode:0o700});
 const owned=await mkdtemp(join(directory,'workload-'));
 const script=join(owned,'worker.mjs');
 await writeFile(script,"process.on('disconnect',()=>process.exit());process.on('SIGTERM',()=>process.exit());process.send('ready');setInterval(()=>{},1000);",{mode:0o600});
 let child,closed=false;
 const start=async()=>{
  const next=fork(script,[],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH}});
  child=next;
  await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>{next.kill('SIGKILL');reject(Error('demo_start_timeout'));},5000);
   next.once('message',()=>{clearTimeout(deadline);resolve();});
   next.once('error',error=>{clearTimeout(deadline);reject(error);});
   next.once('exit',()=>{clearTimeout(deadline);reject(Error('demo_start_failed'));});
  });
 };
 const stop=async()=>{
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const current=child;
  await new Promise(resolve=>{current.once('exit',resolve);current.kill('SIGTERM');});
 };
 const load=async file=>{try{return JSON.parse(await readFile(join(directory,file),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const save=async(file,value)=>{const temporary=join(directory,randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,join(directory,file));};
 const health=async()=>({healthy:!!child&&child.exitCode===null&&child.signalCode===null,pid:child?.pid??null});
 try{await start();}catch(error){await stop();await rm(owned,{recursive:true,force:true});throw error;}
 return {
  health,
  async fail(){
   await stop();const occurrence='demo-'+randomUUID();
   const proposal={occurrence,cell:'demo-cell',target:'demo-worker',actionId:'cloud_restart',proposal:'Restart failed demo worker in place',evidence:occurrence+':stopped'};
   await save('failure.json',proposal);return proposal;
  },
  async pending(){return load('failure.json');},
  async drain(){
   const occurrence='demo-'+randomUUID();
   const proposal={occurrence,cell:'demo-cell',target:'demo-worker',actionId:'machine_drain',proposal:'Stop the owned demo worker',evidence:occurrence+':running:'+child?.pid};
   await save('failure.json',proposal);return proposal;
  },
  async eligible(request){
   const failure=await load('failure.json');
   const live=await health();
   return !closed&&failure&&['occurrence','cell','target','actionId','proposal','evidence'].every(key=>request[key]===failure[key])&&
    (request.actionId==='cloud_restart'&&!live.healthy||request.actionId==='machine_drain'&&live.healthy&&request.evidence===request.occurrence+':running:'+live.pid);
  },
  async restart(request){
   if(!await this.eligible(request))throw Error('demo_target_changed');
   if(request.actionId==='machine_drain')await stop();else await start();
   await save(request.effectId+'.json',{status:'confirmed'});
  },
  async observe(effectId){
   if(!/^[0-9a-f-]{36}$/.test(effectId))return 'unknown';
   return (await load(effectId+'.json'))?.status==='confirmed'?'confirmed':'unknown';
  },
  async close(){if(closed)return;closed=true;await stop();await rm(owned,{recursive:true,force:true});},
 };
}

export async function startCloudActionDemo({pool,outbox,operatorAccountId,directory,environment}){
 if(!operatorAccountId)throw Error('cloud_action_demo_operator_required');
 const workload=await openSyntheticWorkload(directory,environment),controller=new AbortController();
 const worker=new CloudActionWorker(pool,{demo:true,operatorAccountId,executor:workload});
 const running=runWorkerLoop({signal:controller.signal,concurrency:1,scheduleIntervalMs:1000,pollIntervalMs:1000,
  schedule:async()=>{
   try{await rm(join(directory,'fail'));await workload.fail();}catch(error){if(error.code!=='ENOENT')throw error;}
   try{await rm(join(directory,'drain'));await workload.drain();}catch(error){if(error.code!=='ENOENT')throw error;}
   const proposal=await workload.pending();
   if(proposal)await transaction(pool,client=>proposeCloudAction(client,proposal,cloudActionCatalogue.find(action=>action.id===proposal.actionId).policy,operatorAccountId,outbox));
  },
  runOnce:()=>worker.runOnce(),onError:()=>console.error('Synthetic Cloud action failed; inspect its saved status'),
 });
 return {async close(){controller.abort();await running;await workload.close();}};
}
