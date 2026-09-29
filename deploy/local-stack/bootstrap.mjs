import {execFile} from 'node:child_process';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {chmod,mkdir,open,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {signManifest} from '../../packages/remote-access/src/manifest.ts';
import {claimLease} from './lease.mjs';

const execute=promisify(execFile),files=['postgres-password','gateway-issuer.pem','gateway-signing-key.pem','gateway-wireguard.key','gateway-bot.key','gateway-manifest.json','gateway-sequence','storage-ca.pem','storage-cert.pem','storage-key.pem','storage-iam.json','public-certs/default.pem'];
const hex=bytes=>randomBytes(bytes).toString('hex'),fingerprint=value=>createHash('sha256').update(value).digest('hex');
export function isLocalStackConfig(config){
 return config?.version===1&&typeof config.createdAt==='string'&&/^[0-9a-f]{64}$/.test(config.database?.password)
  &&config.email?.activeKeyId==='local-v1'&&/^[0-9a-f]{64}$/.test(config.email?.keys?.['local-v1'])
  &&/^[0-9a-f]{64}$/.test(config.http?.rateKey)&&/^[0-9a-f]{64}$/.test(config.backup?.masterKey)
  &&typeof config.installation?.issuerKey==='string'&&config.installation.issuerKey.length>40
  &&config.storage?.endpoint==='https://storage:8333'&&config.storage.region==='local'
  &&typeof config.storage.accessKeyId==='string'&&typeof config.storage.secretAccessKey==='string'
  &&typeof config.gateway?.cellId==='string'&&config.gateway.subnet===61&&config.gateway.routes===0
  &&/^[0-9a-f]{64}$/.test(config.fingerprints?.gatewaySigningKey)&&/^[0-9a-f]{64}$/.test(config.fingerprints?.storageCertificate);
}
async function readExisting(directory){
 const runtime=join(directory,'runtime.json');
 try{await stat(runtime);}catch(error){
  if(error?.code!=='ENOENT')throw new Error('local_stack.configuration_invalid');
  for(const name of files)try{await stat(join(directory,name));throw new Error('local_stack.configuration_invalid');}catch(cause){if(cause?.code!=='ENOENT')throw cause;}
  return;
 }
 try{
  const info=await stat(runtime);if((info.mode&0o777)!==0o600)throw Error();
  const config=JSON.parse(await readFile(runtime,'utf8'));if(!isLocalStackConfig(config))throw Error();
  for(const name of files)if(((await stat(join(directory,name))).mode&0o777)!==0o600)throw Error();
  if(fingerprint(await readFile(join(directory,'gateway-signing-key.pem')))!==config.fingerprints.gatewaySigningKey)throw Error();
  if(fingerprint(await readFile(join(directory,'storage-cert.pem')))!==config.fingerprints.storageCertificate)throw Error();
  return config;
 }catch{throw new Error('local_stack.configuration_invalid');}
}
async function publish(directory,temporary,name,value){
 const path=join(temporary,name);await writeFile(path,value,{mode:0o600});await chmod(path,0o600);await rename(path,join(directory,name));
}
async function syncDirectory(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function acquire(directory){
 const lock=join(directory,'.bootstrap.lock');
 for(let attempt=0;attempt<200;attempt++){const lease=await claimLease(lock);if(lease)return lease;await new Promise(resolve=>setTimeout(resolve,25));}
 throw new Error('local_stack.bootstrap_busy');
}

export async function bootstrap(directory){
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 const initial=await readExisting(directory);if(initial)return initial;
 const lease=await acquire(directory);
 const temporary=join(directory,'.bootstrap-'+randomUUID());
 try{
  const afterLock=await readExisting(directory);if(afterLock)return afterLock;
  await mkdir(temporary,{mode:0o700});
  const gateway=generateKeyPairSync('ed25519'),installation=generateKeyPairSync('ed25519'),cellId=randomUUID(),now=Date.now();
  const privatePem=gateway.privateKey.export({type:'pkcs8',format:'pem'}),publicPem=gateway.publicKey.export({type:'spki',format:'pem'});
  const manifest=signManifest({version:1,audience:'waitron-cloud-gateway',cellId,sequence:1,issuedAt:now,expiresAt:now+540000,routes:[]},gateway.privateKey,now);
  const certificate=join(temporary,'certificate.pem'),certificateKey=join(temporary,'certificate-key.pem');
  await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',certificateKey,'-out',certificate,'-days','30','-subj','/CN=storage','-addext','subjectAltName=DNS:storage,DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],{timeout:30000});
  const cert=await readFile(certificate),certKey=await readFile(certificateKey),storage={accessKeyId:'local-'+hex(8),secretAccessKey:randomBytes(32).toString('base64url')},databasePassword=hex(32);
  const values={
   'postgres-password':databasePassword+'\n',
   'gateway-issuer.pem':publicPem,'gateway-signing-key.pem':privatePem,'gateway-wireguard.key':randomBytes(32).toString('base64')+'\n','gateway-bot.key':randomBytes(32),
   'gateway-manifest.json':JSON.stringify(manifest),'gateway-sequence':'1\n','storage-ca.pem':cert,'storage-cert.pem':cert,'storage-key.pem':certKey,
   'storage-iam.json':JSON.stringify({identities:[{name:'local-stack',credentials:[{accessKey:storage.accessKeyId,secretKey:storage.secretAccessKey}],actions:['Admin','Read','Write','List','Tagging']}]})
  };
  for(const [name,value] of Object.entries(values)){await lease.assertOwned();await publish(directory,temporary,name,value);}
  const publicCertificates=join(directory,'public-certs');await mkdir(publicCertificates,{recursive:true,mode:0o700});await chmod(publicCertificates,0o700);
  await writeFile(join(publicCertificates,'default.pem'),Buffer.concat([certKey,cert]),{mode:0o600});await chmod(join(publicCertificates,'default.pem'),0o600);
  const config={version:1,createdAt:new Date(now).toISOString(),database:{user:'cloud',name:'cloud',password:databasePassword},
   email:{activeKeyId:'local-v1',keys:{'local-v1':hex(32)}},pairing:{activeKeyId:'local-v1',keys:{'local-v1':hex(32)}},http:{rateKey:hex(32)},backup:{masterKey:hex(32)},
   installation:{issuerKey:installation.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')},
   storage:{endpoint:'https://storage:8333',region:'local',accessKeyId:storage.accessKeyId,secretAccessKey:storage.secretAccessKey},
   gateway:{cellId,subnet:61,routes:0},fingerprints:{gatewaySigningKey:fingerprint(privatePem),storageCertificate:fingerprint(cert)}};
  await lease.assertOwned();await publish(directory,temporary,'runtime.json',JSON.stringify(config));await syncDirectory(directory);return config;
 }finally{await rm(temporary,{recursive:true,force:true});await lease.release();}
}

if(import.meta.url===`file://${process.argv[1]}`){
 let stopping=false;const shutdown=()=>{stopping=true;};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 try{await bootstrap(process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack');if(!stopping)console.log(JSON.stringify({status:'ready'}));else process.exitCode=143;}
 catch{console.error('Local stack bootstrap failed; inspect the private configuration volume');process.exitCode=1;}
 finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
