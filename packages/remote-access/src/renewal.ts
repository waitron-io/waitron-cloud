import {X509Certificate,createPublicKey} from 'node:crypto';
import forge from 'node-forge';
export function certificateNeedsRenewal(chain:string,csr:string,hostname:string,now=Date.now()):boolean {
 try{
  const cert=new X509Certificate(chain),request=forge.pki.certificationRequestFromPem(csr);
  if(!request.publicKey)return true;
  const key=createPublicKey(forge.pki.publicKeyToPem(request.publicKey)).export({type:'spki',format:'der'});
  const from=Date.parse(cert.validFrom),until=Date.parse(cert.validTo),window=Math.min(30*86400000,(until-from)/3);
  return cert.checkHost(hostname)!==hostname||!cert.publicKey.export({type:'spki',format:'der'}).equals(key)||from>now||until-now<=window;
 }catch{return true;}
}
