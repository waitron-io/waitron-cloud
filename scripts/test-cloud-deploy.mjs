import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename,open,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {freemem} from 'node:os';
import {isIP} from 'node:net';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const project='waitron-cloud-test',idPattern=/^[0-9a-f]{64}$/,imagePattern=/^sha256:[0-9a-f]{64}$/;
const ports=new Set([3000,55432,1125,8125,8333,8443,51820]);
export function validatePreflight(value,{image,ownedIds=[]}={}){
 if(!imagePattern.test(image??''))throw new Error('test_cloud.image');
 const version=/^(\d+)\.(\d+)\.(\d+)/.exec(value?.composeVersion??'');
 const supported=version&&(Number(version[1])>2||Number(version[1])===2&&(Number(version[2])>24||Number(version[2])===24&&Number(version[3])>=4));
 if(!supported||value.architecture!=='amd64'||!Number.isFinite(value.availableMiB)||value.availableMiB<4096||!Number.isFinite(value.freeGiB)||value.freeGiB<20||!Array.isArray(value.containers)||!Array.isArray(value.networks)||!Array.isArray(value.listeners))throw new Error('test_cloud.preflight');
 if(value.containers.some(c=>c.project===project&&!ownedIds.includes(c.id)))throw new Error('test_cloud.preflight_project');
 if(!ownedIds.length&&value.listeners.some(p=>ports.has(Number(p.port))))throw new Error('test_cloud.preflight_ports');
 // Any overlapping network can route a trusted-proxy address to the wrong peer.
 if(value.networks.some(network=>{const [ip,prefix]=network.split('/');const bits=Number(prefix);if(isIP(ip)===6&&Number.isInteger(bits)&&bits>=0&&bits<=128)return false;if(isIP(ip)!==4||!Number.isInteger(bits)||bits<0||bits>32)return true;const numeric=s=>s.split('.').reduce((v,n)=>(v*256+Number(n))>>>0,0);const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (numeric(ip)&mask)===(numeric('10.79.0.0')&mask)||bits>24&&(numeric(ip)&0xffffff00)===(numeric('10.79.0.0')&0xffffff00);} )&&!ownedIds.length)throw new Error('test_cloud.preflight_network');
 return{ready:true};
}
export function validateDeployment(value,{image}){
 const services=value?.services;
 if(value?.name!==project||!services?.account||!services?.proxy||!services?.postgres||!services?.mailpit)throw new Error('test_cloud.rendered');
 for(const [name,service] of Object.entries(services)){
  if(!Number.isFinite(Number(service.mem_limit))||Number(service.mem_limit)<=0||service.build||service.volumes?.some(v=>v.type==='bind')||service.environment?.CLOUD_TEST_SERVICE_PLANS==='1'||service.environment?.CLOUD_TRANSLATION==='1'||!['postgres','mailpit'].includes(name)&&service.image!==image)throw new Error('test_cloud.rendered');
  for(const port of service.ports??[]){
   if(name==='proxy'){if(port.host_ip!=='192.168.10.10'||String(port.published)!=='3000'||port.target!==3000)throw new Error('test_cloud.rendered');}
   else if(port.host_ip!=='127.0.0.1'||name==='account')throw new Error('test_cloud.rendered');
  }
 }
 if(Object.values(services).reduce((sum,service)=>sum+Number(service.mem_limit),0)>2048*1024*1024)throw new Error('test_cloud.rendered');
 if(services.proxy.ports?.length!==1||services.account.ports?.length)throw new Error('test_cloud.rendered');
 for(const [name,expected] of [['postgres',[['55432',5432]]],['mailpit',[['1125',1025],['8125',8025]]]]){
  const actual=(services[name].ports??[]).map(p=>[String(p.published),p.target]);if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('test_cloud.rendered');
 }
 return{ready:true};
}
export async function execute(command,args,{input,environment={},signal}={}){
 const env={...Object.fromEntries(['PATH','HOME','LANG','TMPDIR','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','SSH_AUTH_SOCK'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])),...environment};
 if(input){
  await new Promise((yes,no)=>{
   const child=spawn(command,args,{cwd:root,env,stdio:['pipe','ignore','pipe']});let failed=false,hardStop;
   const fail=()=>{if(failed)return;failed=true;input.unpipe(child.stdin);input.destroy();child.kill('SIGTERM');hardStop=setTimeout(()=>child.kill('SIGKILL'),3000);hardStop.unref();};
   const deadline=setTimeout(fail,180000);deadline.unref();
   child.stderr.on('data',()=>{});child.once('error',fail);child.stdin.on('error',fail);input.once('error',fail);signal?.addEventListener('abort',fail,{once:true});
   child.once('close',code=>{clearTimeout(deadline);clearTimeout(hardStop);input.removeListener('error',fail);signal?.removeEventListener('abort',fail);code===0&&!failed?yes():no(new Error('test_cloud.image_load_failed'));});
   if(signal?.aborted)fail();else input.pipe(child.stdin);
  });return '';
 }
 return (await exec(command,args,{cwd:root,env,signal,timeout:180000,maxBuffer:1024*1024})).stdout;
}
export function parseLinuxListeners(ss){return ss.trim().split('\n').filter(Boolean).map(line=>{const fields=line.trim().split(/\s+/),match=/^(.*):(\d+)$/.exec(fields[4]);if(!match)throw new Error('test_cloud.inventory');return{address:match[1],port:Number(match[2]),protocol:fields[0]};});}
export async function inventory(run=execute){
 const [compose,engine,disk,containers,networks]=await Promise.all([
  run('docker',['compose','version','--short']),run('docker',['info','--format','{{json .Architecture}}']),run('df',['-Pk',root]),
  run('docker',['ps','-a','--no-trunc','--format','{{json .}}']),run('docker',['network','ls','-q'])
 ]);
 let availableMiB=freemem()/1048576,listeners=[];
 if(process.platform==='linux'){
  const mem=await readFile('/proc/meminfo','utf8');availableMiB=Number(/MemAvailable:\s+(\d+)/.exec(mem)?.[1])/1024;
  const ss=await run('ss',['-H','-lnut']);listeners=parseLinuxListeners(ss);
 }else{
  const output=await run('lsof',['-nP','-iTCP','-sTCP:LISTEN','-iUDP','-F','n']);listeners=output.split('\n').filter(line=>line.startsWith('n')).flatMap(line=>{const match=/:([0-9]+)(?:->.*)?$/.exec(line);return match?[{address:'host',port:Number(match[1]),protocol:'unknown'}]:[];});
 }
 const rows=containers.trim()?containers.trim().split('\n').map(line=>JSON.parse(line)):[];
 const watched=rows.filter(row=>/(?:^|,)com\.docker\.compose\.project=waitron-cloud-test(?:,|$)/.test(row.Labels??'')||['waitron-app-1','waitron-print-agent-1','waitron-mailpit-1'].includes(row.Names));
 const details=watched.length?JSON.parse('['+(await run('docker',['inspect','--format','{"id":{{json .Id}},"oom":{{json .State.OOMKilled}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}}',...watched.map(row=>row.ID)])).trim().split('\n').join(',')+']'):[];
 const ids=networks.trim().split(/\s+/).filter(Boolean);const subnets=ids.length?JSON.parse(await run('docker',['network','inspect','--format','{{json .IPAM.Config}}',...ids]).then(text=>'['+text.trim().split('\n').join(',')+']')).flat().filter(Boolean).map(n=>n.Subnet).filter(Boolean):[];
 const lines=disk.trim().split('\n'),fields=lines.at(-1).trim().split(/\s+/);
 return {composeVersion:compose.trim().replace(/^v/,''),architecture:['x86_64','amd64'].includes(JSON.parse(engine))?'amd64':JSON.parse(engine),availableMiB,freeGiB:Number(fields[3])/1048576,listeners,networks:subnets,containers:rows.map(row=>({id:row.ID,project:/(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(row.Labels??'')?.[1]??'',name:row.Names,state:row.State,...details.find(value=>value.id===row.ID)}))};
}

export function resourceGuard(baseline,sample,below=0){
 if(sample.containers.some(c=>c.project===project&&c.oom))throw new Error('test_cloud.oom');
 for(const before of baseline.containers.filter(c=>['waitron-app-1','waitron-print-agent-1','waitron-mailpit-1'].includes(c.name))){
  const after=sample.containers.find(c=>c.id===before.id);
  if(!after||after.state!==before.state||before.health==='healthy'&&after.health!=='healthy')throw new Error('test_cloud.waitron_health');
 }
 if(!Number.isFinite(sample.availableMiB)||!Number.isFinite(sample.freeGiB)||sample.availableMiB<2048||sample.freeGiB<15){if(++below>=3)throw new Error('test_cloud.resource_floor');return below;}
 return 0;
}
function assertState(state){if(!state||state.project!==project||!imagePattern.test(state.image)||!Array.isArray(state.ids)||!state.ids.every(id=>idPattern.test(id))||new Set(state.ids).size!==state.ids.length)throw new Error('test_cloud.ownership');return state;}
function assertOwned(state,current){assertState(state);if(current.containers.some(c=>c.project===project&&!state.ids.includes(c.id)))throw new Error('test_cloud.ownership');for(const id of state.ids)if(!current.containers.some(c=>c.id===id&&c.project===project))throw new Error('test_cloud.ownership');}
export async function deploy(mode,options){
 if(!['preflight','load','up','status','stop'].includes(mode))throw new Error('test_cloud.mode');
 if(options.signal?.aborted)throw new Error('test_cloud.cancelled');
 const run=options.execute??execute,inspect=options.inventory??(()=>inventory(run)),readState=options.readState??(async()=>null),saveState=options.saveState??(async()=>{});
 if(!imagePattern.test(options.image??''))throw new Error('test_cloud.image');
 const previous=await readState();if(previous){assertState(previous);if(previous.image!==options.image)throw new Error('test_cloud.image_change_requires_upgrade');}
 const current=await inspect();
 if(mode==='stop'){assertOwned(previous,current);if(previous.ids.length)await run('docker',['stop','--time','15',...previous.ids]);return{stopped:previous.ids};}
 if(mode==='status'){if(previous)assertOwned(previous,current);else if(current.containers.some(c=>c.project===project))throw new Error('test_cloud.ownership');return{project,containers:current.containers.filter(c=>previous?.ids.includes(c.id))};}
 if(previous)assertOwned(previous,current);
 validatePreflight(current,{image:options.image,ownedIds:previous?.ids??[]});
 if(mode==='preflight')return{ready:true};
 if(mode==='load'){
  if(!options.input)throw new Error('test_cloud.image_stream_required');
  await run('docker',['load'],{input:options.input,signal:options.signal});
  const loaded=JSON.parse(await run('docker',['image','inspect',options.image,'--format','{"Id":{{json .Id}},"Architecture":{{json .Architecture}},"Os":{{json .Os}}}']));
  if(loaded.Id!==options.image||loaded.Architecture!=='amd64'||loaded.Os!=='linux')throw new Error('test_cloud.image_platform');
  return{loaded:options.image};
 }
 const candidate=JSON.parse(await run('docker',['image','inspect',options.image,'--format','{"Id":{{json .Id}},"Architecture":{{json .Architecture}},"Os":{{json .Os}}}']));
 if(candidate.Id!==options.image||candidate.Architecture!=='amd64'||candidate.Os!=='linux')throw new Error('test_cloud.image_platform');
 const state={project,image:options.image,ids:previous?.ids??[]};
 const compose=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml'];
 const rendered=JSON.parse(await run('docker',[...compose,'--profile','*','config','--format','json'],{environment:{TEST_CLOUD_IMAGE:options.image,CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TRANSLATION:'0'}}));
 validateDeployment(rendered,{image:options.image});await saveState(state);
 let failure,monitorFailure,below=0,busy=false,activeSample=Promise.resolve();const abort=new AbortController();const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
 const sample=async()=>{const value=await inspect();below=resourceGuard(current,value,below);};
 const pause=()=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,5000);abort.signal.addEventListener('abort',done,{once:true});if(abort.signal.aborted)done();});
 const monitor=setInterval(()=>{if(busy)return;busy=true;activeSample=sample().catch(error=>{monitorFailure=error;abort.abort();}).finally(()=>{busy=false;});},5000);
 try{await run('docker',[...compose,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','120'],{environment:{TEST_CLOUD_IMAGE:options.image,CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TRANSLATION:'0'},signal:abort.signal});
  if(options.signal?.aborted)throw new Error('test_cloud.cancelled');
  for(let n=0;n<(options.settledSamples??12);n++){await pause();if(options.signal?.aborted)throw new Error('test_cloud.cancelled');if(monitorFailure)throw monitorFailure;}
 }
 catch(error){failure=options.signal?.aborted?new Error('test_cloud.cancelled'):monitorFailure??error;}
 finally{
  clearInterval(monitor);options.signal?.removeEventListener('abort',cancel);await activeSample;if(monitorFailure)failure=monitorFailure;
  let after;
  try{after=await inspect();}
  catch(inventoryError){
   try{
    const ids=(await run('docker',['ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+project])).trim().split(/\s+/).filter(Boolean);
    if(!ids.every(id=>idPattern.test(id)))throw new Error('test_cloud.ownership');
    const containers=ids.length?(await run('docker',['inspect','--format','{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}}}',...ids])).trim().split('\n').map(line=>JSON.parse(line)):[];
    if(containers.some(c=>c.project!==project)||containers.length!==ids.length)throw new Error('test_cloud.ownership');after={containers};
   }catch(cleanupError){
    try{await saveState(state);}catch{}if(state.ids.length)try{await run('docker',['stop','--time','15',...state.ids]);}catch{}
    throw new AggregateError([failure,inventoryError,cleanupError].filter(Boolean),'test_cloud.cleanup_incomplete');
   }
   failure??=inventoryError;
  }
  state.ids=after.containers.filter(c=>c.project===project).map(c=>c.id);assertState(state);
  let journalError;try{await saveState(state);}catch(error){journalError=error;}
  if((failure||journalError)&&state.ids.length){assertOwned(state,after);try{await run('docker',['stop','--time','15',...state.ids]);}catch(stopError){throw new AggregateError([failure,journalError,stopError].filter(Boolean),'test_cloud.cleanup_incomplete');}}
  if(journalError)throw new AggregateError([failure,journalError].filter(Boolean),'test_cloud.state_write_failed');
 }
 if(failure)throw failure;
 return{project,image:options.image,ids:state.ids};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [mode,image]=process.argv.slice(2);if(process.argv.length!==4)throw Error();
  const path=resolve(root,'.local-stack/test-cloud-state.json');
  const readState=async()=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const saveState=async value=>{await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});await rename(path+'.tmp',path);};
  await mkdir(dirname(path),{recursive:true,mode:0o700});const lock=path+'.lock';const handle=await open(lock,'wx',0o600);
  const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  try{console.log(JSON.stringify(await deploy(mode,{image,input:mode==='load'?process.stdin:undefined,readState,saveState,signal:stop.signal})));}
  finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);await handle.close();await rm(lock);}
 }catch(error){console.error(error?.message==='test_cloud.cleanup_incomplete'?'Test Cloud cleanup is incomplete; retain its state and inspect the recorded IDs':'Test Cloud operation refused or failed; check image, capacity, ports and recorded ownership');process.exitCode=1;}
}
