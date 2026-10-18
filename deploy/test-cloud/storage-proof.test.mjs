import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {request} from 'node:https';
const execute=promisify(execFile),root=new URL('../../',import.meta.url).pathname,image=process.env.TEST_CLOUD_STORAGE_PROOF_IMAGE;
// Exercise the delivered process/volume/network layout, not the native fixture adapter alone.
test('wired test storage serves signed account clients, withdraws real writers and recovers a pending downgrade after restart',{skip:!image,timeout:180000},async t=>{
 const project='waitron-cloud-test-storage-'+randomUUID().slice(0,8),directory=await mkdtemp(join(tmpdir(),'test-cloud-storage-proof-')),override=join(directory,'proof.yaml');
 await writeFile(override,`name: ${project}\nservices:\n  account:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n  storage:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n    ports: !override ["127.0.0.1::8333"]\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  mailpit:\n    ports: !override ["127.0.0.1::1025", "127.0.0.1::8025"]\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n  gateway:\n    ports: !override ["127.0.0.1::443", "127.0.0.1::51820/udp"]\n`);
 const prefix=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f',override];
 const docker=async args=>(await execute('docker',args,{cwd:root,env:{...process.env,TEST_CLOUD_IMAGE:image},timeout:120000,maxBuffer:2*1024*1024})).stdout.trim();
 t.after(async()=>{
  try{const ids=(await docker(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);if(ids.length){await docker(['stop','--time','10',...ids]);await docker(['rm','-v',...ids]);}
   for(const kind of ['network','volume']){const ids=(await docker([kind,'ls','-q','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);for(const id of ids)await docker([kind,'rm',id]);}
  }finally{await rm(directory,{recursive:true,force:true});}
 });
 try{await docker([...prefix,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','80']);}
 catch(error){console.error(await docker([...prefix,'logs','--tail','25','account','storage']));throw error;}
 const account=await docker([...prefix,'ps','-q','account']),storage=await docker([...prefix,'ps','-q','storage']);
 const phase=async name=>{const output=await docker(['exec',account,'node','--input-type=module','-e',`import {storageClientProof} from './deploy/test-cloud/test-fixtures/storage-client.mjs';await storageClientProof(${JSON.stringify(name)});`]);console.log(output);return JSON.parse(output.split('\n').at(-1));};
 assert.equal((await phase('seed')).distinctScopedCredentials,true);
 const port=Number((await docker([...prefix,'port','storage','8333'])).split(':').at(-1)),ca=await docker(['exec',storage,'cat','/run/local-stack/lan/ca.pem']);
 const probe=trust=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,servername:'waitron.local',ca:trust},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);req.end();});
 assert.equal(await probe(ca),403);await assert.rejects(probe(''),/certificate|issuer|verify/i);
 assert.equal((await phase('withdraw')).oldWriterRefused,403);
 await docker(['stop','--time','10',storage]);await phase('downgrade-pending');
 await docker([...prefix,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','60','storage']);
 assert.equal((await phase('restart')).oldWriterRefused,403);
 console.log(JSON.stringify({project,realAccountAuthority:true,canonicalClientTls:true,storageRestartWithdrawal:true,neighbourIsolation:true,generatedSecrets:'private-volume-only'}));
});
