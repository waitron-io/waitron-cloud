// Only Docker is simulated; ownership, configuration, files, OpenSSL and stack orchestration are real.
import {registerHooks} from 'node:module';
import {spawnSync as actualSpawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fault=process.argv[2], cleanupFailure=process.argv[3];
const events=[], originalError=console.error;
console.error=(...args)=>{events.push('report');originalError(...args);};
const parent=realpathSync(mkdtempSync(join(tmpdir(),'cloud-startup-probe-')));
const source=join(parent,'source'),root=join(parent,'owned'),codeRoot=join(root,'code'),stateRoot=join(root,'state');
for(const path of [source,root,codeRoot,stateRoot])mkdirSync(path,{mode:0o700});
const token='a'.repeat(64),journal={path:join(root,'journal.json'),token},image='sha256:'+'b'.repeat(64);
writeFileSync(join(root,'.cloud-cost-owner'),token,{mode:0o600});
writeFileSync(journal.path,JSON.stringify({schemaVersion:1,source,root,ownershipToken:token}),{mode:0o600});
writeFileSync(join(stateRoot,'replay-config.json'),JSON.stringify({initial:{},config:{
 localEndpoints:{s3:'http://s3:8333',postgres:'postgresql://fixture:fixture@postgres:5432/postgres',smtp:'smtp://mailpit:1025',fiscal:'http://fiscal:8080',gateway:'https://gateway:8443'},
 senders:{fiscal:'disabled',mail:'capture',acme:'disabled',dns:'disabled'}}}),{mode:0o600});
let created=false,removed=false,project,plan;
const controller=new AbortController();
if(fault==='pre-cancelled')controller.abort();
if(fault==='reporting')console.error=()=>{throw Error('PRIVATE_CANARY');};
const roles=['postgres','s3','mailpit','waitron','fiscal','gateway'];
const networkId='c'.repeat(64), ids=roles.map((_,i)=>(i+1).toString().repeat(64));
const containers=()=>roles.map((role,i)=>({Id:ids[i],Name:'/'+plan.services[role].container_name,
 Config:{Image:image,User:`${process.getuid()}:${process.getgid()}`,Labels:{'io.waitron.cloud-cost.owner':token,'com.docker.compose.project':project,'io.waitron.cloud-cost.role':role},Env:['NODE_VERSION=26']},
 HostConfig:{ReadonlyRootfs:fault!=='policy',CapDrop:['ALL'],LogConfig:{Type:'none'},Privileged:false,NetworkMode:project,PidMode:'',IpcMode:'private',Dns:['127.0.0.1']},
 NetworkSettings:{Networks:{[project]:{NetworkID:networkId}},Ports:{}},Mounts:[]}));
const network=()=>({Id:networkId,Name:project,Internal:fault!=='isolation',Driver:'bridge',Labels:{'io.waitron.cloud-cost.owner':token}});
const error=()=>({status:1,stdout:'PRIVATE_CANARY',stderr:'postgresql://private:PRIVATE_CANARY@host/private',error:undefined,signal:null});
globalThis.startupProbe={abort:()=>controller.abort(),spawnSync(command,args,options){
 if(command!=='docker')throw Error('Unexpected external command');
 const ok=value=>({status:0,stdout:typeof value==='string'?value:JSON.stringify(value),stderr:'',signal:null});
 if(args[0]==='compose'){created=true;if(['compose','reporting','timeout','missing-docker','unclassified','revoked','hostile-message'].includes(fault)){if(fault==='unclassified')throw Error('PRIVATE_CANARY');if(fault==='revoked'){const value=Proxy.revocable({},{});value.revoke();throw value.proxy;}if(fault==='hostile-message')throw Object.defineProperty(Error(), 'message', {get(){throw Error('PRIVATE_CANARY');}});const result=error();if(fault==='timeout'||fault==='missing-docker'){result.status=null;result.error={code:fault==='timeout'?'ETIMEDOUT':'ENOENT',message:'PRIVATE_CANARY'};}return result;}return ok('');}
 if(args[0]==='rm'){events.push('remove');if(cleanupFailure==='revoked'){const value=Proxy.revocable({},{});value.revoke();throw value.proxy;}if(cleanupFailure==='true')return error();removed=true;return ok('');}
 if(args[0]==='network'&&args[1]==='rm'){created=false;return ok('');}
 if(args[0]==='ps'){if(fault==='discovery'&&!created)return error();return ok(created&&!removed?ids.join('\n'):'');}
 if(args[0]==='network'&&args[1]==='ls')return ok(created?networkId:'');
 if(args[0]==='network'&&args[1]==='inspect')return ok([network()]);
 if(args[0]==='inspect'&&args[1]==='--format'){
  events.push('state');
  if(args.at(-1)!==ids[1])throw Error('Wrong diagnostic target');
  if(fault==='state-missing')return {...error(),stderr:'Error response from daemon: No such container: PRIVATE_CANARY'};
  if(fault==='state-timeout')return actualSpawnSync(process.execPath,['-e',`setTimeout(()=>process.stdout.write(JSON.stringify({Status:'exited',Running:false,ExitCode:7,OOMKilled:true,Dead:false,Restarting:false})),2200)`],options);
  if(fault==='state-overflow')return actualSpawnSync(process.execPath,['-e',`process.stdout.write(JSON.stringify({Status:'exited',Running:false,ExitCode:7,OOMKilled:true,Dead:false,Restarting:false,Error:'PRIVATE_CANARY'.repeat(5000)}))`],options);
  if(fault==='state-throws')throw Error('PRIVATE_CANARY');
  if(fault==='state-malformed')return ok('PRIVATE_CANARY');
  if(fault==='state-private')return ok({Status:'PRIVATE_CANARY',Running:'PRIVATE_CANARY',ExitCode:999,OOMKilled:'PRIVATE_CANARY',Dead:'PRIVATE_CANARY',Restarting:'PRIVATE_CANARY',Error:'PRIVATE_CANARY'});
  if(fault.startsWith('state-invalid-')){const state={Status:'exited',Running:false,ExitCode:7,OOMKilled:true,Dead:false,Restarting:false};const field=fault.slice('state-invalid-'.length);state[field]=field==='ExitCode'?256:'PRIVATE_CANARY';return ok(state);}
  return ok({Status:'exited',Running:false,ExitCode:7,OOMKilled:true,Dead:false,Restarting:false,Error:'PRIVATE_CANARY',FinishedAt:'PRIVATE_CANARY'});
 }
 if(args[0]==='inspect')return ok(containers().filter(c=>args.includes(c.Id)).slice(0,fault==='resources'?5:6));
 if(args[0]==='exec'){
  if(fault.startsWith('state-')&&args[1]===ids[1])return {...error(),stderr:'Error response from daemon: Container PRIVATE_CANARY is not running'};
  if(fault==='isolation-command')return error();
  if(fault==='outbound-result')return {...error(),stdout:JSON.stringify({blockedConnections:3,blockedDns:1,localControl:true,secret:'PRIVATE_CANARY'}),stderr:'PRIVATE_CANARY'};
  if(fault==='outbound-runtime')return {...error(),stdout:'PRIVATE_CANARY',stderr:'Error: Cannot find module PRIVATE_CANARY'};
  const invalidCanary={
   'outbound-invalid-connections':{blockedConnections:4,blockedDns:2,localControl:true},
   'outbound-invalid-dns':{blockedConnections:3,blockedDns:3,localControl:true},
   'outbound-invalid-control':{blockedConnections:3,blockedDns:2,localControl:'PRIVATE_CANARY'},
  }[fault];
  if(invalidCanary)return {...error(),stdout:JSON.stringify(invalidCanary)};
  if(fault==='direct-isolation')throw Error('PRIVATE_CANARY');
  if(args.includes('check')){if(fault==='readiness-command')return error();if(fault==='handoff')controller.abort();return ok(fault==='readiness'?'PRIVATE_CANARY':{postgres:true,s3:true,mailpit:true,fiscal:true,waitron:true,gateway:true});}
  return ok({blockedConnections:3,blockedDns:2,localControl:true});
 }
 throw Error('Unexpected Docker command');
}};
registerHooks({resolve(specifier,context,next){if(specifier==='node:child_process'&&context.parentURL?.endsWith('/local.mjs'))
 return {url:'data:text/javascript,'+encodeURIComponent(`import {spawn as actualSpawn} from 'node:child_process';
 export const spawnSync=(...args)=>globalThis.startupProbe.spawnSync(...args);
 export const spawn=(command,args,options)=>{const child=actualSpawn(${JSON.stringify(fault==='missing-certificate'?'/nonexistent-cloud-cost-openssl':['certificate','certificate-cancelled'].includes(fault)?process.execPath:'/usr/bin/openssl')},${fault==='certificate-cancelled'?JSON.stringify(['-e','setInterval(()=>{},1000)']):fault==='certificate'?JSON.stringify(['-e',"process.stderr.write('PRIVATE_CANARY');process.exit(7)"]):'args'},options);${fault==='certificate-cancelled'?'setImmediate(()=>globalThis.startupProbe.abort());':''}return child;};`),shortCircuit:true};return next(specifier,context);}});
try{
 const local=await import('../local.mjs');const args={source,root,codeRoot,stateRoot,journal,image};
 const prepared=local.prepareIsolatedStack(args);project=prepared.project;plan=JSON.parse(readFileSync(prepared.file));
 if(fault==='ownership')writeFileSync(join(root,'.cloud-cost-owner'),'0'.repeat(64));
 if(fault==='plan')writeFileSync(prepared.file,'{}');
 if(fault==='config')writeFileSync(join(stateRoot,'replay-config.json'),'PRIVATE_CANARY');
 if(fault==='runtime')writeFileSync(join(codeRoot,'cost-stack-runtime.mjs'),'PRIVATE_CANARY');
 try{if(fault==='direct-isolation'){await local.proveDockerIsolation({...args,networkId,containerIds:ids});throw Error('expected refusal');}const stack=await local.startIsolatedStack({...args,prepared,signal:controller.signal});await stack.close();console.log(JSON.stringify({ready:Object.values(stack.ready).every(Boolean),removed}));}
 catch(error){console.log(JSON.stringify({message:error.message,diagnostic:error.diagnostic,removed,events}));}
}finally{rmSync(parent,{recursive:true,force:true});}
