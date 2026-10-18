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
 const execute=async(command,args)=>{calls.push([command,...args]);if(args.includes('up'))throw Error('startup failed');if(args.includes('config'))return JSON.stringify({name:'waitron-cloud-test',services:{account:{image},proxy:{image,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}}});return args.includes('inspect')?JSON.stringify({Id:image,Architecture:'amd64',Os:'linux'}):'';};
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
 const services={account:{image,ports:[],environment:{CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_TRANSLATION:'0'}},proxy:{image,ports:[{host_ip:'192.168.10.10',published:'3000',target:3000}]},postgres:{ports:[{host_ip:'127.0.0.1',published:'55432',target:5432}]},mailpit:{ports:[{host_ip:'127.0.0.1',published:'1125',target:1025},{host_ip:'127.0.0.1',published:'8125',target:8025}]}};
 assert.equal(validateDeployment({name:'waitron-cloud-test',services},{image}).ready,true);
 for(const altered of [{...services,account:{...services.account,ports:[{host_ip:'0.0.0.0',published:'3000',target:3000}]}},{...services,proxy:{...services.proxy,build:{context:'.'}}},{...services,proxy:{...services.proxy,ports:[{host_ip:'0.0.0.0',published:'3000',target:3000}]}}])assert.throws(()=>validateDeployment({name:'waitron-cloud-test',services:altered},{image}),/test_cloud.rendered/);
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
