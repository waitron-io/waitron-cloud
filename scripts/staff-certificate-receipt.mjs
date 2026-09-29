import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createRequire} from 'node:module';
import {createHash,randomUUID,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {staffExchangeFixture} from '../packages/remote-access/test/staff-exchange-fixture.ts';
import {RemoteConfigurationReconciler} from '../packages/remote-access/src/reconciler.ts';
import {startAcme,docker} from './remote-fixtures.mjs';
const require=createRequire(new URL('../packages/account-http/package.json',import.meta.url)),{serve}=require('@hono/node-server');
const acmeRequire=createRequire(new URL('../packages/remote-access/package.json',import.meta.url)),{crypto:acmeCrypto}=acmeRequire('acme-client');
assert(process.env.WAITRON_CHECKOUT,'Set WAITRON_CHECKOUT');
const waitron=resolve(process.env.WAITRON_CHECKOUT),file=resolve(process.argv[2]??'/tmp/cloud-staff-certificate-receipt.json');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const waitronHead=git(waitron,'rev-parse','HEAD'),root=await mkdtemp(join(tmpdir(),'cloud-staff-exchange-'));
const f=await staffExchangeFixture();let acme,server,receipt,ownedNetwork;const checks=[];
const command=(state,action,hostname,path)=>execFileSync('pnpm',['--filter','@waitron/server','exec','tsx','scripts/cloud-certificate.ts',action,state,hostname,path],{cwd:waitron,encoding:'utf8',timeout:30000});
try{
 acme=await startAcme();
 const port=new URL(acme.dnsUrl).port;
 const dns=docker('ps','--filter','name=cloud-acme-','--format','{{.Names}}').split('\n').filter(name=>name.endsWith('-dns')&&docker('port',name,'8055/tcp').split(':').at(-1)===port);
 assert.equal(dns.length,1);ownedNetwork=dns[0].replace(/-dns$/,'');
 server=serve({fetch:f.app.fetch,hostname:'127.0.0.1',port:0});if(!server.listening)await new Promise(r=>server.once('listening',r));
 const httpOrigin=`http://127.0.0.1:${server.address().port}`;
 async function exchange(a,action,body,id=randomUUID()){
  const payload=JSON.stringify(a.proof(action,body,id,a.lease));
  return new Promise((resolve,reject)=>{
   const req=request(httpOrigin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json',host:new URL(f.origin).host,'content-length':Buffer.byteLength(payload)}},res=>{
    let text='';res.on('data',chunk=>text+=chunk);res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});
   });req.setTimeout(5000,()=>req.destroy(Error('exchange timeout')));req.on('error',reject);req.end(payload);
  });
 }
 const accountKeyFile=join(root,'acme.key');await writeFile(accountKeyFile,await acmeCrypto.createPrivateKey(),{mode:0o600});
 let issues=0;
 const issueCertificate=async target=>{issues++;const csrFile=join(root,randomUUID()+'.csr'),output=join(root,randomUUID()+'.crt');await writeFile(csrFile,target.csr);return acme.issue({hostname:target.hostname,csrFile,output,accountKeyFile,dnsName:target.dnsName});};
 const worker=new RemoteConfigurationReconciler(f.db.pool,{staffExchange:true,issueCertificate});
 const venues=[];
 for(let n=0;n<2;n++){
  const a=await f.venue(),state=join(root,'venue-'+n),csrFile=join(root,`venue-${n}.csr`),certificateFile=join(root,`venue-${n}.crt`);
  command(state,'csr',a.body.hostname,csrFile);a.body.csr=await readFile(csrFile,'utf8');const id=randomUUID();
  const accepted=await exchange(a,'staff-certificate-submit',a.body,id);assert.equal(accepted.status,200,JSON.stringify(accepted));
  assert.deepEqual(await exchange(a,'staff-certificate-submit',a.body,id),accepted);
  venues.push({a,state,csrFile,certificateFile,id});
 }
 await worker.schedule();await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff'");
 assert.deepEqual((await Promise.all([worker.runOnce(),worker.runOnce(),worker.runOnce()])).sort(),[false,true,true]);assert.equal(issues,2);
 for(const v of venues){
  const ready=await exchange(v.a,'staff-certificate-status',{version:1,requestId:v.id});assert.equal(ready.status,200);assert.equal(ready.body.state,'ready');
  const chain=ready.body.certificate;assert.equal(ready.body.csrDigest,createHash('sha256').update(v.a.body.csr).digest('hex'));
  await writeFile(v.certificateFile,chain);command(v.state,'install',v.a.body.hostname,v.certificateFile);
  assert.equal(await readFile(join(v.state,'cloud-staff.crt'),'utf8'),chain);v.initial=chain;
  const key=await readFile(join(v.state,'cloud-staff.key'),'utf8');assert.equal(JSON.stringify((await f.db.pool.query('SELECT * FROM staff_certificate_exchange')).rows).includes(key),false);
 }
 checks.push('two independently owned installations submitted CSRs over HTTP and installed local Pebble chains with unchanged Waitron CLI');
 const [a,b]=venues;
 assert.equal((await exchange(b.a,'staff-certificate-status',{version:1,requestId:a.id})).status,409);
 await writeFile(a.certificateFile,b.initial);assert.throws(()=>command(a.state,'install',a.a.body.hostname,a.certificateFile));assert.equal(await readFile(join(a.state,'cloud-staff.crt'),'utf8'),a.initial);
 const wrongKeyCsr=join(root,'wrong-key.csr'),wrongKeyOutput=join(root,'wrong-key.crt');command(b.state,'csr',a.a.body.hostname,wrongKeyCsr);issues++;
 const wrongKeyChain=await acme.issue({hostname:a.a.body.hostname,csrFile:wrongKeyCsr,output:wrongKeyOutput,accountKeyFile});
 assert.equal(new X509Certificate(wrongKeyChain).checkHost(a.a.body.hostname),a.a.body.hostname);
 assert.throws(()=>command(a.state,'install',a.a.body.hostname,wrongKeyOutput));assert.equal(await readFile(join(a.state,'cloud-staff.crt'),'utf8'),a.initial);
 checks.push('cross-tenant status, wrong-host chain and separately same-host wrong-key chain installation refused while prior chain stayed installed');
 const next=randomUUID(),replacement={...a.a.body,previousRequestId:a.id};assert.equal((await exchange(a.a,'staff-certificate-submit',replacement,next)).status,200);
 await worker.schedule();await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff'");
 await new RemoteConfigurationReconciler(f.db.pool,{staffExchange:true,issueCertificate:async()=>{throw Error('local DNS failure');}}).runOnce();
 const pending=await exchange(a.a,'staff-certificate-status',{version:1,requestId:next});assert.equal(pending.body.state,'pending');assert.equal('certificate'in pending.body,false);assert.equal(await readFile(join(a.state,'cloud-staff.crt'),'utf8'),a.initial);
 await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE target_id=$1 AND kind='certificate_staff'",[a.a.installationId]);await worker.runOnce();
 const renewed=await exchange(a.a,'staff-certificate-status',{version:1,requestId:next});assert.equal(renewed.body.state,'ready');assert.notEqual(renewed.body.certificate,a.initial);await writeFile(a.certificateFile,renewed.body.certificate);command(a.state,'install',a.a.body.hostname,a.certificateFile);
 assert.equal((await exchange(a.a,'staff-certificate-submit',a.a.body,a.id)).status,409);assert.equal((await exchange(b.a,'staff-certificate-status',{version:1,requestId:b.id})).body.certificate,b.initial);
 checks.push('renewal failure retained installed chain, retry installed new chain, delayed original submission refused, second venue unchanged');
 const third=randomUUID();assert.equal((await exchange(a.a,'staff-certificate-submit',{...a.a.body,previousRequestId:next},third)).status,200);
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const staleWorker=new RemoteConfigurationReconciler(f.db.pool,{staffExchange:true,issueCertificate:async target=>{const chain=await issueCertificate(target);entered();await gate;return chain;}});await staleWorker.schedule();
 await f.db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff'");
 const running=staleWorker.runOnce();try{await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('local issuance timeout')),65000).unref())]);await f.db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[a.a.installationId]);}finally{release();await running;}
 assert.equal((await exchange(a.a,'staff-certificate-status',{version:1,requestId:third})).status,409);
 assert.equal((await f.db.pool.query('SELECT certificate FROM staff_certificate_exchange WHERE installation_id=$1',[a.a.installationId])).rows[0].certificate,renewed.body.certificate);
 await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[a.a.installationId]);assert.equal((await exchange(a.a,'staff-certificate-status',{version:1,requestId:third})).status,403);
 checks.push('configuration change during real ACME issuance fenced publication; revoked installation refused reads');
 assert.equal(git(waitron,'rev-parse','HEAD'),waitronHead,'Waitron checkout changed during proof');
 receipt={version:1,cloudHead:git(process.cwd(),'rev-parse','HEAD'),cloudDirty:git(process.cwd(),'status','--porcelain')!=='',waitronHead,waitronDirty:git(waitron,'status','--porcelain')!=='',liveResources:false,transport:'loopback HTTP with signed installation envelopes; production HTTPS not exercised',installations:venues.map(v=>({id:v.a.installationId,venueId:v.a.venueId,hostname:v.a.body.hostname,fingerprint:new X509Certificate(v.initial).fingerprint256})),issues,checks};
}finally{
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 await acme?.close();await f.close();await rm(root,{recursive:true,force:true});
 if(ownedNetwork){assert.equal(docker('ps','-a','--filter',`network=${ownedNetwork}`,'--format','{{.ID}}'),'');assert.equal(docker('network','ls','--filter',`name=^${ownedNetwork}$`,'--format','{{.Name}}'),'');}
 await assert.rejects(access(root));
}
assert(receipt);receipt.cleanup={containers:0,networks:0,temporaryStateRemoved:true,databaseSchemaRemoved:true};await writeFile(file,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
