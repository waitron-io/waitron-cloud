import {execFile} from 'node:child_process';
import {createHash,randomUUID,X509Certificate,createPrivateKey,createPublicKey} from 'node:crypto';
import {chmod,mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {bootstrap} from '../local-stack/bootstrap.mjs';
import {claimLease} from '../local-stack/lease.mjs';
const execute=promisify(execFile),names=['ca.pem','ca-key.pem','cert.pem','key.pem','proxy.pem','identity.json'];
const digest=value=>createHash('sha256').update(value).digest('hex');
async function existing(directory){
 try{await stat(directory);}catch(e){if(e.code==='ENOENT')return;throw e;}
 try{
  if(((await stat(directory)).mode&0o777)!==0o700)throw Error();
  const bytes={};for(const name of names){if(((await stat(join(directory,name))).mode&0o777)!==0o600)throw Error();bytes[name]=await readFile(join(directory,name));}
  const value=JSON.parse(bytes['identity.json']);const ca=new X509Certificate(bytes['ca.pem']),leaf=new X509Certificate(bytes['cert.pem']);
  if(value.version!==1||value.origin!=='https://waitron.local:3000'||value.caSha256!==digest(bytes['ca.pem'])||value.certificateSha256!==digest(bytes['cert.pem'])||!ca.ca||leaf.ca||!leaf.verify(ca.publicKey)||!ca.verify(ca.publicKey)||!leaf.checkHost('waitron.local')||!leaf.checkIP('192.168.10.10')||Date.parse(leaf.validTo)<=Date.now()||Date.parse(ca.validTo)<=Date.now())throw Error();
  for(const [cert,key] of [[ca,'ca-key.pem'],[leaf,'key.pem']])if(!cert.publicKey.equals(createPublicKey(createPrivateKey(bytes[key]))))throw Error();
  if(!bytes['proxy.pem'].equals(Buffer.concat([bytes['key.pem'],bytes['cert.pem']])))throw Error();
  return value;
 }catch{throw new Error('test_cloud.identity_invalid');}
}
export async function bootstrapTestCloud(directory){
 await bootstrap(directory);
 const target=join(directory,'lan');const found=await existing(target);if(found)return found;
 let lease;for(let n=0;n<400&&!lease;n++){lease=await claimLease(join(directory,'.lan-bootstrap.lock'));if(!lease)await new Promise(r=>setTimeout(r,25));}if(!lease)throw new Error('test_cloud.bootstrap_busy');
 const scratch=join(directory,'.lan-'+randomUUID());
 try{
  const after=await existing(target);if(after)return after;
  await mkdir(scratch,{mode:0o700});
  await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(scratch,'ca-key.pem'),'-out',join(scratch,'ca.pem'),'-days','365','-subj','/CN=Waitron Cloud LAN test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'],{timeout:30000});
  await execute('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'leaf.csr'),'-subj','/CN=waitron.local'],{timeout:30000});
  await writeFile(join(scratch,'leaf.ext'),'subjectAltName=DNS:waitron.local,IP:192.168.10.10\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{mode:0o600});
  await execute('openssl',['x509','-req','-in',join(scratch,'leaf.csr'),'-CA',join(scratch,'ca.pem'),'-CAkey',join(scratch,'ca-key.pem'),'-set_serial','0x'+randomUUID().replaceAll('-',''),'-out',join(scratch,'cert.pem'),'-days','30','-extfile',join(scratch,'leaf.ext')],{timeout:30000});
  const ca=await readFile(join(scratch,'ca.pem')),cert=await readFile(join(scratch,'cert.pem')),key=await readFile(join(scratch,'key.pem'));
  const value={version:1,origin:'https://waitron.local:3000',caSha256:digest(ca),certificateSha256:digest(cert)};
  await writeFile(join(scratch,'proxy.pem'),Buffer.concat([key,cert]),{mode:0o600});await writeFile(join(scratch,'identity.json'),JSON.stringify(value),{mode:0o600});
  await rm(join(scratch,'leaf.csr'));await rm(join(scratch,'leaf.ext'));
  for(const name of names)await chmod(join(scratch,name),0o600);
  await lease.assertOwned();await rename(scratch,target);return await existing(target);
 }finally{await rm(scratch,{recursive:true,force:true});await lease.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await bootstrapTestCloud(process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack');console.log('{"status":"ready"}');}
 catch{console.error('Test Cloud bootstrap failed; inspect its private volume');process.exitCode=1;}
}
