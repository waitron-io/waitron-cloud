import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {freemem} from 'node:os';
import {isIP} from 'node:net';
import {withTestCloudProjectLock} from './test-cloud-project-lock.mjs';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const project='waitron-cloud-test',idPattern=/^[0-9a-f]{64}$/,imagePattern=/^sha256:[0-9a-f]{64}$/;
const ports=new Set([3000,55432,1125,8125,8333,8443,51820]);
// The transferred driver has no dependency on the source checkout.
function canonicalHttpsOrigin(origin){
 try{const url=new URL(origin);if(url.protocol!=='https:'||url.port||url.origin!==origin||url.username||url.password)throw Error();return origin;}catch{throw new Error('test_cloud.origin');}
}
function targetLimits(target){
 if(target==='lan')return{availableMiB:4096,freeGiB:20,floorMiB:2048,floorGiB:15,ports};
 if(target==='amazon')return{availableMiB:2048,freeGiB:8,floorMiB:512,floorGiB:4,ports:new Set([80,443,51820])};
 throw new Error('test_cloud.target');
}
export function validatePreflight(value,{image,ownedIds=[],target='lan'}={}){
 const limits=targetLimits(target);
 if(!imagePattern.test(image??''))throw new Error('test_cloud.image');
 const version=/^(\d+)\.(\d+)\.(\d+)/.exec(value?.composeVersion??'');
 const supported=version&&(Number(version[1])>2||Number(version[1])===2&&(Number(version[2])>24||Number(version[2])===24&&Number(version[3])>=4));
 if(!supported||value.architecture!=='amd64'||!Number.isFinite(value.availableMiB)||value.availableMiB<limits.availableMiB||!Number.isFinite(value.freeGiB)||value.freeGiB<limits.freeGiB||!Array.isArray(value.containers)||!Array.isArray(value.networks)||!Array.isArray(value.listeners))throw new Error('test_cloud.preflight');
 if(value.containers.some(c=>c.project===project&&!ownedIds.includes(c.id)))throw new Error('test_cloud.preflight_project');
 if(!ownedIds.length&&value.listeners.some(p=>limits.ports.has(Number(p.port))))throw new Error('test_cloud.preflight_ports');
 // Any overlapping network can route a trusted-proxy address to the wrong peer.
 if(value.networks.some(network=>{const [ip,prefix]=network.split('/');const bits=Number(prefix);if(isIP(ip)===6&&Number.isInteger(bits)&&bits>=0&&bits<=128)return false;if(isIP(ip)!==4||!Number.isInteger(bits)||bits<0||bits>32)return true;const numeric=s=>s.split('.').reduce((v,n)=>(v*256+Number(n))>>>0,0);const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (numeric(ip)&mask)===(numeric('10.79.0.0')&mask)||bits>24&&(numeric(ip)&0xffffff00)===(numeric('10.79.0.0')&0xffffff00);} )&&!ownedIds.length)throw new Error('test_cloud.preflight_network');
 return{ready:true};
}
const backupRoles=new Set(['bootstrap','account','proxy','backup-worker']);
const sesSettingsTarget='/run/test-cloud-ses.json';
function containsPath(directory,file){
 return file===directory||file.startsWith(directory.endsWith('/')?directory:directory+'/');
}
const dockerSocket='/var/run/docker.sock';
const workerStage='/opt/waitron-cloud/amazon-backup-stages/worker/mount/work';
const verifierStage='/opt/waitron-cloud/amazon-backup-stages/verifier/mount/work';
const exitStageTarget='/run/backup-stage';
function isExplicitBind(mount){
 // Some Compose versions omit false from the rendered bind object.
 return mount.type==='bind'&&mount.bind!=null&&(mount.bind.create_host_path===undefined||mount.bind.create_host_path===false);
}
function isBackupStage(mount){
 return isExplicitBind(mount)&&mount.read_only!==true&&
  (mount.source===workerStage&&mount.target==='/run/backup-stage'||mount.source===verifierStage&&mount.target===verifierStage);
}
function isBackupSocket(mount){
 return isExplicitBind(mount)&&mount.source===dockerSocket&&mount.target===dockerSocket&&mount.read_only===true;
}
function validateBackupWorker(services,image){
 const worker=services['backup-worker'],mounts=worker?.volumes??[];
 if(!worker?.read_only||worker.ports?.length||worker.profiles?.length||worker.environment?.TEST_CLOUD_AMAZON!=='1'||
  worker.environment.CLOUD_VERIFIER_IMAGE!==image||worker.environment.CLOUD_VERIFIER_SCRATCH_VOLUME!=='amazon-test-verifier-scratch'||
  worker.environment.CLOUD_BACKUP_STAGE_ROOT!=='/run/backup-stage'||
  worker.cap_drop?.length!==1||worker.cap_drop[0]!=='ALL'||worker.cap_add?.length!==2||
  !worker.cap_add.includes('DAC_OVERRIDE')||!worker.cap_add.includes('FOWNER')||
  worker.security_opt?.length!==1||worker.security_opt[0]!=='no-new-privileges:true'||
  mounts.length!==5||!mounts.some(isBackupSocket)||
  !mounts.some(v=>v.source===workerStage&&isBackupStage(v))||
  !mounts.some(v=>v.source===verifierStage&&isBackupStage(v))||
  !mounts.some(v=>v.type==='volume'&&v.source==='local-stack-config'&&v.target==='/run/local-stack'&&v.read_only===true)||
  !mounts.some(v=>v.type==='volume'&&v.source==='test-backup-verifier-state'&&v.target==='/run/backup-verifier'&&!v.read_only))throw new Error('test_cloud.rendered');
}
export function validateDeployment(value,{image,target='lan',origin,certificateSource,backupVerifierImage,sesSettingsSource,exitStageSource}){
 targetLimits(target);const amazon=target==='amazon',services=value?.services,backups=backupVerifierImage!==undefined;
 if(exitStageSource!==undefined&&(amazon||!isAbsolute(exitStageSource)||exitStageSource==='/'))throw Error('test_cloud.rendered');
 if(backups&&(!amazon||!imagePattern.test(backupVerifierImage)))throw new Error('test_cloud.rendered');
 if(value?.name!==project||!services?.account||!services?.proxy||!services?.postgres||!services?.mailpit)throw new Error('test_cloud.rendered');
 if(backups)validateBackupWorker(services,backupVerifierImage);
 if(sesSettingsSource!==undefined&&(!amazon||!services['email-worker']||!isAbsolute(sesSettingsSource)))throw new Error('test_cloud.rendered');
 for(const [name,service] of Object.entries(services)){
  const exitAccount=exitStageSource!==undefined&&name==='account';
  const exitMounts=(service.volumes??[]).filter(v=>(exitStageSource!==undefined&&v.source===exitStageSource)||name==='account'&&v.target===exitStageTarget);
  const [exitMount]=exitMounts;
  if(service.environment?.CLOUD_EXIT_STAGE_ROOT!==(exitAccount?exitStageTarget:undefined)||exitMounts.length!==(exitAccount?1:0)||
    exitAccount&&(!isExplicitBind(exitMount)||exitMount.source!==exitStageSource||exitMount.target!==exitStageTarget||exitMount.read_only===true))throw Error('test_cloud.rendered');
  const sesWorker=sesSettingsSource!==undefined&&name==='email-worker';
  const sesMounts=(service.volumes??[]).filter(v=>v.target===sesSettingsTarget||sesSettingsSource!==undefined&&v.source===sesSettingsSource);
  const [sesMount]=sesMounts;
  if(service.environment?.TEST_CLOUD_AMAZON_SES!==(sesWorker?'1':undefined)||
   sesMounts.length!==(sesWorker?1:0)||sesWorker&&(!isExplicitBind(sesMount)||sesMount.source!==sesSettingsSource||
    sesMount.target!==sesSettingsTarget||sesMount.read_only!==true))throw new Error('test_cloud.rendered');
  // A bind of a parent directory would expose the settings despite a separate worker mount.
  if(sesSettingsSource&&service.volumes?.some(v=>{
   if(v===sesMount||v.type!=='bind'||!isAbsolute(v.source))return false;
   const mounted=resolve(v.source);
   return containsPath(mounted,sesSettingsSource)||containsPath(sesSettingsSource,mounted);
  }))throw new Error('test_cloud.rendered');
  if(service.environment?.CLOUD_TEST_AMAZON_BACKUPS!==(backups&&backupRoles.has(name)?'1':undefined)||
   name!=='backup-worker'&&service.volumes?.some(v=>v.source==='test-backup-verifier-state'||v.target==='/run/backup-verifier'))throw new Error('test_cloud.rendered');
  if(!Number.isFinite(Number(service.mem_limit))||Number(service.mem_limit)<=0||service.build||service.volumes?.some(v=>v.type==='bind'&&!(amazon&&name==='bootstrap'&&v.source===resolve(certificateSource)&&v.target==='/run/public-certificate'&&v.read_only===true||amazon&&name==='http-challenges'&&v.source==='/opt/waitron-cloud/acme-webroot'&&v.target==='/run/account-webroot'&&v.read_only===true||backups&&name==='backup-worker'&&(isBackupSocket(v)||isBackupStage(v))||sesWorker&&v===sesMount||exitAccount&&v===exitMount))||service.environment?.CLOUD_TEST_SERVICE_PLANS==='1'||service.environment?.CLOUD_TRANSLATION==='1'||!['postgres','mailpit'].includes(name)&&service.image!==image)throw new Error('test_cloud.rendered');
  for(const port of service.ports??[]){
   if(name==='proxy'){if(port.host_ip!==(amazon?'0.0.0.0':'192.168.10.10')||String(port.published)!==(amazon?'443':'3000')||port.target!==(amazon?443:3000)||port.protocol&&port.protocol!=='tcp')throw new Error('test_cloud.rendered');}
   else if(amazon&&name==='http-challenges'){if(port.host_ip!=='0.0.0.0'||String(port.published)!=='80'||port.target!==8080||port.protocol!=='tcp')throw new Error('test_cloud.rendered');}
   else if(amazon&&name==='gateway'){if(port.host_ip!=='0.0.0.0'||String(port.published)!=='51820'||port.target!==51820||port.protocol!=='udp')throw new Error('test_cloud.rendered');}
   else if(port.host_ip!=='127.0.0.1'||(amazon?['account','postgres','mailpit','storage','gateway'].includes(name):name==='account'))throw new Error('test_cloud.rendered');
  }
 }
 if(amazon){
  const challenge=services['http-challenges'],manifest=services['gateway-manifest'];
  if(challenge?.restart!=='unless-stopped'||challenge?.ports?.length!==1||services.gateway?.ports?.length!==1||Number(challenge.mem_limit)!==64*1024*1024||challenge.depends_on||challenge.volumes?.length!==2||!challenge.volumes.every(v=>v.read_only===true)||!challenge.volumes.some(v=>v.type==='bind'&&v.target==='/run/account-webroot')||!challenge.volumes.some(v=>v.source==='test-cloud-http-challenges'&&v.target==='/run/remote-challenges')||!manifest?.volumes?.some(v=>v.source==='test-cloud-http-challenges'&&v.target==='/run/remote-challenges'&&!v.read_only))throw new Error('test_cloud.rendered');
  for(const[name,service]of Object.entries(services))if(!['gateway-manifest','http-challenges'].includes(name)&&service.volumes?.some(v=>v.source==='test-cloud-http-challenges'))throw new Error('test_cloud.rendered');
  for(const [source,target,writer,reader] of [
   ['test-cloud-tls-challenges','/run/remote-tls-challenges','gateway-manifest','gateway'],
   ['test-cloud-gateway-status','/run/remote-gateway-status','gateway','gateway-manifest']
  ])for(const [name,service] of Object.entries(services)){
   const mounts=(service.volumes??[]).filter(v=>v.source===source||v.target===target);
   if(name===writer||name===reader){
    const [mount]=mounts;
    if(mounts.length!==1||mount.type!=='volume'||mount.source!==source||mount.target!==target||(mount.read_only===true)!==(name===reader))throw new Error('test_cloud.rendered');
   }else if(mounts.length)throw new Error('test_cloud.rendered');
  }
  const bundle=services.bootstrap?.volumes?.find(v=>v.target==='/run/proxy-certificate');
  if(bundle?.source!=='test-cloud-public-certificate'||!services.proxy.volumes?.some(v=>v.source===bundle.source&&v.target==='/run/proxy-certificate'&&v.read_only===true))throw new Error('test_cloud.rendered');
  for(const[name,service]of Object.entries(services)){
   if(!['bootstrap','proxy'].includes(name)&&service.volumes?.some(v=>v.source===bundle.source))throw new Error('test_cloud.rendered');
   if(service.environment?.CLOUD_TEST_SERVICE_PLANS!==undefined&&(service.environment.CLOUD_TEST_SERVICE_PLANS!=='0'||service.environment.CLOUD_VENUE_SERVICE_LEVELS!=='test'))throw new Error('test_cloud.rendered');
  }
  for(const name of ['bootstrap','account','email-worker'])if(services[name]?.environment?.TEST_CLOUD_ORIGIN!==origin)throw new Error('test_cloud.rendered');
 }
 // The backup override leaves the unavailable profile off when starting Compose.
 const budgeted=Object.values(services).filter(s=>!backups||s.profiles?.length!==1||s.profiles[0]!=='unavailable');
 if(budgeted.reduce((sum,service)=>sum+Number(service.mem_limit),0)>(amazon?2112:2048)*1024*1024)throw new Error('test_cloud.rendered');
 if(services.proxy.ports?.length!==1||services.account.ports?.length)throw new Error('test_cloud.rendered');
 for(const [name,expected] of [['postgres',[['55432',5432]]],['mailpit',[['1125',1025],['8125',8025]]]]){
  const actual=(services[name].ports??[]).map(p=>[String(p.published),p.target]);if(JSON.stringify(actual)!==JSON.stringify(amazon?[]:expected))throw new Error('test_cloud.rendered');
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
const waitronContainers=['waitron-app-1','waitron-print-agent-1','waitron-mailpit-1'];
const isCloudRow=row=>/(?:^|,)com\.docker\.compose\.project=waitron-cloud-test(?:,|$)/.test(row.Labels??'');
const parseRows=output=>output.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));

