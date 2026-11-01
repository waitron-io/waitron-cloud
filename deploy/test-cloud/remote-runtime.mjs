import {createPrivateKey,createPublicKey,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir,open,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {transaction} from '../../packages/registration/src/transaction.ts';
import {RemoteConfigurationReconciler} from '../../packages/remote-access/src/reconciler.ts';
import {isUuid,verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {validateCsr} from '../../packages/remote-access/src/certificates.ts';
import {loadRuntime} from '../local-stack/runtime.mjs';
import {claimLease} from '../local-stack/lease.mjs';

const execute=promisify(execFile),suffix='r.waitron.local';
async function privateFile(path){if(((await stat(path)).mode&0o777)!==0o600)throw Error('test_cloud.remote_state_invalid');return readFile(path,'utf8');}
async function atomic(path,bytes){const temporary=path+'.'+randomUUID();try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await rename(temporary,path);}finally{await rm(temporary,{force:true});}}
function publicTarget(directory,id){if(!isUuid(id))throw Error('test_cloud.remote_target');return join(directory,'remote',id);}
async function publicRequest(pool,directory,id){
 const target=publicTarget(directory,id),hostname=(await pool.query("SELECT h.hostname FROM remote_placements p JOIN remote_hostnames h ON h.venue_id=p.venue_id AND h.kind='public' WHERE p.installation_id=$1",[id])).rows[0]?.hostname;
 if(!hostname||!hostname.endsWith('.'+suffix))throw Error('test_cloud.remote_target');
 const lease=await claimLease(join(directory,'remote','.'+id+'.lock'));if(!lease)throw Error('test_cloud.remote_busy');
 const scratch=target+'.'+randomUUID();
 try{
  try{
   await stat(target);const csr=await privateFile(join(target,'request.pem')),key=await privateFile(join(target,'key.pem'));validateCsr(csr,hostname);
   const output=await execute('openssl',['req','-in',join(target,'request.pem'),'-pubkey','-noout'],{timeout:5000});
   if(!createPublicKey(createPrivateKey(key)).equals(createPublicKey(output.stdout)))throw Error('test_cloud.remote_state_invalid');return csr;
  }catch(error){if(error.code!=='ENOENT')throw error;try{await stat(target);throw Error('test_cloud.remote_state_invalid');}catch(found){if(found.code!=='ENOENT')throw found;}}
  await mkdir(scratch,{mode:0o700});
  await execute('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'request.pem'),'-subj','/CN='+hostname,'-addext','subjectAltName=DNS:'+hostname],{timeout:30000});
  const csr=await readFile(join(scratch,'request.pem'),'utf8');validateCsr(csr,hostname);
  // OpenSSL uses the caller's umask for the public CSR; both artifacts are private state.
  const {chmod}=await import('node:fs/promises');for(const name of ['key.pem','request.pem'])await chmod(join(scratch,name),0o600);
  await lease.assertOwned();await rename(scratch,target);return csr;
 }finally{await rm(scratch,{recursive:true,force:true});await lease.release();}
}
export async function issueTestRemoteCertificate(directory,target){
 target.signal.throwIfAborted();validateCsr(target.csr,target.hostname);
 if(!target.hostname.endsWith('.'+suffix))throw Error('test_cloud.remote_target');
 const scratch=join(directory,'remote','.sign-'+randomUUID());await mkdir(scratch,{mode:0o700});
 try{
  await writeFile(join(scratch,'request.pem'),target.csr,{mode:0o600});
  await writeFile(join(scratch,'extensions'),'subjectAltName=DNS:'+target.hostname+'\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{mode:0o600});
  await execute('openssl',['x509','-req','-in',join(scratch,'request.pem'),'-CA',join(directory,'lan/ca.pem'),'-CAkey',join(directory,'lan/ca-key.pem'),'-set_serial','0x'+randomUUID().replaceAll('-',''),'-out',join(scratch,'certificate.pem'),'-days','30','-extfile',join(scratch,'extensions')],{timeout:30000,signal:target.signal});
  target.signal.throwIfAborted();return await readFile(join(scratch,'certificate.pem'),'utf8')+await privateFile(join(directory,'lan/ca.pem'));
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function openTestRemoteRuntime({pool,directory,mode}){
 if(!['existing','test-free-paid','test-venue-levels'].includes(mode))throw Error('test_cloud.plan_mode');
 const config=await loadRuntime(directory),cellId=config.gateway.cellId;
 const key=createPrivateKey(await privateFile(join(directory,'gateway-signing-key.pem'))),trust=createPublicKey(await privateFile(join(directory,'gateway-issuer.pem')));
 if(!createPublicKey(key).equals(trust))throw Error('test_cloud.remote_state_invalid');
 const wireguard=Buffer.from((await privateFile(join(directory,'gateway-wireguard.key'))).trim(),'base64');if(wireguard.length!==32)throw Error('test_cloud.remote_state_invalid');
 const publicKey=createPublicKey(createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),wireguard]),format:'der',type:'pkcs8'})).export({format:'der',type:'spki'}).subarray(-32).toString('base64');
 // Recover only the sequence of an expired signed file; routes still come from current policy.
 const envelope=JSON.parse(await privateFile(join(directory,'gateway-manifest.json'))),issued=JSON.parse(Buffer.from(envelope.payload,'base64url')).issuedAt,manifest=verifyManifest(envelope,trust,cellId,issued);
 await transaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('test_cloud_remote_cell'))");
  await client.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint,sequence) VALUES($1,'ES','aws','test',$2,61,$3,'waitron.local:51820',$4) ON CONFLICT(id) DO NOTHING",[cellId,suffix,publicKey,manifest.sequence]);
  const row=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR UPDATE',[cellId])).rows[0];
  if(row.country!=='ES'||row.provider!=='aws'||row.environment!=='test'||row.suffix!==suffix||row.subnet!==61||row.public_key!==publicKey||row.endpoint!=='waitron.local:51820')throw Error('test_cloud.remote_cell_conflict');
  // File publication can survive a rolled-back completion; never reuse its signed sequence.
  await client.query('UPDATE remote_cells SET sequence=GREATEST(sequence,$2) WHERE id=$1',[cellId,manifest.sequence]);
 });
 await mkdir(join(directory,'remote'),{recursive:true,mode:0o700});
 const artifacts={
  readCsr:async(id,kind)=>{if(kind!=='public')throw Error('test_cloud.remote_target');return publicRequest(pool,directory,id);},
  async readCertificate(id,kind){if(kind!=='public')throw Error('test_cloud.remote_target');try{return await privateFile(join(publicTarget(directory,id),'certificate.pem'));}catch(error){if(error.code!=='ENOENT')throw error;}},
  async publishCertificate(id,kind,chain){if(kind!=='public')throw Error('test_cloud.remote_target');const target=publicTarget(directory,id);await atomic(join(directory,'public-certs',id+'.pem'),await privateFile(join(target,'key.pem'))+chain);await atomic(join(target,'certificate.pem'),chain);},
  async publishManifest(id,text){if(id!==cellId)throw Error('test_cloud.remote_target');await atomic(join(directory,'gateway-manifest.json'),text);}
 };
 const worker=new RemoteConfigurationReconciler(pool,{planMode:mode,staffExchange:true,artifacts,signingKeyForCell:async id=>{if(id!==cellId)throw Error('test_cloud.remote_target');return key;},issueCertificate:target=>issueTestRemoteCertificate(directory,target)});
 return {worker,cellId};
}
