import {get} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';

const required=['account','email-worker','gateway','gateway-manifest','mailpit','monitor-worker','postgres','remote-probe','storage','usage-reconciler'];
const healthServices=new Set(['account','gateway','mailpit','postgres','storage']);

export function parseComposeServices(text){
 const value=text.trim();if(!value)return[];
 return value.startsWith('[')?JSON.parse(value):value.split('\n').map(line=>JSON.parse(line));
}

export function stackReadiness(services){
 const failed=services.find(item=>item.State==='exited'&&![0,'0'].includes(item.ExitCode))?.Service;
 const byName=new Map(services.map(item=>[item.Service,item]));
 const ready=required.every(name=>byName.get(name)?.State==='running'&&(!healthServices.has(name)||byName.get(name)?.Health==='healthy'));
 return {ready,failed};
}

export async function waitForLocalStack(read,{timeoutMs=120000,delayFn=delay}={}){
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){const status=stackReadiness(parseComposeServices(read()));if(status.failed)throw new Error(`local stack service failed: ${status.failed}`);if(status.ready)return;await delayFn(500);}
 throw new Error('local stack health timeout');
}

export function requestAccountHealth(port,path){
 return new Promise((resolve,reject)=>{
  const request=get({host:'127.0.0.1',port,path,headers:{host:'localhost:3000'},timeout:3000},response=>{
   response.resume();
   response.once('end',()=>{
    if(response.statusCode!==undefined&&response.statusCode>=200&&response.statusCode<300)resolve();
    else reject(new Error(`account health failed: ${path} (${response.statusCode??'no status'})`));
   });
  });
  request.once('timeout',()=>request.destroy(new Error(`account health failed: ${path} (timeout)`)));
  request.once('error',reject);
 });
}
