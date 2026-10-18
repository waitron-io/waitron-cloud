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