async function inspectWatchedContainers(run,rows){
 const watched=rows.filter(row=>isCloudRow(row)||waitronContainers.includes(row.Names));
 if(!watched.length)return [];
 return parseRows(await run('docker',['inspect','--format','{"id":{{json .Id}},"oom":{{json .State.OOMKilled}},"health":{{with index .State "Health"}}{{json .Status}}{{else}}null{{end}}}',...watched.map(row=>row.ID)]));
}
function isCloudReplacement(error,rows){
 if(error?.code!==1||typeof error.stderr!=='string')return false;
 const lines=error.stderr.split('\n').map(line=>line.trim()).filter(Boolean);
 return lines.length>0&&lines.every(line=>{
  const missing=/^error: no such object: ([0-9a-f]{64})$/i.exec(line)?.[1];
  return missing!==undefined&&rows.some(row=>row.ID===missing&&isCloudRow(row)&&!waitronContainers.includes(row.Names));
 });
}

export async function inventory(run=execute){
 const listContainers=async()=>parseRows(await run('docker',['ps','-a','--no-trunc','--format','{{json .}}']));
 const [compose,engine,disk,containers,networks]=await Promise.all([
  run('docker',['compose','version','--short']),run('docker',['info','--format','{{json .Architecture}}']),run('df',['-Pk',root]),
  listContainers(),run('docker',['network','ls','-q'])
 ]);
 let availableMiB=freemem()/1048576,listeners=[];
 if(process.platform==='linux'){
  const mem=await readFile('/proc/meminfo','utf8');availableMiB=Number(/MemAvailable:\s+(\d+)/.exec(mem)?.[1])/1024;
  const ss=await run('ss',['-H','-lnut']);listeners=parseLinuxListeners(ss);
 }else{
  const output=await run('lsof',['-nP','-iTCP','-sTCP:LISTEN','-iUDP','-F','n']);listeners=output.split('\n').filter(line=>line.startsWith('n')).flatMap(line=>{const match=/:([0-9]+)(?:->.*)?$/.exec(line);return match?[{address:'host',port:Number(match[1]),protocol:'unknown'}]:[];});
 }
 let rows=containers,details;
 try{details=await inspectWatchedContainers(run,rows);}
 catch(error){
  if(!isCloudReplacement(error,rows))throw error;
  // Compose may remove a Cloud container between list and inspect. Use one fresh sample.
  rows=await listContainers();
  details=await inspectWatchedContainers(run,rows);
 }
 const ids=networks.trim().split(/\s+/).filter(Boolean);const subnets=ids.length?JSON.parse(await run('docker',['network','inspect','--format','{{json .IPAM.Config}}',...ids]).then(text=>'['+text.trim().split('\n').join(',')+']')).flat().filter(Boolean).map(n=>n.Subnet).filter(Boolean):[];
 const lines=disk.trim().split('\n'),fields=lines.at(-1).trim().split(/\s+/);
 return {composeVersion:compose.trim().replace(/^v/,''),architecture:['x86_64','amd64'].includes(JSON.parse(engine))?'amd64':JSON.parse(engine),availableMiB,freeGiB:Number(fields[3])/1048576,listeners,networks:subnets,containers:rows.map(row=>({id:row.ID,project:/(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(row.Labels??'')?.[1]??'',name:row.Names,state:row.State,...details.find(value=>value.id===row.ID)}))};
}

export function resourceGuard(baseline,sample,below=0,{target='lan'}={}){
 const limits=targetLimits(target);
 if(sample.containers.some(c=>c.project===project&&c.oom))throw new Error('test_cloud.oom');
 for(const before of baseline.containers.filter(c=>waitronContainers.includes(c.name))){
  const after=sample.containers.find(c=>c.id===before.id);
  if(!after||after.state!==before.state||before.health==='healthy'&&after.health!=='healthy')throw new Error('test_cloud.waitron_health');
 }
 if(!Number.isFinite(sample.availableMiB)||!Number.isFinite(sample.freeGiB)||sample.availableMiB<limits.floorMiB||sample.freeGiB<limits.floorGiB){if(++below>=3)throw new Error('test_cloud.resource_floor');return below;}
 return 0;
}
function assertState(state){if(!state||state.project!==project||!imagePattern.test(state.image)||!Array.isArray(state.ids)||!state.ids.every(id=>idPattern.test(id))||new Set(state.ids).size!==state.ids.length)throw new Error('test_cloud.ownership');return state;}
function assertOwned(state,current){assertState(state);if(current.containers.some(c=>c.project===project&&!state.ids.includes(c.id)))throw new Error('test_cloud.ownership');for(const id of state.ids)if(!current.containers.some(c=>c.id===id&&c.project===project))throw new Error('test_cloud.ownership');}
export async function deploy(mode,options){
 const target=options.target??'lan',backupVerifierImage=options.backupVerifierImage;targetLimits(target);
 if(backupVerifierImage!==undefined&&(mode!=='up'||target!=='amazon'||!imagePattern.test(backupVerifierImage)))throw new Error('test_cloud.amazon_backups');
 let origin,certificateSource,sesSettingsSource,exitStageSource;
 if(options.exitStageSource!==undefined){
  if(mode!=='up'||target!=='lan'||!isAbsolute(options.exitStageSource)||resolve(options.exitStageSource)==='/')throw Error('test_cloud.exit_stage');
  exitStageSource=resolve(options.exitStageSource);
 }
 if(options.sesSettingsSource!==undefined){
  if(mode!=='up'||target!=='amazon'||!isAbsolute(options.sesSettingsSource))throw new Error('test_cloud.amazon_ses');
  sesSettingsSource=resolve(options.sesSettingsSource);
 }
 if(mode==='up'&&target==='amazon'){origin=canonicalHttpsOrigin(options.origin);if(!isAbsolute(options.certificateSource??''))throw new Error('test_cloud.certificate_source');certificateSource=resolve(options.certificateSource);}
 if(!['preflight','load','up','status','stop'].includes(mode))throw new Error('test_cloud.mode');
 if(options.signal?.aborted)throw new Error('test_cloud.cancelled');
 const run=options.execute??execute,inspect=options.inventory??(()=>inventory(run)),readState=options.readState??(async()=>null),saveState=options.saveState??(async()=>{});
 if(!imagePattern.test(options.image??''))throw new Error('test_cloud.image');
 const previous=await readState();if(previous){assertState(previous);if(previous.image!==options.image)throw new Error('test_cloud.image_change_requires_upgrade');}
 const current=await inspect();
 if(mode==='stop'){assertOwned(previous,current);if(previous.ids.length)await run('docker',['stop','--time','15',...previous.ids]);return{stopped:previous.ids};}
 if(mode==='status'){if(previous)assertOwned(previous,current);else if(current.containers.some(c=>c.project===project))throw new Error('test_cloud.ownership');return{project,containers:current.containers.filter(c=>previous?.ids.includes(c.id))};}
 if(previous)assertOwned(previous,current);
 validatePreflight(current,{image:options.image,ownedIds:previous?.ids??[],target});
 if(mode==='preflight')return{ready:true};
 if(mode==='load'){
  if(!options.input)throw new Error('test_cloud.image_stream_required');
  await run('docker',['load'],{input:options.input,signal:options.signal});
  const loaded=JSON.parse(await run('docker',['image','inspect',options.image,'--format','{"Id":{{json .Id}},"Architecture":{{json .Architecture}},"Os":{{json .Os}}}']));
  if(loaded.Id!==options.image||loaded.Architecture!=='amd64'||loaded.Os!=='linux')throw new Error('test_cloud.image_platform');
  return{loaded:options.image};
 }
 for(const image of [options.image,...(backupVerifierImage?[backupVerifierImage]:[])]){
  const candidate=JSON.parse(await run('docker',['image','inspect',image,'--format','{"Id":{{json .Id}},"Architecture":{{json .Architecture}},"Os":{{json .Os}}}']));
  if(candidate.Id!==image||candidate.Architecture!=='amd64'||candidate.Os!=='linux')throw new Error('test_cloud.image_platform');
 }
 const state={project,image:options.image,ids:previous?.ids??[]};
 const compose=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml'];
 if(target==='amazon')compose.push('-f','deploy/test-cloud/compose.amazon.yaml');
 if(sesSettingsSource)compose.push('-f','deploy/test-cloud/compose.amazon-ses.yaml');
 if(backupVerifierImage)compose.push('-f','deploy/test-cloud/compose.amazon-backups.yaml');
 if(exitStageSource)compose.push('-f','deploy/test-cloud/compose.exit-stage.yaml');
 const environment={TEST_CLOUD_IMAGE:options.image,CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TRANSLATION:'0',...(target==='amazon'?{TEST_CLOUD_ORIGIN:origin,TEST_CLOUD_CERTIFICATE_SOURCE:certificateSource}:{}),...(backupVerifierImage?{CLOUD_VERIFIER_IMAGE:backupVerifierImage}:{}),...(sesSettingsSource?{TEST_CLOUD_SES_SETTINGS_SOURCE:sesSettingsSource}:{}),...(exitStageSource?{TEST_CLOUD_ACCOUNT_BACKUP_STAGE:exitStageSource}:{})};
 const rendered=JSON.parse(await run('docker',[...compose,'--profile','*','config','--format','json'],{environment}));
 validateDeployment(rendered,{image:options.image,target,origin,certificateSource,backupVerifierImage,sesSettingsSource,exitStageSource});await saveState(state);
 let failure,monitorFailure,below=0,busy=false,activeSample=Promise.resolve();const abort=new AbortController();const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
 const sample=async()=>{const value=await inspect();below=resourceGuard(current,value,below,{target});};
 const pause=()=>new Promise(resolve=>{const done=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,5000);abort.signal.addEventListener('abort',done,{once:true});if(abort.signal.aborted)done();});
 const monitor=setInterval(()=>{if(busy)return;busy=true;activeSample=sample().catch(error=>{monitorFailure=error;abort.abort();}).finally(()=>{busy=false;});},5000);
 try{await run('docker',[...compose,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','120'],{environment,signal:abort.signal});
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
function printDeploymentError(error){
 if(error?.message)console.error(error.message);
 if(error instanceof AggregateError)for(const cause of error.errors)printDeploymentError(cause);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [mode,image,target='lan']=process.argv.slice(2);if(![4,5].includes(process.argv.length))throw Error();
  const path=resolve(root,'.local-stack/test-cloud-state.json');
  const readState=async()=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const saveState=async value=>{await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});await rename(path+'.tmp',path);};
  await withTestCloudProjectLock(async()=>{
  const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  try{console.log(JSON.stringify(await deploy(mode,{image,target,origin:process.env.TEST_CLOUD_ORIGIN,certificateSource:process.env.TEST_CLOUD_CERTIFICATE_SOURCE,backupVerifierImage:mode==='up'?process.env.CLOUD_TEST_AMAZON_VERIFIER_IMAGE:undefined,sesSettingsSource:mode==='up'?process.env.TEST_CLOUD_SES_SETTINGS_SOURCE:undefined,exitStageSource:mode==='up'?process.env.TEST_CLOUD_ACCOUNT_BACKUP_STAGE:undefined,input:mode==='load'?process.stdin:undefined,readState,saveState,signal:stop.signal})));}
  finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
  });
 }catch(error){console.error(error?.message==='test_cloud.cleanup_incomplete'?'Test Cloud cleanup is incomplete; retain its state and inspect the recorded IDs':'Test Cloud refused or failed; check target, HTTPS origin, certificate folder, image, capacity, ports and recorded ownership. Amazon commands require an explicit amazon argument after the image ID.');printDeploymentError(error);process.exitCode=1;}
}
