import {resolveCname} from 'node:dns/promises';
import {Client,crypto as acmeCrypto} from 'acme-client';
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
 if(!isHostname(custom)||!isHostname(assigned)||custom===assigned)throw new Error('invalid_hostname');
 return [{type:'CNAME',name:custom,value:assigned},{type:'CNAME',name:`_acme-challenge.${custom}`,value:`_acme-challenge.${assigned}`}];
}
export async function verifyDelegation(custom:string,assigned:string,resolve:typeof resolveCname=resolveCname){
 try{for(const record of dnsInstructions(custom,assigned)){const values=await resolve(record.name);if(values.length!==1||values[0]!.replace(/\.$/,'').toLowerCase()!==record.value)throw Error();}}
 catch{throw new Error('dns_not_verified');}
}
export interface DnsChallengeProvider {present:(name:string,value:string)=>Promise<void>;remove:(name:string,value:string)=>Promise<void>}
export async function issueCertificate(options:{directoryUrl:string;accountKey:Buffer;email:string;hostname:string;csr:string;dnsName:string;dns:DnsChallengeProvider}):Promise<string>{
 validateCsr(options.csr,options.hostname);
 if(!options.dnsName.startsWith('_acme-challenge.')||!isHostname(options.dnsName.slice('_acme-challenge.'.length)))throw new Error('invalid_dns_name');
 const directory=new URL(options.directoryUrl);if(directory.protocol!=='https:'||directory.username||directory.password)throw new Error('invalid_acme_directory');
 const client=new Client({directoryUrl:options.directoryUrl,accountKey:options.accountKey,backoffAttempts:5,backoffMin:500,backoffMax:3000});
 return client.auto({csr:options.csr,email:options.email,termsOfServiceAgreed:true,challengePriority:['dns-01'],
  // The ACME server performs DNS validation. Local Pebble uses its isolated resolver.
  skipChallengeVerification:true,
  challengeCreateFn:async(authz,challenge,value)=>{if(authz.identifier.value!==options.hostname||challenge.type!=='dns-01')throw new Error('unexpected_challenge');await options.dns.present(options.dnsName,value);},
  challengeRemoveFn:async(authz,challenge,value)=>{if(authz.identifier.value!==options.hostname||challenge.type!=='dns-01')throw new Error('unexpected_challenge');await options.dns.remove(options.dnsName,value);},
 });
}
