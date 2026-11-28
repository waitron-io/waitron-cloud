import assert from 'node:assert/strict';
import test from 'node:test';
async function api(){return import('./test-cloud-deploy.mjs').catch(()=>({}));}
const image='sha256:'+'a'.repeat(64);
const good={composeVersion:'2.24.4',architecture:'amd64',availableMiB:5000,freeGiB:30,listeners:[],networks:[],containers:[]};
test('preflight refuses resource, port, network, image and project collisions before mutation',async()=>{
 const {validatePreflight}=await api();assert.equal(typeof validatePreflight,'function','deployment preflight is missing');
 assert.equal(validatePreflight(good,{image}).ready,true);
 for(const change of [{composeVersion:'2.24.3'},{architecture:'arm64'},{availableMiB:4095},{freeGiB:19},{listeners:[{address:'0.0.0.0',port:3000,protocol:'tcp'}]},{listeners:[{address:'127.0.0.1',port:8125,protocol:'tcp'}]},{networks:['10.79.0.0/16']},{containers:[{id:'b'.repeat(64),project:'waitron-cloud-test'}]}])assert.throws(()=>validatePreflight({...good,...change},{image}),/test_cloud.preflight/);
 assert.throws(()=>validatePreflight(good,{image:'latest'}),/test_cloud.image/);
});
test('driver refuses low resources without spawning a mutation and stops only recorded labelled IDs',async()=>{
 const {deploy}=await api();assert.equal(typeof deploy,'function','deployment driver is missing');
 const calls=[],id='c'.repeat(64),foreign='d'.repeat(64),state={project:'waitron-cloud-test',image,ids:[id]};
 const execute=async(command,args)=>{calls.push([command,...args]);return '';};
 await assert.rejects(deploy('up',{image,inventory:async()=>({...good,availableMiB:2000}),execute,readState:async()=>null,saveState:async()=>{}}),/test_cloud.preflight/);assert.equal(calls.length,0);
 await assert.rejects(deploy('stop',{image,execute,readState:async()=>state,inventory:async()=>({...good,containers:[{id,project:'waitron'},{id:foreign,project:'waitron'}]})}),/test_cloud.ownership/);assert.equal(calls.length,0);
 await deploy('stop',{image,execute,readState:async()=>state,inventory:async()=>({...good,containers:[{id,project:'waitron-cloud-test'},{id:foreign,project:'waitron'}]})});
 assert.deepEqual(calls,[['docker','stop','--time','15',id]]);
});
test('load requires amd64 image identity and image-only up records created IDs even on failure',async()=>{
 const {deploy}=await api();assert.equal(typeof deploy,'function','deployment driver is missing');
 const id='e'.repeat(64),calls=[],states=[];let n=0;
 const inventory=async()=>({...good,containers:n++===0?[]:[{id,project:'waitron-cloud-test'}]});
 const execute=async(command,args)=>{calls.push([command,...args]);if(args.includes('up'))throw Error('startup failed');if(args.includes('config'))return JSON.stringify({name:'waitron-cloud-test',services:{account:{image,mem_limit:64*1024*1024},proxy:{image,mem_limit:64*1024*1024,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{mem_limit:64*1024*1024,ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{mem_limit:64*1024*1024,ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}}});return args.includes('inspect')?JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'}):'';};
 await assert.rejects(deploy('up',{image,inventory,execute,readState:async()=>null,saveState:async state=>states.push(state)}),/startup failed/);
 assert.ok(calls.find(c=>c.includes('up')).includes('--no-build'));assert.deepEqual(states.at(-1).ids,[id]);assert.ok(calls.some(c=>c[1]==='stop'&&c.includes(id)));
});
test('load refuses a stream with the wrong platform or digest, and never starts it',async()=>{
 const {deploy}=await api();assert.equal(typeof deploy,'function');
 for(const loaded of [{Id:image,Architecture:'arm64',Os:'linux'},{Id:'sha256:'+'f'.repeat(64),Architecture:'amd64',Os:'linux'}]){
  const calls=[];await assert.rejects(deploy('load',{image,input:{},inventory:async()=>good,execute:async(_command,args)=>{calls.push(args);return args.includes('inspect')?JSON.stringify(loaded):'';}}),/test_cloud.image_platform/);
  assert.equal(calls.some(args=>args.includes('up')),false);
 }
});
test('up rejects a different or unverified architecture before creating containers',async()=>{
 const {deploy}=await api();assert.equal(typeof deploy,'function');const calls=[];
 await assert.rejects(deploy('up',{image,inventory:async()=>good,execute:async(_command,args)=>{calls.push(args);return JSON.stringify({Id:image,Architecture:'arm64',Os:'linux'});}}),/test_cloud.image_platform/);
 assert.equal(calls.some(args=>args.includes('up')),false);
});
test('driver child environment drops ambient Compose overrides and build credentials',async()=>{
 const {execute}=await api();assert.equal(typeof execute,'function');const old={...process.env};
 try{
  Object.assign(process.env,{COMPOSE_PROFILES:'unavailable',COMPOSE_FILE:'other.yaml',TEST_CLOUD_BIND:'0.0.0.0',NODE_AUTH_TOKEN:'fixture-build-token',CLOUD_TEST_SERVICE_PLANS:'1'});
  const output=JSON.parse(await execute(process.execPath,['-e',"console.log(JSON.stringify(Object.fromEntries(['COMPOSE_PROFILES','COMPOSE_FILE','TEST_CLOUD_BIND','NODE_AUTH_TOKEN','CLOUD_TEST_SERVICE_PLANS'].map(k=>[k,process.env[k]??null]))))"]));
  assert.deepEqual(output,{COMPOSE_PROFILES:null,COMPOSE_FILE:null,TEST_CLOUD_BIND:null,NODE_AUTH_TOKEN:null,CLOUD_TEST_SERVICE_PLANS:null});
 }finally{for(const key of Object.keys(process.env))if(!Object.hasOwn(old,key))delete process.env[key];Object.assign(process.env,old);}
});
test('resource guard stops for owned OOM, Waitron health regression or three consecutive floor failures',async()=>{
 const {resourceGuard}=await api();assert.equal(typeof resourceGuard,'function','resource monitoring is missing');
 const waitron={id:'f'.repeat(64),project:'waitron',name:'waitron-app-1',health:'healthy',state:'running'};
 const base={...good,containers:[waitron]};
 assert.equal(resourceGuard(base,base,2),0);
 assert.equal(resourceGuard(base,{...base,availableMiB:2047},0),1);
 assert.equal(resourceGuard(base,{...base,freeGiB:14},1),2);
 assert.throws(()=>resourceGuard(base,{...base,availableMiB:2047},2),/test_cloud.resource_floor/);
 assert.throws(()=>resourceGuard(base,{...base,containers:[{...waitron,health:'unhealthy'}]},0),/test_cloud.waitron_health/);
 assert.throws(()=>resourceGuard(base,{...base,containers:[waitron,{id:'e'.repeat(64),project:'waitron-cloud-test',oom:true}]},0),/test_cloud.oom/);
});
test('up refuses rendered port or build drift before creating containers',async()=>{
 const {validateDeployment}=await api();assert.equal(typeof validateDeployment,'function','rendered deployment validation is missing');
 const services={account:{image,mem_limit:64*1024*1024,ports:[],environment:{CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TRANSLATION:'0'}},proxy:{image,mem_limit:64*1024*1024,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{mem_limit:64*1024*1024,ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{mem_limit:64*1024*1024,ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}};
 assert.equal(validateDeployment({name:'waitron-cloud-test',services},{image}).ready,true);
 for(const altered of [{...services,account:{...services.account,ports:[{host_ip:'127.0.0.1',published:'3000',target:3000}]}},{...services,account:{...services.account,ports:[{host_ip:'0.0.0.0',published:'3000',target:3000}]}},{...services,proxy:{...services.proxy,build:{context:'.'}}},{...services,proxy:{...services.proxy,ports:[{host_ip:'0.0.0.0',published:'3000',target:3000}]}}])assert.throws(()=>validateDeployment({name:'waitron-cloud-test',services:altered},{image}),/test_cloud.rendered/);
});
test('read-only inventory handles host/none networks without inspecting private container environment',async()=>{
 const {inventory}=await api();assert.equal(typeof inventory,'function');
 const value=await inventory(async(command,args)=>{
  if(command==='df')return 'Filesystem 1024-blocks Used Available Capacity Mounted on\nroot 40000000 1 31457280 1% /\n';
  if(command==='ss'||command==='lsof')return '';
  if(args.includes('version'))return 'v5.1.0';if(args.includes('info'))return '"amd64"';if(args[0]==='ps')return '';
  if(args[0]==='network'&&args.includes('ls'))return 'host\nbridge\n';if(args[0]==='network'&&args.includes('inspect'))return 'null\n[{"Subnet":"172.17.0.0/16"}]\n';
  throw Error('Unexpected external operation');
 });assert.deepEqual(value.networks,['172.17.0.0/16']);assert.equal(value.architecture,'amd64');assert.equal(value.freeGiB,30);
});
const cloudRow = (ID, Names) => ({ID, Names, Labels:'com.docker.compose.project=waitron-cloud-test', State:'running'});
const oldAccount = cloudRow('a'.repeat(64), 'waitron-cloud-test-account-1');
const newAccount = cloudRow('b'.repeat(64), oldAccount.Names);
const waitron = cloudRow('c'.repeat(64), 'waitron-app-1');
const noSuchObject = row => 'error: no such object: '+row.ID;

function dockerInventory(snapshots, inspections) {
 const calls = {lists:0, inspections:0};
 const run = async (command,args) => {
  if(command==='df')return 'root 40000000 1 31457280 1% /';
  if(command==='ss'||command==='lsof')return '';
  if(args[0]==='compose')return 'v5.7.0';
  if(args[0]==='info')return '"amd64"';
  if(args[0]==='network'&&args[1]==='ls')return '';
  if(args[0]==='ps')return snapshots[calls.lists++].map(row=>JSON.stringify(row)).join('\n');
  if(args[0]==='inspect'){
   const result=inspections[calls.inspections++];
   if(result instanceof Error)throw result;
   assert.deepEqual(args.slice(3),result.map(row=>row.id));
   return result.map(row=>JSON.stringify(row)).join('\n');
  }
  assert.fail('Unexpected external operation');
 };
 return {run,calls};
}

test('inventory takes a fresh sample when Compose removes Cloud containers during inspection',async()=>{
 const {inventory}=await api();
 const storage=cloudRow('d'.repeat(64),'waitron-cloud-test-storage-1');
 const failure=Object.assign(new Error('Docker inspection failed'), {code:1,
  stdout:'{"id":"partial","oom":true,"health":"unhealthy"}\n',
  stderr:noSuchObject(oldAccount)+'\nError: No such object: '+storage.ID+'\n'});
 const {run,calls}=dockerInventory([[oldAccount,storage],[newAccount]], [failure, [
  {id:newAccount.ID,oom:false,health:'healthy'}
 ]]);
 assert.deepEqual((await inventory(run)).containers,[
  {id:newAccount.ID,project:'waitron-cloud-test',name:newAccount.Names,state:'running',oom:false,health:'healthy'}
 ]);
 assert.deepEqual(calls,{lists:2,inspections:2});
});

test('inventory propagates inspection failures outside a single Cloud replacement retry',async()=>{
 const {inventory}=await api();
 const cases=[
  {code:1,stderr:noSuchObject(oldAccount)+'\npermission denied'},
  {code:1,stderr:'Cannot connect to the Docker daemon'},
  {code:1,stderr:'error: no such object: '+'e'.repeat(64)},
  {code:1,stderr:noSuchObject(waitron)},
  {code:2,stderr:noSuchObject(oldAccount)}
 ];
 for(const error of cases){
  const failure=Object.assign(new Error(error.stderr),error);
  const {run,calls}=dockerInventory([[oldAccount,waitron]],[failure]);
  await assert.rejects(inventory(run),error=>error===failure);
  assert.deepEqual(calls,{lists:1,inspections:1});
 }
 const failures=[oldAccount,newAccount].map(row=>Object.assign(new Error('Docker inspection failed'),
  {code:1,stderr:noSuchObject(row)}));
 const {run,calls}=dockerInventory([[oldAccount],[newAccount]],failures);
 await assert.rejects(inventory(run),error=>error===failures[1]);
 assert.deepEqual(calls,{lists:2,inspections:2});
});

test('the deployment CLI prints the reason it refused a command',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {fileURLToPath}=await import('node:url');
 const temporary=await mkdtemp(join(tmpdir(),'cloud-driver-error-'));
 try{
  const script=fileURLToPath(new URL('./test-cloud-deploy.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'preflight','invalid-image'],
   {encoding:'utf8',env:{...process.env,HOME:temporary}});
  assert.equal(result.status,1);
  assert.match(result.stderr,/test_cloud\.image/);
 }finally{await rm(temporary,{recursive:true,force:true});}
});

test('the deployment CLI prints the cleanup reason and its underlying failures',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {copyFile,mkdtemp,realpath,rm,writeFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const temporary=await mkdtemp(join(tmpdir(),'cloud-driver-cleanup-'));
 try{
  const script=join(await realpath(temporary),'test-cloud-deploy.mjs');
  await copyFile(new URL('./test-cloud-deploy.mjs',import.meta.url),script);
  await writeFile(join(temporary,'test-cloud-project-lock.mjs'),`export function withTestCloudProjectLock(){
   throw new AggregateError([new Error('inventory failed'),new Error('stop failed')],'test_cloud.cleanup_incomplete');
  }`);
  const result=spawnSync(process.execPath,[script,'up',image],{encoding:'utf8'});
  assert.equal(result.status,1);
  for(const message of ['test_cloud.cleanup_incomplete','inventory failed','stop failed'])assert.ok(result.stderr.includes(message));
 }finally{await rm(temporary,{recursive:true,force:true});}
});

test('running startup aborts and stops its created IDs when three monitored samples fall below the floor',async t=>{
 const {deploy}=await api();const id='b'.repeat(64),calls=[],saved=[];let samples=0;
 const services={account:{image,mem_limit:64*1024*1024},proxy:{image,mem_limit:64*1024*1024,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{mem_limit:64*1024*1024,ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{mem_limit:64*1024*1024,ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}};
 t.mock.timers.enable({apis:['setInterval','setTimeout']});
 let began;const started=new Promise(resolve=>began=resolve);
 const work=deploy('up',{image,inventory:async()=>samples++===0?good:{...good,availableMiB:2000,containers:[{id,project:'waitron-cloud-test'}]},saveState:async value=>saved.push(structuredClone(value)),execute:async(_command,args,options)=>{
  calls.push(args);if(args.includes('inspect'))return JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'});if(args.includes('config'))return JSON.stringify({name:'waitron-cloud-test',services});
  if(args.includes('up'))return new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});began();});return '';
 }});const rejected=assert.rejects(work,/test_cloud.resource_floor/);await started;
 for(let n=0;n<3;n++){t.mock.timers.tick(5000);await new Promise(setImmediate);}
 await rejected;assert.deepEqual(calls.filter(args=>args[0]==='stop'),[['stop','--time','15',id]]);assert.deepEqual(saved.at(-1).ids,[id]);
});
test('image-stream child failure rejects cleanly instead of an unhandled broken pipe',async()=>{
 const {Readable}=await import('node:stream');const {execute}=await api();const chunk=Buffer.alloc(65536);
 await assert.rejects(execute(process.execPath,['-e','process.exit(1)'],{input:Readable.from(Array(512).fill(chunk))}),/test_cloud.image_load_failed/);
});
test('cancelled startup stops its newly recorded Cloud IDs before returning',async t=>{
 const {deploy}=await api(),abort=new AbortController(),id='a'.repeat(64),calls=[];let samples=0;
 const services={account:{image,mem_limit:67108864},proxy:{image,mem_limit:67108864,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}};
 await assert.rejects(deploy('up',{image,signal:abort.signal,settledSamples:0,inventory:async()=>samples++===0?good:{...good,containers:[{id,project:'waitron-cloud-test'}]},execute:async(_command,args,options)=>{calls.push(args);if(args.includes('inspect'))return JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'});if(args.includes('config'))return JSON.stringify({name:'waitron-cloud-test',services});if(args.includes('up')){abort.abort();return '';}return '';}}),/test_cloud.cancelled/);
 assert.deepEqual(calls.filter(args=>args[0]==='stop'),[['stop','--time','15',id]]);
});
test('stop and status refuse unrecorded test-project containers instead of claiming success',async()=>{
 const {deploy}=await api(),id='e'.repeat(64),state={project:'waitron-cloud-test',image,ids:[]},calls=[];
 for(const mode of ['stop','status'])await assert.rejects(deploy(mode,{image,readState:async()=>state,inventory:async()=>({...good,containers:[{id,project:'waitron-cloud-test'}]}),execute:async(...args)=>calls.push(args)}),/test_cloud.ownership/);
 await assert.rejects(deploy('status',{image,inventory:async()=>({...good,containers:[{id,project:'waitron-cloud-test'}]})}),/test_cloud.ownership/);assert.equal(calls.length,0);
});
test('startup cleanup falls back to scoped Docker IDs if the full host inventory fails',async()=>{
 const {deploy}=await api(),id='f'.repeat(64),calls=[],states=[];let n=0;
 const services={account:{image,mem_limit:67108864},proxy:{image,mem_limit:67108864,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}};
 await assert.rejects(deploy('up',{image,inventory:async()=>{if(n++===0)return good;throw Error('inventory failed');},saveState:async value=>states.push(structuredClone(value)),execute:async(_command,args)=>{
  calls.push(args);if(args.includes('up'))throw Error('original startup failure');if(args.includes('config'))return JSON.stringify({name:'waitron-cloud-test',services});if(args[0]==='image')return JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'});if(args[0]==='ps')return id+'\n';if(args[0]==='inspect')return JSON.stringify({id,project:'waitron-cloud-test'});return '';
 }}),/original startup failure/);
 assert.deepEqual(calls.filter(args=>args[0]==='stop'),[['stop','--time','15',id]]);assert.deepEqual(states.at(-1).ids,[id]);
});
test('existing deployment refuses a changed image before any external operation',async()=>{
 const {deploy}=await api();let called=false;await assert.rejects(deploy('up',{image,readState:async()=>({project:'waitron-cloud-test',image:'sha256:'+'b'.repeat(64),ids:[]}),inventory:async()=>{called=true;return good;}}),/test_cloud.image_change_requires_upgrade/);assert.equal(called,false);
});
test('Waitron stopping is a regression even if its old healthy label remains',async()=>{
 const {resourceGuard}=await api(),before={id:'f'.repeat(64),name:'waitron-app-1',project:'waitron',state:'running',health:'healthy'};
 assert.throws(()=>resourceGuard({...good,containers:[before]},{...good,containers:[{...before,state:'exited'}]}),/test_cloud.waitron_health/);
});
test('independent IPv6 networks do not collide with the fixed private IPv4 proxy',async()=>{
 const {validatePreflight}=await api();assert.equal(validatePreflight({...good,networks:['fd00:dead:beef::/48']},{image}).ready,true);
});
test('settled startup takes one resource sample per five seconds',async t=>{
 const {deploy}=await api(),id='b'.repeat(64),calls=[];let samples=0;
 const services={account:{image,mem_limit:67108864},proxy:{image,mem_limit:67108864,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}};
 t.mock.timers.enable({apis:['setInterval','setTimeout']});let began;const started=new Promise(resolve=>began=resolve);
 const work=deploy('up',{image,inventory:async()=>samples++===0?good:{...good,availableMiB:2000,containers:[{id,project:'waitron-cloud-test'}]},execute:async(_command,args)=>{calls.push(args);if(args.includes('inspect'))return JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'});if(args.includes('config'))return JSON.stringify({name:'waitron-cloud-test',services});if(args.includes('up'))began();return '';}});
 const result=assert.rejects(work,/test_cloud.resource_floor/);await started;await new Promise(setImmediate);
 for(let n=0;n<2;n++){t.mock.timers.tick(5000);await new Promise(setImmediate);}const premature=calls.some(args=>args[0]==='stop');
 t.mock.timers.tick(5000);await new Promise(setImmediate);await result;assert.equal(premature,false,'must not stop before the third five-second sample');
});
test('a failed state write during startup cleanup cannot prevent stopping observed Cloud IDs',async()=>{
 const {deploy}=await api();for(const startupFails of [true,false]){const id='e'.repeat(64),calls=[];let reads=0,writes=0;
 const services={account:{image,mem_limit:67108864},proxy:{image,mem_limit:67108864,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{mem_limit:67108864,ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}};
 await assert.rejects(deploy('up',{image,settledSamples:0,inventory:async()=>reads++===0?good:{...good,containers:[{id,project:'waitron-cloud-test'}]},saveState:async()=>{if(writes++>0)throw Error('disk full');},execute:async(_command,args)=>{calls.push(args);if(args.includes('up')&&startupFails)throw Error('startup failed');if(args.includes('config'))return JSON.stringify({name:'waitron-cloud-test',services});return args[0]==='image'?JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'}):'';}}));
 assert.deepEqual(calls.filter(args=>args[0]==='stop'),[['stop','--time','15',id]]);}
});
test('Linux listener parsing keeps IPv4, IPv6 and interface-qualified local ports',async()=>{
 const {parseLinuxListeners}=await api();assert.equal(typeof parseLinuxListeners,'function');
 assert.deepEqual(parseLinuxListeners('udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*\ntcp LISTEN 0 4096 [::]:3000 [::]:*\n'),[{address:'127.0.0.53%lo',port:53,protocol:'udp'},{address:'[::]',port:3000,protocol:'tcp'}]);
 assert.throws(()=>parseLinuxListeners('unreadable listener row'),/test_cloud.inventory/);
});

test('Amazon admission uses its own headroom and HTTPS port while retaining LAN limits',async()=>{
 const {validatePreflight,resourceGuard}=await api(),host={...good,availableMiB:2500,freeGiB:12};
 assert.equal(validatePreflight(host,{image,target:'amazon'}).ready,true);
 assert.throws(()=>validatePreflight(host,{image}),/test_cloud.preflight/);
 for(const change of [{availableMiB:2047},{freeGiB:7.9},{listeners:[{address:'0.0.0.0',port:443,protocol:'tcp'}]},{listeners:[{address:'0.0.0.0',port:80,protocol:'tcp'}]},{listeners:[{address:'0.0.0.0',port:51820,protocol:'udp'}]}])assert.throws(()=>validatePreflight({...host,...change},{image,target:'amazon'}),/test_cloud.preflight/);
 assert.equal(validatePreflight({...host,listeners:[{address:'127.0.0.1',port:3000,protocol:'tcp'}]},{image,target:'amazon'}).ready,true);
 assert.throws(()=>validatePreflight(host,{image,target:'other'}),/test_cloud.target/);
 assert.equal(resourceGuard(host,{...host,availableMiB:1024,freeGiB:6},2,{target:'amazon'}),0);
 assert.throws(()=>resourceGuard(host,{...host,availableMiB:511},2,{target:'amazon'}),/test_cloud.resource_floor/);
 assert.throws(()=>resourceGuard(host,{...host,freeGiB:3.9},2,{target:'amazon'}),/test_cloud.resource_floor/);
});

function amazonDeployment(){
 const mode={CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'test',TEST_CLOUD_ORIGIN:'https://cloud.example.test'},base={image,mem_limit:67108864,environment:mode};
 return{name:'waitron-cloud-test',services:{
  bootstrap:{...base,volumes:[{type:'bind',source:'/private/certificates',target:'/run/public-certificate',read_only:true},{type:'volume',source:'test-cloud-public-certificate',target:'/run/proxy-certificate'}]},
  proxy:{...base,ports:[{host_ip:'0.0.0.0',published:'443',target:443,protocol:'tcp'}],volumes:[{type:'volume',source:'test-cloud-public-certificate',target:'/run/proxy-certificate',read_only:true}]},
  'http-challenges':{...base,restart:'unless-stopped',ports:[{host_ip:'0.0.0.0',published:'80',target:8080,protocol:'tcp'}],volumes:[{type:'bind',source:'/opt/waitron-cloud/acme-webroot',target:'/run/account-webroot',read_only:true},{type:'volume',source:'test-cloud-http-challenges',target:'/run/remote-challenges',read_only:true}]},
  gateway:{...base,ports:[{host_ip:'0.0.0.0',published:'51820',target:51820,protocol:'udp'}],volumes:[
   {type:'volume',source:'test-cloud-tls-challenges',target:'/run/remote-tls-challenges',read_only:true},
   {type:'volume',source:'test-cloud-gateway-status',target:'/run/remote-gateway-status'}
  ]},
  'gateway-manifest':{...base,volumes:[
   {type:'volume',source:'test-cloud-http-challenges',target:'/run/remote-challenges'},
   {type:'volume',source:'test-cloud-tls-challenges',target:'/run/remote-tls-challenges'},
   {type:'volume',source:'test-cloud-gateway-status',target:'/run/remote-gateway-status',read_only:true}
  ]},
  account:base,'email-worker':base,postgres:{mem_limit:67108864},mailpit:{mem_limit:67108864}
 }};
}

test('Amazon admission reserves the TLS challenge and gateway status volumes for their two roles',async()=>{
 const {validateDeployment}=await api(),options={image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates'};
 for(const [source,target,writer,reader] of [
  ['test-cloud-tls-challenges','/run/remote-tls-challenges','gateway-manifest','gateway'],
  ['test-cloud-gateway-status','/run/remote-gateway-status','gateway','gateway-manifest']
 ]){
  for(const [description,change] of [
   ['missing writer',services=>{services[writer].volumes=services[writer].volumes.filter(v=>v.source!==source);}],
   ['writer is read-only',services=>{services[writer].volumes.find(v=>v.source===source).read_only=true;}],
   ['reader can write',services=>{delete services[reader].volumes.find(v=>v.source===source).read_only;}],
   ['wrong mount path',services=>{services[reader].volumes.find(v=>v.source===source).target='/other';}],
   ['wrong mount type',services=>{services[reader].volumes.find(v=>v.source===source).type='image';}],
   ['extra mount',services=>{services[reader].volumes.push({type:'volume',source,target:'/other',read_only:true});}],
   ['another service can read',services=>{services.account={...services.account,volumes:[{type:'volume',source,target,read_only:true}]};}],
   ['another service uses the reserved path',services=>{
    services.account={...services.account,volumes:[{type:'volume',source:source+'-alias',target,read_only:true}]};
   }]
  ]){
   const value=amazonDeployment();change(value.services);
   assert.throws(()=>validateDeployment(value,options),/test_cloud.rendered/,source+' '+description);
  }
 }
});

test('Amazon rendered admission keeps private services and the certificate source private',async()=>{
 const {validateDeployment}=await api(),options={image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates'};
 assert.equal(validateDeployment(amazonDeployment(),options).ready,true);
 const budget=amazonDeployment(),others=Object.entries(budget.services).filter(([name])=>name!=='account').reduce((sum,[,v])=>sum+v.mem_limit,0);budget.services.account={...budget.services.account,mem_limit:2112*1024*1024-others};assert.equal(validateDeployment(budget,options).ready,true);budget.services.account.mem_limit++;assert.throws(()=>validateDeployment(budget,options),/test_cloud.rendered/);
 for(const change of [v=>v.services['http-challenges'].restart='no',v=>v.services['http-challenges'].volumes[0].read_only=false,v=>v.services['http-challenges'].volumes.push({type:'volume',source:'local-stack-config',target:'/leaked'}),v=>v.services['http-challenges'].depends_on={account:{condition:'service_healthy'}},v=>v.services.gateway.ports[0].protocol='tcp',v=>v.services.account={...v.services.account,volumes:[{type:'volume',source:'test-cloud-http-challenges',target:'/leaked'}]},v=>v.services.postgres.ports=[{host_ip:'127.0.0.1',published:'55432',target:5432}],v=>v.services.proxy.ports[0].host_ip='192.168.10.10',v=>v.services.bootstrap.volumes[0].read_only=false,v=>v.services.proxy.volumes[0].read_only=false,v=>v.services.account={...v.services.account,environment:{...v.services.account.environment,TEST_CLOUD_ORIGIN:'https://other.example.test'}},v=>v.services.bootstrap.volumes[1].source='local-stack-config',v=>v.services.storage={...v.services.account,ports:[{host_ip:'127.0.0.1',published:'8333',target:8333}]},v=>v.services.gateway={...v.services.account,ports:[{host_ip:'127.0.0.1',published:'8443',target:443}]},v=>v.services.account={...v.services.account,volumes:[{type:'volume',source:'test-cloud-public-certificate',target:'/leaked'}]},v=>v.services.account={...v.services.account,environment:{...v.services.account.environment,CLOUD_VENUE_SERVICE_LEVELS:'0'}}]){
  const value=amazonDeployment();change(value);assert.throws(()=>validateDeployment(value,options),/test_cloud.rendered/);
 }
});

test('Amazon up selects only the explicit override and settings, refusing bad inputs before commands',async()=>{
 const {deploy}=await api(),id='c'.repeat(64),calls=[],states=[];let reads=0;
 const execute=async(command,args,options)=>{calls.push({command,args,environment:options?.environment});return args.includes('config')?JSON.stringify(amazonDeployment()):args[0]==='image'?JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'}):'';};
 await deploy('up',{image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',settledSamples:0,inventory:async()=>({...good,availableMiB:2500,freeGiB:12,containers:reads++===0?[]:[{id,project:'waitron-cloud-test'}]}),execute,saveState:async s=>states.push(structuredClone(s))});
 const startup=calls.find(c=>c.args.includes('up'));assert.ok(startup.args.includes('deploy/test-cloud/compose.amazon.yaml'));assert.equal(startup.environment.TEST_CLOUD_ORIGIN,'https://cloud.example.test');assert.equal(startup.environment.TEST_CLOUD_CERTIFICATE_SOURCE,'/private/certificates');assert.equal(startup.environment.CLOUD_TEST_SERVICE_PLANS,'0');assert.deepEqual(states.at(-1).ids,[id]);
 for(const extra of [{target:'other'},{origin:'http://cloud.example.test'},{origin:'https://cloud.example.test:8443'},{origin:'https://cloud.example.test/path'},{certificateSource:'relative/certificates'}]){
  let touched=false;await assert.rejects(deploy('up',{image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',...extra,inventory:async()=>{touched=true;return good;},execute}));assert.equal(touched,false);
 }
});

test('the deployment driver imports from its two transferred script files without a source checkout',async t=>{
 const{mkdtemp,copyFile,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{pathToFileURL}=await import('node:url'),{execFileSync}=await import('node:child_process');
 const directory=await mkdtemp(join(tmpdir(),'cloud-deploy-transfer-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const name of ['test-cloud-deploy.mjs','test-cloud-project-lock.mjs'])await copyFile(new URL(name,import.meta.url),join(directory,name));
 const script=`const{validatePreflight}=await import(${JSON.stringify(pathToFileURL(join(directory,'test-cloud-deploy.mjs')).href)});console.log(JSON.stringify(validatePreflight(${JSON.stringify({...good,availableMiB:2500,freeGiB:12})},{image:${JSON.stringify(image)},target:'amazon'})));`;
 assert.deepEqual(JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'})),{ready:true});
});

test('Amazon startup monitoring retains a healthy small host for all three samples',async t=>{
 const {deploy}=await api(),id='d'.repeat(64);let reads=0,began;const started=new Promise(resolve=>began=resolve);
 t.mock.timers.enable({apis:['setInterval','setTimeout']});
 const work=deploy('up',{image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',settledSamples:3,inventory:async()=>({...good,availableMiB:reads===0?2500:1024,freeGiB:reads++===0?12:6,containers:reads===1?[]:[{id,project:'waitron-cloud-test'}]}),execute:async(_command,args)=>{if(args.includes('config'))return JSON.stringify(amazonDeployment());if(args[0]==='image')return JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'});if(args.includes('up'))began();return '';} });
 const outcome=work.then(value=>({value}),error=>({error}));await started;await new Promise(setImmediate);
 for(let n=0;n<3;n++){t.mock.timers.tick(5000);await new Promise(setImmediate);}
 const result=await outcome;assert.equal(result.error,undefined);assert.deepEqual(result.value.ids,[id]);
});

const amazonVerifier='sha256:'+'e'.repeat(64);
function amazonBackupDeployment(){
 const value=amazonDeployment(),services=value.services;
 services.account={...services.account};
 for(const name of ['account','bootstrap','proxy'])
  services[name].environment={...services[name].environment,CLOUD_TEST_AMAZON_BACKUPS:'1'};
 services.account.environment.TEST_CLOUD_AMAZON='1';
 services['backup-worker']={
  image,mem_limit:144*1024*1024,read_only:true,
  cap_drop:['ALL'],cap_add:['DAC_OVERRIDE','FOWNER'],security_opt:['no-new-privileges:true'],
  environment:{...services.account.environment,CLOUD_VERIFIER_IMAGE:amazonVerifier,
   CLOUD_VERIFIER_SCRATCH_VOLUME:'amazon-test-verifier-scratch',CLOUD_BACKUP_STAGE_ROOT:'/run/backup-stage'},
  volumes:[
   {type:'volume',source:'local-stack-config',target:'/run/local-stack',read_only:true},
   {type:'volume',source:'test-backup-verifier-state',target:'/run/backup-verifier'},
   {type:'bind',source:'/var/run/docker.sock',target:'/var/run/docker.sock',read_only:true,bind:{create_host_path:false}},
   {type:'bind',source:'/opt/waitron-cloud/amazon-backup-stages/worker/mount/work',target:'/run/backup-stage',bind:{create_host_path:false}},
   {type:'bind',source:'/opt/waitron-cloud/amazon-backup-stages/verifier/mount/work',target:'/opt/waitron-cloud/amazon-backup-stages/verifier/mount/work',bind:{create_host_path:false}}
  ]
 };
 return value;
}

test('Amazon deployment admits Docker control and private writable state only for the explicitly selected backup worker',async()=>{
 const {validateDeployment}=await api(),options={image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',backupVerifierImage:amazonVerifier};
 assert.equal(validateDeployment(amazonBackupDeployment(),options).ready,true);
 assert.throws(()=>validateDeployment(amazonBackupDeployment(),{...options,backupVerifierImage:undefined}),/test_cloud.rendered/);
 for(const breakIsolation of [
  s=>{s.account.volumes=[s['backup-worker'].volumes[2]];},
  s=>{s.account.volumes=[s['backup-worker'].volumes[1]];},
  s=>{s['backup-worker'].volumes.pop();},
  s=>{s['backup-worker'].volumes.splice(3,1);},
  s=>{s['backup-worker'].volumes[3].source='/tmp/unbounded-stage';},
  s=>{s['backup-worker'].volumes[3].target='/tmp/misplaced-stage';},
  s=>{s['backup-worker'].volumes[3].read_only=true;},
  s=>{s['backup-worker'].volumes[4].target='/tmp/misplaced-scratch';},
  s=>{s['backup-worker'].volumes[4].read_only=true;},
  s=>{s['backup-worker'].volumes[3].bind.create_host_path=true;},
  s=>{s.account.volumes=[s['backup-worker'].volumes[3]];},
  s=>{s['backup-worker'].cap_add.push('SYS_ADMIN');},
  s=>{s['backup-worker'].cap_drop=[];},
  s=>{s['backup-worker'].security_opt=[];},
  s=>{delete s['backup-worker'].environment.CLOUD_BACKUP_STAGE_ROOT;},
  s=>{s['backup-worker'].volumes.push({type:'volume',source:'unrelated',target:'/extra'});},
  s=>{s['backup-worker'].read_only=false;},
  s=>{s['backup-worker'].ports=[{host_ip:'127.0.0.1',published:'9000',target:9000}];},
  s=>{delete s['backup-worker'].environment.TEST_CLOUD_AMAZON;},
  s=>{s['backup-worker'].volumes[2].bind.create_host_path=true;},
  s=>{s['email-worker']={...s['email-worker'],environment:{...s['email-worker'].environment,CLOUD_TEST_AMAZON_BACKUPS:'1'}};},
  s=>{s['backup-worker'].volumes[0].read_only=false;},
  s=>{s['backup-worker'].environment.CLOUD_VERIFIER_IMAGE=image;},
  s=>{s['backup-worker'].environment.CLOUD_VERIFIER_SCRATCH_VOLUME='disk';},
  s=>{s['backup-worker'].profiles=['unavailable'];},
  s=>{delete s.proxy.environment.CLOUD_TEST_AMAZON_BACKUPS;}
 ]){
  const value=amazonBackupDeployment();breakIsolation(value.services);assert.throws(()=>validateDeployment(value,options),/test_cloud.rendered/);
 }
});

test('Amazon admission accepts Compose JSON that omits false from long-form binds',async()=>{
 const {validateDeployment}=await api(),value=amazonBackupDeployment();
 const options={image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',backupVerifierImage:amazonVerifier};
 for(const mount of value.services['backup-worker'].volumes.filter(v=>v.type==='bind'))mount.bind={};
 assert.equal(validateDeployment(value,options).ready,true);
});

test('the driver enables the Amazon backup override only for an explicit immutable image',async()=>{
 const {deploy}=await api(),calls=[],id='d'.repeat(64);let reads=0;
 const execute=async(_command,args,{environment}={})=>{
  calls.push({args,environment});
  if(args[0]==='image')return JSON.stringify({Id:args[2],Architecture:'amd64',Os:'linux'});
  if(args.includes('config'))return JSON.stringify(amazonBackupDeployment());
  return '';
 };
 const options={image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',backupVerifierImage:amazonVerifier,execute,
  inventory:()=>({...good,availableMiB:2500,freeGiB:12,containers:reads++===0?[]:[{id,project:'waitron-cloud-test'}]}),settledSamples:0};
 await deploy('up',options);
 assert.ok(calls.some(c=>c.args[0]==='image'&&c.args[2]===amazonVerifier),'verify the immutable image before startup');
 for(const command of ['config','up']){
  const called=calls.find(c=>c.args.includes(command));
  assert.ok(called.args.includes('deploy/test-cloud/compose.amazon-backups.yaml'));
  assert.equal(called.environment.CLOUD_VERIFIER_IMAGE,amazonVerifier);
 }
 for(const change of [{target:'lan'},{backupVerifierImage:'waitron-backup-verifier:amazon-test'}]){
  let inspected=false;
  await assert.rejects(deploy('up',{...options,...change,inventory:()=>{inspected=true;return good;}}),/test_cloud.amazon_backups/);
  assert.equal(inspected,false);
 }
});

test('Amazon up requires the explicit private SES file and mounts it only on the email worker',async()=>{
 const {deploy,validateDeployment}=await api(),id='c'.repeat(64),calls=[];let reads=0;
 const options={image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',sesSettingsSource:'/private/ses.json'};
 const rendered=(source=options.sesSettingsSource)=>{
  const value=amazonDeployment(),worker={...value.services['email-worker']};
  value.services['email-worker']=worker;
  worker.environment={...worker.environment,TEST_CLOUD_AMAZON_SES:'1'};
  worker.volumes=[{type:'bind',source,target:'/run/test-cloud-ses.json',read_only:true,bind:{create_host_path:false}}];
  return value;
 };
 const execute=async(_command,args,options)=>{
  calls.push({args,environment:options?.environment});
  return args.includes('config')?JSON.stringify(rendered()):args[0]==='image'?JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'}):'';
 };
 await deploy('up',{...options,settledSamples:0,inventory:async()=>({...good,availableMiB:2500,freeGiB:12,containers:reads++===0?[]:[{id,project:'waitron-cloud-test'}]}),execute,saveState:async()=>{}});
 const startup=calls.find(c=>c.args.includes('up'));
 assert.ok(startup.args.indexOf('deploy/test-cloud/compose.amazon-ses.yaml')>startup.args.indexOf('deploy/test-cloud/compose.amazon.yaml'));
 assert.equal(startup.environment.TEST_CLOUD_SES_SETTINGS_SOURCE,'/private/ses.json');
 const {sesSettingsSource,...disabled}=options;
 assert.throws(()=>validateDeployment(rendered(),disabled),/test_cloud.rendered/);
 const missingWorker=amazonDeployment();
 delete missingWorker.services['email-worker'];
 for(const service of Object.values(missingWorker.services))if(service.environment)delete service.environment.TEST_CLOUD_ORIGIN;
 assert.throws(()=>validateDeployment(missingWorker,{...options,origin:undefined}),/test_cloud.rendered/);
 for(const change of [
  value=>value.services['email-worker'].volumes.pop(),
  value=>value.services['email-worker'].volumes[0].read_only=false,
  value=>value.services['email-worker'].volumes[0].bind.create_host_path=true,
  value=>value.services['email-worker'].volumes[0].source='/private/other.json',
  value=>value.services.account.environment.TEST_CLOUD_AMAZON_SES='1',
  value=>value.services.account.volumes=[{...value.services['email-worker'].volumes[0],type:'volume',target:'/other'}],
 ]){
  const value=rendered();change(value);
  assert.throws(()=>validateDeployment(value,options),/test_cloud.rendered/);
 }
 for(const sesSettingsSource of [
  'relative/ses.json','/private/certificates/ses.json','/opt/waitron-cloud/acme-webroot/ses.json','/opt/waitron-cloud'
 ]){
  assert.throws(()=>validateDeployment(rendered(sesSettingsSource),{...options,sesSettingsSource}),/test_cloud.rendered/,sesSettingsSource);
 }
 for(const change of [{target:'lan'},{sesSettingsSource:'relative/ses.json'}]){
  await assert.rejects(deploy('up',{...options,...change,inventory:assert.fail}),/test_cloud.amazon_ses/);
 }
});

test('venue SES mounts both private files on the email worker and leaves account sending off',async()=>{
 const {deploy,validateDeployment}=await api(),value=amazonDeployment(),id='c'.repeat(64),calls=[];
 const options={image,target:'amazon',origin:'https://cloud.example.test',certificateSource:'/private/certificates',
  sesSettingsSource:'/private/account.json',venueSesSettingsSource:'/private/venue.json'};
 const worker={...value.services['email-worker']};value.services['email-worker']=worker;
 worker.environment={...worker.environment,TEST_CLOUD_AMAZON_VENUE_SES:'1',CLOUD_TEST_VENUE_MAIL_SIGNING:'0'};
 worker.volumes=['account','venue'].map((name,i)=>({type:'bind',source:`/private/${name}.json`,target:`/run/test-cloud-${i?'venue-':''}ses.json`,read_only:true,bind:{create_host_path:false}}));
 let reads=0;
 await deploy('up',{...options,settledSamples:0,inventory:async()=>({...good,availableMiB:2500,freeGiB:12,containers:reads++===0?[]:[{id,project:'waitron-cloud-test'}]}),
  execute:async(_command,args)=>{calls.push(args);return args.includes('config')?JSON.stringify(value):args[0]==='image'?JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'}):'';}});
 assert.ok(calls.find(args=>args.includes('up')).includes('deploy/test-cloud/compose.amazon-venue-ses.yaml'));
 assert.equal(calls.find(args=>args.includes('up')).includes('deploy/test-cloud/compose.amazon-ses.yaml'),false);
 await assert.rejects(deploy('up',{...options,sesSettingsSource:undefined,inventory:assert.fail}),/test_cloud.amazon_ses/);
 delete worker.environment.TEST_CLOUD_AMAZON_VENUE_SES;
 assert.throws(()=>validateDeployment(value,options),/test_cloud.rendered/);
 worker.environment.TEST_CLOUD_AMAZON_VENUE_SES='1';
 worker.environment.CLOUD_TEST_VENUE_MAIL_SIGNING='1';
 assert.throws(()=>validateDeployment(value,options),/test_cloud.rendered/);
 worker.environment.CLOUD_TEST_VENUE_MAIL_SIGNING='0';
 value.services.account.volumes=[worker.volumes[1]];
 assert.throws(()=>validateDeployment(value,options),/test_cloud.rendered/);
});
