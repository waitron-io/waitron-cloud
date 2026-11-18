import {resolveCname} from 'node:dns/promises';
import {Client,crypto as acmeCrypto,type Authorization} from 'acme-client';
import forge from 'node-forge';
import {isHostname} from './manifest.ts';
export function validateCsr(pem:string,hostname:string):void {
 try{
  if(!isHostname(hostname)||pem.length>4096||(pem.match(/-----BEGIN CERTIFICATE REQUEST-----/g)??[]).length!==1||(pem.match(/-----END CERTIFICATE REQUEST-----/g)??[]).length!==1)throw Error();
  const csr=forge.pki.certificationRequestFromPem(pem);if(!csr.verify())throw Error();
  const domains=acmeCrypto.readCsrDomains(pem);if(domains.commonName!==hostname||domains.altNames.length!==1||domains.altNames[0]!==hostname)throw Error();
  const key=csr.publicKey as forge.pki.rsa.PublicKey;if(!key.n||key.n.bitLength()<2048)throw Error();
  const attribute=csr.getAttribute({name:'extensionRequest'});const extensions=attribute?.extensions as {name:string;altNames?:{type:number;value?:string}[]}[]|undefined;
  const sans=extensions?.find(e=>e.name==='subjectAltName')?.altNames;if(!sans||sans.length!==1||sans[0]!.type!==2||sans[0]!.value!==hostname)throw Error();
 }catch{throw new Error('invalid_csr');}
}
export function dnsInstructions(custom:string,assigned:string){
 // The DNS-01 label adds 16 characters to both names in the certificate CNAME.
 if(!isHostname(custom)||custom.length>237||!isHostname(assigned)||assigned.length>237||custom===assigned)throw new Error('invalid_hostname');
 return [{type:'CNAME',name:custom,value:assigned},{type:'CNAME',name:`_acme-challenge.${custom}`,value:`_acme-challenge.${assigned}`}];
}
export function matchesCname(answers:string[],target:string){
 return answers.length===1&&answers[0]!.replace(/\.$/,'').toLowerCase()===target;
}
export async function verifyDelegation(custom:string,assigned:string,resolve:typeof resolveCname=resolveCname){
 try{for(const record of dnsInstructions(custom,assigned)){const values=await resolve(record.name);if(!matchesCname(values,record.value))throw Error();}}
 catch{throw new Error('dns_not_verified');}
}
export interface DnsChallengeProvider {present:(name:string,value:string,signal?:AbortSignal)=>Promise<void>;remove:(name:string,value:string,signal?:AbortSignal)=>Promise<void>;point:(name:string,target:string,signal?:AbortSignal)=>Promise<void>}
export type CertificateValidation =
 | {type:'dns-01';dnsName:string;dns:Pick<DnsChallengeProvider,'present'|'remove'>}
 | {type:'tls-alpn-01';present:(entry:{hostname:string;certificate:string;key:string},signal?:AbortSignal)=>Promise<void>;withdraw:(hostname:string)=>Promise<void>};

export function challengeHandlers({hostname,validation,signal}:{hostname:string;validation:CertificateValidation;signal?:AbortSignal}){
 function check(authorization:Authorization,challenge:{type:string}){
  if(authorization.identifier.type!=='dns'||authorization.identifier.value!==hostname||challenge.type!==validation.type)throw new Error('unexpected_challenge');
 }
 return {
  async challengeCreateFn(authorization:Authorization,challenge:{type:string},value:string){
   signal?.throwIfAborted();check(authorization,challenge);
   if(validation.type==='dns-01')await validation.dns.present(validation.dnsName,value,signal);
   else{
    const key=await acmeCrypto.createPrivateEcdsaKey('P-256');
    const [,certificate]=await acmeCrypto.createAlpnCertificate(authorization,value,key);
    signal?.throwIfAborted();
    await validation.present({hostname,certificate:certificate.toString(),key:key.toString()},signal);
   }
   signal?.throwIfAborted();
  },
  async challengeRemoveFn(authorization:Authorization,challenge:{type:string},value:string){
   check(authorization,challenge);
   if(validation.type==='dns-01')await validation.dns.remove(validation.dnsName,value);
   else await validation.withdraw(hostname);
  },
 };
}

export async function issueCertificate(options:{directoryUrl:string;accountKey:Buffer;email:string;hostname:string;csr:string;validation:CertificateValidation;signal?:AbortSignal}):Promise<string>{
 const {validation,signal}=options;
 signal?.throwIfAborted();
 validateCsr(options.csr,options.hostname);
 if(validation.type==='dns-01'&&(!validation.dnsName.startsWith('_acme-challenge.')||!isHostname(validation.dnsName.slice('_acme-challenge.'.length))))throw new Error('invalid_dns_name');
 const directory=new URL(options.directoryUrl);if(directory.protocol!=='https:'||directory.username||directory.password)throw new Error('invalid_acme_directory');
 const client=new Client({directoryUrl:options.directoryUrl,accountKey:options.accountKey,backoffAttempts:5,backoffMin:500,backoffMax:3000});
 const certificate=await client.auto({csr:options.csr,email:options.email,termsOfServiceAgreed:true,challengePriority:[validation.type],
  // The ACME server validates against its own resolver and ingress.
  skipChallengeVerification:true,...challengeHandlers(options),
 });
 signal?.throwIfAborted();return certificate;
}
