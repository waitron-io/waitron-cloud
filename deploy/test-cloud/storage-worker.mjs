import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {lstat,mkdir,readFile,rm,chmod,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Agent} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {loadRuntime} from '../local-stack/runtime.mjs';
import {claimLease} from '../local-stack/lease.mjs';
import {atomicPrivateFile} from './storage-authority.mjs';
import {startStorageIssuer,bootstrapStorageIssuer} from './storage-issuer.mjs';
import {openRuntimeStorage,testStorageOptions} from './service-runtime.mjs';
import {parsePlanMode} from '../../packages/registration/src/organisation-plans.ts';
const require=createRequire(new URL('../../packages/registration/package.json',import.meta.url)),{Pool}=require('pg');
const {S3Client,ListBucketsCommand}=createRequire(new URL('../../packages/backups/package.json',import.meta.url))('@aws-sdk/client-s3');

export async function prepareStorageBoot(directory){
 const config=await loadRuntime(directory),file=join(directory,'storage-authority/iam.json');
 const managed=join(directory,'storage-authority/managed');await mkdir(managed,{recursive:true,mode:0o700});
 let held;for(let n=0;n<200&&!held;n++){held=await claimLease(join(managed,'.authority.lock'));if(!held)await delay(25);}if(!held)throw Error('test_cloud.storage_busy');
 try{
  let saved;try{saved=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(saved.identities))throw Error('test_cloud.storage_state');}catch(error){if(error.code!=='ENOENT')throw error;}
  try{const state=await lstat(join(directory,'storage-authority/managed/state.json'));if(!state.isFile()||(state.mode&0o777)!==0o600)throw Error('test_cloud.storage_state');}
  catch(error){if(error.code!=='ENOENT'||saved?.identities.some(value=>value.name?.startsWith('managed-')))throw Error('test_cloud.storage_state');}
  // Start the provider with no venue keys. Reconciliation restores only current paid authority.
  await held.assertOwned();await atomicPrivateFile(file,JSON.stringify({identities:[{name:'test-cloud-admin',credentials:[{accessKey:config.storage.accessKeyId,secretKey:config.storage.secretAccessKey}],actions:['Admin','Read','Write','List','Tagging']}]}));
 }finally{await held.release();}
}
export async function runTestStorage({directory='/run/local-stack',mode,signal}={}){
 if(!['existing','test-free-paid','test-venue-levels'].includes(mode))throw Error('test_cloud.plan_mode');
 await bootstrapStorageIssuer(directory);
 const held=await claimLease(join(directory,'storage-authority/.controller.lock'));if(!held)throw Error('test_cloud.storage_busy');
 const socket=join(directory,'storage-authority/reload.sock'),ready='/tmp/test-cloud-storage-ready';
 let issuer,child,closed,server,pool,client;const stop=new AbortController(),abort=()=>stop.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try{
  await rm(ready,{force:true});await prepareStorageBoot(directory);issuer=await startStorageIssuer(directory);
  const args=['mini','-dir=/data','-ip=storage','-ip.bind=0.0.0.0','-master.port=9333','-master.port.grpc=19333','-volume.port=8080','-volume.port.grpc=18080','-filer.port=8888','-filer.port.grpc=18888','-s3.port=8333',`-s3.cert.file=${join(directory,'lan/cert.pem')}`,`-s3.key.file=${join(directory,'lan/key.pem')}`,`-s3.config=${join(directory,'storage-authority/iam.json')}`,`-s3.iam.config=${join(directory,'storage-authority/sts.json')}`,'-admin.ui=false','-webdav=false','-s3.port.iceberg=0','-s3.port.lance=0'];
  child=spawn('weed',args,{stdio:['ignore','inherit','inherit']});closed=new Promise(resolve=>{child.once('error',()=>{abort();resolve();});child.once('exit',()=>{abort();resolve();});});
  const options=await testStorageOptions({directory,reload:async()=>{await held.assertOwned();if(!child.kill('SIGHUP'))throw Error('test_cloud.storage_reload');}});
  client=new S3Client({endpoint:options.endpoint,region:options.region,credentials:options.admin,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:options.ca})}});
  let listening=false;
  for(let n=0;n<120&&!stop.signal.aborted;n++){try{await client.send(new ListBucketsCommand({}),{abortSignal:AbortSignal.timeout(1000)});listening=true;break;}catch{await delay(250);}}
  if(!listening||stop.signal.aborted)throw Error('test_cloud.storage_startup');
  const config=await loadRuntime(directory);pool=new Pool({connectionString:`postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});pool.on('error',abort);options.pool=pool;
  const authority=await openRuntimeStorage({...options,mode});
  await held.assertOwned();await rm(socket,{force:true});server=createServer((req,res)=>{req.resume();if(req.method!=='POST'||req.url!=='/reload'){res.writeHead(404);res.end();return;}void options.reload().then(()=>{res.writeHead(204);res.end();},()=>{res.writeHead(503);res.end();});});
  server.requestTimeout=5000;server.headersTimeout=5000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});await chmod(socket,0o600);
  while(!stop.signal.aborted){
   try{await held.assertOwned();await authority.reconcile();await writeFile(ready,'ready\n',{mode:0o600});}
   catch{await rm(ready,{force:true});console.error('Test storage policy reconciliation failed; withdrawal is incomplete');}
   await delay(1000,undefined,{signal:stop.signal}).catch(()=>{});
  }
  if(!signal?.aborted)throw Error('test_cloud.storage_process');
 }finally{
  signal?.removeEventListener('abort',abort);await rm(ready,{force:true});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(socket,{force:true});}
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(timer);}}
  client?.destroy();await issuer?.close();await pool?.end();await held.release();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 try{if(process.argv.length!==2)throw Error();await runTestStorage({directory:process.env.LOCAL_STACK_CONFIG_DIR,mode:parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS),signal:stop.signal});}
 catch{console.error('Test storage failed; check private state, schema and owned provider');process.exitCode=1;}
 finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
