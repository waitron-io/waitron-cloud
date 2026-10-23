import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {request} from 'node:https';
const execute=promisify(execFile),root=new URL('../../',import.meta.url).pathname,image=process.env.TEST_CLOUD_REMOTE_PROOF_IMAGE;
test('delivered remote worker signs trusted clients and withdraws real gateway routes and peers after downgrade and restart',{skip:!image,timeout:240000},async t=>{
 const project='waitron-cloud-test-remote-'+randomUUID().slice(0,8),directory=await mkdtemp(join(tmpdir(),'test-cloud-remote-proof-')),override=join(directory,'proof.yaml'),peers=[];
 await writeFile(override,`name: ${project}\nservices:\n  account:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n  gateway-manifest:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n  storage:\n    ports: !override ["127.0.0.1::8333"]\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  mailpit:\n    ports: !override ["127.0.0.1::1025", "127.0.0.1::8025"]\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n  gateway:\n    ports: !override ["127.0.0.1::443", "127.0.0.1::51820/udp"]\n`);
 const prefix=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f',override];
 const docker=async args=>(await execute('docker',args,{cwd:root,env:{...process.env,TEST_CLOUD_IMAGE:image},timeout:120000,maxBuffer:2*1024*1024})).stdout.trim();
 t.after(async()=>{try{const ids=[...new Set([...peers,...(await docker(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean)])];if(ids.length){await docker(['stop','--time','10',...ids]);await docker(['rm','-v',...ids]);}for(const kind of ['network','volume']){const ids=(await docker([kind,'ls','-q','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);for(const id of ids)await docker([kind,'rm',id]);}}finally{await rm(directory,{recursive:true,force:true});}});
 async function wait(check){let last;for(let n=0;n<160;n++){try{if(await check())return;}catch(error){last=error;}await new Promise(r=>setTimeout(r,250));}throw Error('remote proof timed out',{cause:last});}
 try{
  await docker([...prefix,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','90']);
  const account=await docker([...prefix,'ps','-q','account']),gateway=await docker([...prefix,'ps','-q','gateway']),worker=await docker([...prefix,'ps','-q','gateway-manifest']);
  const ip=await docker(['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',gateway]),port=Number((await docker([...prefix,'port','gateway','443'])).split(':').at(-1));
  const phase=async name=>{const output=await docker(['exec',account,'node','--input-type=module','-e',`import {remoteClientProof} from './deploy/test-cloud/test-fixtures/remote-client.mjs';await remoteClientProof(${JSON.stringify(name)},${JSON.stringify(ip)});`]);console.log(output);return JSON.parse(output.split('\n').at(-1));};
  const seeded=await phase('seed'),ca=await docker(['exec',gateway,'cat','/run/local-stack/lan/ca.pem']);assert.equal(seeded.signedStaffCertificates,200);
  for(let n=0;n<2;n++)peers.push(await docker(['run','-d','--label',`com.docker.compose.project=${project}`,'--network',project+'_default','--cap-add','NET_ADMIN','--mount',`type=volume,source=${project}_local-stack-config,volume-subpath=remote-proof/peer-${n},target=/input,readonly`,image,'sh','-c','node /input/upstream.mjs & exec node packages/remote-access/src/peer-cli.ts']));
  function probe(host,path='/'){return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,servername:host,headers:{host},path,ca,agent:false},res=>{const fingerprint=res.socket.getPeerCertificate().fingerprint256;let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body,fingerprint}));});req.setTimeout(1500,()=>req.destroy(Error('remote probe timeout')));req.once('error',reject);req.end();});}
  const [a,b]=seeded.venues;
  for(const [n,v] of seeded.venues.entries())await wait(async()=>{const result=await probe(v.staffHostname);return result.status===200&&result.body===`venue-${n}`;});
  for(const v of seeded.venues)assert.equal((await probe(v.publicHostname,'/_cloud/challenge')).status,200);
  const beforeRenewal=(await probe(b.publicHostname,'/_cloud/challenge')).fingerprint;await phase('renew-public');
  await wait(async()=>{const result=await probe(b.publicHostname,'/_cloud/challenge');return result.status===200&&result.fingerprint!==beforeRenewal;});
  assert.equal(await docker(['exec',gateway,'node','deploy/test-cloud/gateway-health.mjs']),'');
  const committed=Date.now();await phase('downgrade');
  await wait(async()=>{await assert.rejects(probe(a.staffHostname));await assert.rejects(probe(a.publicHostname,'/_cloud/challenge'));return (await probe(b.staffHostname)).body==='venue-1';});
  const withdrawalMs=Date.now()-committed,peerList=await docker(['exec',gateway,'wg','show','wg-cloud','peers']);assert.ok(!peerList.includes(a.peerPublicKey));assert.ok(peerList.includes(b.peerPublicKey));
  await phase('upgrade');await wait(async()=>(await probe(a.staffHostname)).body==='venue-0');
  await docker(['stop','--time','10',worker]);await phase('downgrade-pending');await docker(['start',worker]);
  await wait(async()=>{await assert.rejects(probe(a.staffHostname));return (await probe(b.staffHostname)).body==='venue-1';});
  console.log(JSON.stringify({project,freeProvision:403,signedPaidCertificates:200,staffBodiesIsolated:true,publicTlsAndGate:true,publicCertificateReload:true,realPeerWithdrawal:true,restartWithdrawal:true,withdrawalMs,privateState:'volume-only'}));
 }catch(error){console.error(await docker([...prefix,'logs','--tail','15','gateway-manifest','gateway','account']));throw error;}
});
