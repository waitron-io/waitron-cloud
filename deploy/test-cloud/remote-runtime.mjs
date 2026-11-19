import {createPrivateKey,createPublicKey,generateKeyPairSync,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {access,mkdir,open,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join,isAbsolute,resolve,sep} from 'node:path';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {transaction} from '../../packages/registration/src/transaction.ts';
import {RemoteConfigurationReconciler} from '../../packages/remote-access/src/reconciler.ts';
import {isUuid,isHostname,verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {challengeHandlers,validateCsr} from '../../packages/remote-access/src/certificates.ts';
import {deleteChallenge,writeChallenge} from '../../packages/remote-access/src/challenge-files.ts';
import {answerableNames} from '../../packages/remote-access/src/gateway-status.ts';
import {loadRuntime,canonicalHttpsOrigin} from '../local-stack/runtime.mjs';
import {claimLease} from '../local-stack/lease.mjs';
import {isTestRemoteHostname,presentHttpChallenge,removeHttpChallenge} from './http-challenges.mjs';
const {Client}=createRequire(new URL('../../packages/remote-access/package.json',import.meta.url))('acme-client');

const execute=promisify(execFile),suffix='r.waitron.local';
async function privateFile(path){if(((await stat(path)).mode&0o777)!==0o600)throw Error('test_cloud.remote_state_invalid');return readFile(path,'utf8');}
async function atomic(path,bytes){const temporary=path+'.'+randomUUID();try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await rename(temporary,path);}finally{await rm(temporary,{force:true});}}
export async function loadPublicRemoteSettings(directory,environment){
 const flag=environment.TEST_CLOUD_PUBLIC_REMOTE??'0';if(!['0','1'].includes(flag))throw Error('test_cloud.remote_settings');if(flag==='0')return;
 const zone=new URL(canonicalHttpsOrigin(environment.TEST_CLOUD_ORIGIN)).hostname,directoryUrl=environment.TEST_CLOUD_ACME_DIRECTORY,challengeDirectory=environment.TEST_CLOUD_CHALLENGE_DIR;
 const url=new URL(directoryUrl);
 if(!isHostname(zone)||zone.length>180||url.protocol!=='https:'||url.username||url.password||url.hash||!isAbsolute(challengeDirectory??''))throw Error('test_cloud.remote_settings');
 const tlsChallengeDirectory=environment.TEST_CLOUD_TLS_CHALLENGE_DIR,statusDirectory=environment.TEST_CLOUD_GATEWAY_STATUS_DIR;
 if(tlsChallengeDirectory!==undefined||statusDirectory!==undefined){
  const paths=[challengeDirectory,tlsChallengeDirectory,statusDirectory];
  if(paths.some(path=>!isAbsolute(path??'')))throw Error('test_cloud.remote_settings');
  const folders=paths.map(path=>resolve(path)).map(path=>path.endsWith(sep)?path:path+sep);
  if(folders.some((folder,index)=>folders.some((other,i)=>i!==index&&other.startsWith(folder))))throw Error('test_cloud.remote_settings');
 }
 const state=join(directory,'acme');await mkdir(state,{recursive:true,mode:0o700});const lease=await claimLease(join(state,'account.lock'));if(!lease)throw Error('test_cloud.remote_busy');
 try{
  const file=join(state,'account-key.pem');let accountKey;
  try{accountKey=await privateFile(file);}catch(error){if(error.code!=='ENOENT')throw error;accountKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'});await lease.assertOwned();await atomic(file,accountKey);}
  createPrivateKey(accountKey);return{zone,endpoint:zone+':51820',directoryUrl,accountKey,challengeDirectory,tlsChallengeDirectory,statusDirectory};
 }finally{await lease.release();}
}
function publicTarget(directory,id){if(!isUuid(id))throw Error('test_cloud.remote_target');return join(directory,'remote',id);}
export async function issueTestRemoteCertificate(directory,target,publicRemote){
 target.signal.throwIfAborted();validateCsr(target.csr,target.hostname);
 if(publicRemote){
  const tls=target.validation?.type==='tls-alpn-01';
  if(!tls&&!isTestRemoteHostname(target.hostname,publicRemote.zone))throw Error('test_cloud.remote_target');
  const client=new Client({directoryUrl:publicRemote.directoryUrl,accountKey:publicRemote.accountKey,backoffAttempts:5,backoffMin:500,backoffMax:3000});
  // An explicit empty contact list makes repeated registration a valid account update.
  await client.createAccount({termsOfServiceAgreed:true,contact:[]});target.signal.throwIfAborted();
  if(tls){
   const chain=await client.auto({csr:target.csr,termsOfServiceAgreed:true,challengePriority:['tls-alpn-01'],
    skipChallengeVerification:true,...challengeHandlers(target)});
   target.signal.throwIfAborted();return chain;
  }
  const active=new Set();
  const cleanup=()=>Promise.all([...active].map(token=>removeHttpChallenge(publicRemote.challengeDirectory,target.hostname,token))),abort=()=>{void cleanup().catch(()=>{});};
  target.signal.addEventListener('abort',abort,{once:true});
  try{
   const chain=await client.auto({csr:target.csr,termsOfServiceAgreed:true,challengePriority:['http-01'],skipChallengeVerification:true,
    challengeCreateFn:async(authz,challenge,value)=>{target.signal.throwIfAborted();if(authz.identifier.value!==target.hostname||challenge.type!=='http-01')throw Error('test_cloud.remote_challenge');active.add(challenge.token);await presentHttpChallenge(publicRemote.challengeDirectory,target.hostname,challenge.token,value);if(target.signal.aborted){await cleanup();target.signal.throwIfAborted();}},
    challengeRemoveFn:async(authz,challenge)=>{if(authz.identifier.value!==target.hostname||challenge.type!=='http-01')throw Error('test_cloud.remote_challenge');await removeHttpChallenge(publicRemote.challengeDirectory,target.hostname,challenge.token);active.delete(challenge.token);}
   });target.signal.throwIfAborted();return chain;
  }finally{target.signal.removeEventListener('abort',abort);await cleanup();}
 }
 if(!target.hostname.endsWith('.'+suffix))throw Error('test_cloud.remote_target');
 const scratch=join(directory,'remote','.sign-'+randomUUID());await mkdir(scratch,{mode:0o700});
 try{
  await writeFile(join(scratch,'request.pem'),target.csr,{mode:0o600});
  await writeFile(join(scratch,'extensions'),'subjectAltName=DNS:'+target.hostname+'\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{mode:0o600});
  await execute('openssl',['x509','-req','-in',join(scratch,'request.pem'),'-CA',join(directory,'lan/ca.pem'),'-CAkey',join(directory,'lan/ca-key.pem'),'-set_serial','0x'+randomUUID().replaceAll('-',''),'-out',join(scratch,'certificate.pem'),'-days','30','-extfile',join(scratch,'extensions')],{timeout:30000,signal:target.signal});
  target.signal.throwIfAborted();return await readFile(join(scratch,'certificate.pem'),'utf8')+await privateFile(join(directory,'lan/ca.pem'));
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function openTestRemoteRuntime({pool,directory,mode,publicRemote,resolveCname,publication}){
 if(!['existing','test-free-paid','test-venue-levels'].includes(mode))throw Error('test_cloud.plan_mode');
 const zone=publicRemote?.zone??suffix,endpoint=publicRemote?.endpoint??'waitron.local:51820';
 if(publicRemote){
  const url=new URL(publicRemote.directoryUrl);
  if(!isHostname(zone)||zone.length>180||endpoint!==zone+':51820'||url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('test_cloud.remote_settings');
  createPrivateKey(publicRemote.accountKey);
 }
 const cellId=publication?.cellId??(await loadRuntime(directory)).gateway.cellId;
 const key=createPrivateKey(await privateFile(join(directory,'gateway-signing-key.pem'))),trust=createPublicKey(await privateFile(join(directory,'gateway-issuer.pem')));
 if(!createPublicKey(key).equals(trust))throw Error('test_cloud.remote_state_invalid');
 const wireguard=Buffer.from((await privateFile(join(directory,'gateway-wireguard.key'))).trim(),'base64');if(wireguard.length!==32)throw Error('test_cloud.remote_state_invalid');
 const publicKey=createPublicKey(createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),wireguard]),format:'der',type:'pkcs8'})).export({format:'der',type:'spki'}).subarray(-32).toString('base64');
 // Recover only the sequence of an expired signed file; routes still come from current policy.
 const envelope=JSON.parse(await publication?.readManifest()??await privateFile(join(directory,'gateway-manifest.json'))),issued=JSON.parse(Buffer.from(envelope.payload,'base64url')).issuedAt,manifest=verifyManifest(envelope,trust,cellId,issued);
 await transaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('test_cloud_remote_cell'))");
  await client.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint,sequence) VALUES($1,'ES','aws','test',$2,61,$3,$4,$5) ON CONFLICT(id) DO NOTHING",[cellId,zone,publicKey,endpoint,manifest.sequence]);
  const row=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR UPDATE',[cellId])).rows[0];
  if(row.country!=='ES'||row.provider!=='aws'||row.environment!=='test'||row.subnet!==61||row.public_key!==publicKey)throw Error('test_cloud.remote_cell_conflict');
  await client.query("INSERT INTO remote_country_zones(country,environment,suffix) VALUES('ES','test',$1) ON CONFLICT(country,environment) DO NOTHING",[zone]);
  const countryZone=(await client.query("SELECT suffix FROM remote_country_zones WHERE country='ES' AND environment='test' FOR UPDATE")).rows[0];
  if(row.suffix!==zone||row.endpoint!==endpoint||publicRemote&&countryZone.suffix!==zone){
   if(!publicRemote||(await client.query('SELECT 1 FROM remote_placements UNION ALL SELECT 1 FROM remote_hostnames LIMIT 1')).rowCount)throw Error('test_cloud.remote_cell_conflict');
   await client.query('UPDATE remote_cells SET suffix=$2,endpoint=$3 WHERE id=$1',[cellId,zone,endpoint]);
   await client.query("UPDATE remote_country_zones SET suffix=$1 WHERE country='ES' AND environment='test'",[zone]);
  }
  // File publication can survive a rolled-back completion; never reuse its signed sequence.
  await client.query('UPDATE remote_cells SET sequence=GREATEST(sequence,$2) WHERE id=$1',[cellId,manifest.sequence]);
 });
 await mkdir(join(directory,'remote'),{recursive:true,mode:0o700});
 const artifacts={
  async readPublicCertificate(id){
   if(publication)return publication.readPublicCertificate(id);
   const target=publicTarget(directory,id);
   try{return {pem:await privateFile(join(target,'key.pem'))+await privateFile(join(target,'certificate.pem')),csr:await privateFile(join(target,'request.pem'))};}catch(error){if(error.code!=='ENOENT')throw error;}
  },
  async publishPublicCertificate(id,venueId,cells,copy){
   if(!isUuid(venueId)||!cells.length||cells.some(cell=>cell!==cellId))throw Error('test_cloud.remote_target');
   const target=publicTarget(directory,id),begin=copy.pem.indexOf('-----BEGIN CERTIFICATE-----');if(begin<0)throw Error('test_cloud.remote_state_invalid');
   const key=createPrivateKey(copy.pem).export({format:'pem',type:'pkcs8'}),chain=copy.pem.slice(begin);
   if(publication){
    await publication.publishPublicCertificate(id,venueId,copy);
    return {copied:cells,complete:true};
   }
   await atomic(join(directory,'public-certs',venueId+'.pem'),copy.pem);
   await mkdir(target,{recursive:true,mode:0o700});
   await atomic(join(target,'key.pem'),key);await atomic(join(target,'request.pem'),copy.csr);await atomic(join(target,'certificate.pem'),chain);
   if(id!==venueId)await rm(join(directory,'public-certs',id+'.pem'),{force:true});return {copied:cells,complete:true};
  },
  async publishManifest(id,text){if(id!==cellId)throw Error('test_cloud.remote_target');if(publication)await publication.publishManifest(id,text);else await atomic(join(directory,'gateway-manifest.json'),text);}
 };
 const {tlsChallengeDirectory,statusDirectory}=publicRemote??{};
 let gatewayStatus;
 if(tlsChallengeDirectory&&statusDirectory){
  artifacts.hasChallengeFolder=async id=>{
   if(id!==cellId)return false;
   try{await access(tlsChallengeDirectory+'/',constants.W_OK|constants.X_OK);return true;}catch{return false;}
  };
  artifacts.writeChallenge=async(id,file)=>{
   if(id!==cellId)throw Error('test_cloud.remote_target');
   await writeChallenge(tlsChallengeDirectory,file);
  };
  artifacts.deleteChallenge=async(id,hostname)=>{
   if(id===cellId)await deleteChallenge(tlsChallengeDirectory,hostname);
  };
  gatewayStatus={async read(id){
   return id===cellId?[answerableNames(await readFile(join(statusDirectory,'status.json'),'utf8'))]:[];
  }};
 }
 // The operator wildcard supplies assigned names. The reconciler verifies the owner's CNAME.
 const worker=new RemoteConfigurationReconciler(pool,{planMode:mode,artifacts,gatewayStatus,resolveCname,pointName:async()=>{},signingKeyForCell:async id=>{if(id!==cellId)throw Error('test_cloud.remote_target');return key;},issueCertificate:target=>issueTestRemoteCertificate(directory,target,publicRemote)});
 return {worker,cellId};
}
