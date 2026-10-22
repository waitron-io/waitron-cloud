import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile),root=new URL('../../',import.meta.url).pathname,image=process.env.TEST_CLOUD_SNAPSHOT_PROOF_IMAGE,verifierImage=process.env.TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE;
// A no-op worker or dropped controller wiring leaves the signed, genuinely captured point pending.
test('delivered scoped backup worker verifies a genuine pinned Waitron snapshot',{skip:!image||!verifierImage,timeout:240000},async t=>{
 const project='waitron-cloud-test-snapshot-'+randomUUID().slice(0,8),directory=await mkdtemp(join(tmpdir(),'test-cloud-snapshot-proof-')),override=join(directory,'proof.yaml'),owned=[];
 const docker=async args=>(await execute('docker',args,{cwd:root,env:{...process.env,TEST_CLOUD_IMAGE:image},timeout:120000,maxBuffer:8*1024*1024})).stdout.trim();
 const inputDocker=(args,input,phase=args[0])=>new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{cwd:root,stdio:['pipe','pipe','pipe']});let output='',diagnostic='',size=0;const timer=setTimeout(()=>child.kill('SIGKILL'),90000);child.stdout.on('data',part=>{size+=part.length;if(size>8*1024*1024)child.kill('SIGKILL');else output+=part;});child.stderr.on('data',part=>{diagnostic=(diagnostic+part).slice(-2048);});child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(Error('snapshot proof child failed at '+phase+' '+(diagnostic.match(/fixture-error:[a-z_-]+:[A-Za-z0-9_]+/)?.[0]??'')));});child.stdin.on('error',()=>{});child.stdin.end(input);
 });
 await writeFile(override,`name: ${project}\nservices:\n  account:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n  storage:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n    ports: !override ["127.0.0.1::8333"]\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  mailpit:\n    ports: !override ["127.0.0.1::1025", "127.0.0.1::8025"]\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n  gateway:\n    ports: !override ["127.0.0.1::443", "127.0.0.1::51820/udp"]\n`);
 let account,controllerScope;
 const verifierVolume=project+'-verifier-state';
 const prefix=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f',override];
 t.after(async()=>{
  try{if(account){const scope=controllerScope??JSON.parse(await docker(['run','--rm','--network','none','--read-only','--mount',`type=volume,src=${verifierVolume},dst=/state,readonly`,'--entrypoint','node',image,'--input-type=module','-e',"import {readFile} from 'node:fs/promises';console.log(await readFile('/state/verifier-controller/identity.json','utf8').catch(()=>'{\"scope\":null}'));"])).scope;if(typeof scope==='string'){const ids=(await docker(['ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner=waitron-cloud-test-backup','--filter','label=cloud.backup-verifier.scope='+scope])).split(/\s+/).filter(Boolean);owned.push(...ids);}}const ids=[...new Set([...owned,...(await docker(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean)])];if(ids.length)await docker(['rm','-f','-v',...ids]);
   for(const kind of ['network','volume'])for(const id of (await docker([kind,'ls','-q','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean))await docker([kind,'rm',id]);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 await docker(['volume','create','--label',`com.docker.compose.project=${project}`,verifierVolume]);
 await docker([...prefix,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','80']);
 account=await docker([...prefix,'ps','-q','account']);
 const phase=async(name,input={})=>JSON.parse((await inputDocker(['exec','-i',account,'node','--input-type=module','-e',`import {snapshotClientProof} from './deploy/test-cloud/test-fixtures/snapshot-client.mjs';let s='';for await(const b of process.stdin)s+=b;console.log(JSON.stringify(await snapshotClientProof(${JSON.stringify(name)},JSON.parse(s))));`],JSON.stringify(input),name)).split('\n').at(-1));
 await docker(['exec',account,'node','--input-type=module','-e',"import {storageClientProof} from './deploy/test-cloud/test-fixtures/storage-client.mjs';await storageClientProof('seed-snapshot');"]);
 assert.deepEqual(await phase('continuous'),{streamObjects:0,pointerRows:0});
 await phase('configure',{image:verifierImage});
 const key=await phase('reserve');
 const source=await readFile(new URL('test-fixtures/snapshot-archive.mjs',import.meta.url),'utf8');
 const captureId=await docker(['create','--network','none','--memory','1024m','--memory-swap','1024m','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--pids-limit','128','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777','--entrypoint','node','-i',verifierImage,'--import','/waitron/apps/server/node_modules/tsx/dist/loader.mjs','--input-type=module','-e',source]);owned.push(captureId);
 const captured=JSON.parse((await inputDocker(['start','-ai',captureId],JSON.stringify(key))).split('\n').at(-1));
 assert.equal(captured.metadata.networkDenied,true);assert.equal((await phase('publish',captured)).published,true);
 assert.deepEqual(await phase('continuous'),{streamObjects:0,pointerRows:0});
 const config=JSON.parse(await docker(['inspect',account])),volume=config[0].Mounts.find(m=>m.Destination==='/run/local-stack').Name,network=Object.keys(config[0].NetworkSettings.Networks)[0];
 const worker=await docker(['create','--network',network,'--memory','128m','--memory-swap','128m','--env','CLOUD_TEST_SERVICE_PLANS=1','--env','CLOUD_VERIFIER_IMAGE='+verifierImage,'--mount',`type=volume,src=${volume},dst=/run/local-stack,readonly`,'--mount',`type=volume,src=${verifierVolume},dst=/run/backup-verifier`,'--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock','--entrypoint','node',image,'deploy/test-cloud/runtime.mjs','backup']);owned.push(worker);
 await docker(['start',worker]);
 let verified=false;for(let n=0;n<90;n++){try{const result=await phase('assert');assert.equal(result.targetDigest,JSON.parse(await readFile(new URL('../backup-verifier/target.json',import.meta.url),'utf8')).digest);controllerScope=result.controllerScope;verified=result.realWaitronSnapshotVerified;break;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}
 if(!verified)console.error(await docker(['logs','--tail','8',worker]));assert.equal(verified,true,'real snapshot must reach verified through the delivered scoped worker');
 await docker(['stop','--time','15',worker]);
 const childIds=(await docker(['ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner=waitron-cloud-test-backup'])).split(/\s+/).filter(Boolean);
 const scope=controllerScope;
 for(const id of childIds){const [info]=JSON.parse(await docker(['inspect',id]));assert.notEqual(info.Config.Labels['cloud.backup-verifier.scope'],scope,'completed verifier must leave no child');}
 assert.deepEqual(await phase('continuous'),{streamObjects:0,pointerRows:0});
 console.log(JSON.stringify({realWaitronSnapshotVerified:true,pinnedRevision:'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7',childCleanup:true,planMode:'test-free-paid',captureNetwork:'none'}));
});
