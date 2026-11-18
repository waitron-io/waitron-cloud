import assert from 'node:assert/strict';
import {createPrivateKey,randomUUID,X509Certificate} from 'node:crypto';
import {chmod,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {crypto} from 'acme-client';
import * as certificates from '../src/certificates.ts';
const {validateCsr,dnsInstructions,verifyDelegation}=certificates;
import {FileReconcilerArtifacts} from '../src/reconciler-files.ts';
test('certificate signing accepts only a valid signature for the exact authorised DNS name',async()=>{
 const [,csr]=await crypto.createCsr({commonName:'staff.sol.example.test',altNames:['staff.sol.example.test']});
 assert.doesNotThrow(()=>validateCsr(csr.toString(),'staff.sol.example.test'));
 await assert.rejects(async()=>validateCsr(csr.toString(),'staff.luna.example.test'),/invalid_csr/);
 const [,extra]=await crypto.createCsr({commonName:'staff.sol.example.test',altNames:['staff.sol.example.test','staff.luna.example.test']});
 assert.throws(()=>validateCsr(extra.toString(),'staff.sol.example.test'),/invalid_csr/);
 assert.throws(()=>validateCsr(csr.toString()+csr.toString(),'staff.sol.example.test'),/invalid_csr/);
 assert.throws(()=>validateCsr(csr.toString(),'*.example.test'),/invalid_csr/);
 const lines=csr.toString().split('\n');lines[3]=lines[3]!.replace(/^./,lines[3]![0]==='A'?'B':'A');assert.throws(()=>validateCsr(lines.join('\n'),'staff.sol.example.test'),/invalid_csr/);
});
test('a custom hostname needs one routing CNAME to the bound assigned name',async()=>{
 const custom='staff.cafe.example',assigned='staff.sol.example.test',lookups:string[]=[];
 assert.deepEqual(dnsInstructions(custom,assigned),[{type:'CNAME',name:custom,value:assigned}]);
 await verifyDelegation(custom,assigned,async name=>{lookups.push(name);return ['STAFF.SOL.EXAMPLE.TEST.'];});
 assert.deepEqual(lookups,[custom]);
 for(const answers of [[],['foreign.example.test'],[assigned,assigned]])
  await assert.rejects(verifyDelegation(custom,assigned,async()=>answers),/dns_not_verified/);
 assert.throws(()=>dnsInstructions('127.0.0.1',assigned),/invalid_hostname/);
});
test('TLS-ALPN presents an ephemeral key and certificate only for the ordered name',async()=>{
 const hostname='staff.cafe.example.test',value='synthetic-token.synthetic-thumbprint';
 const authorization={identifier:{type:'dns',value:hostname},url:'https://acme.example.test/authz',status:'pending' as const,challenges:[]};
 const challenge={type:'tls-alpn-01',url:'https://acme.example.test/challenge',status:'pending' as const,token:'synthetic-token'};
 const presentations:{hostname:string;certificate:string;key:string}[]=[],withdrawals:string[]=[];
 assert.equal(typeof certificates.challengeHandlers,'function');
 const handlers=certificates.challengeHandlers({hostname,validation:{type:'tls-alpn-01',
  async present(entry){presentations.push(entry);},async withdraw(name){withdrawals.push(name);}}});
 await assert.rejects(handlers.challengeCreateFn({...authorization,identifier:{type:'dns',value:'other.example.test'}},challenge,value),/unexpected_challenge/);
 await assert.rejects(handlers.challengeCreateFn(authorization,{...challenge,type:'dns-01'},value),/unexpected_challenge/);
 assert.equal(presentations.length,0);
 await handlers.challengeCreateFn(authorization,challenge,value);
 assert.equal(presentations.length,1);
 const [entry]=presentations;
 assert.equal(entry!.hostname,hostname);
 const key=createPrivateKey(entry!.key),certificate=new X509Certificate(entry!.certificate);
 assert.equal(key.asymmetricKeyDetails?.namedCurve,'prime256v1');
 assert.equal(certificate.subjectAltName,'DNS:'+hostname);
 assert.ok(certificate.checkPrivateKey(key));
 assert.ok(crypto.isAlpnCertificateAuthorizationValid(entry!.certificate,value));
 await handlers.challengeRemoveFn(authorization,challenge,value);
 assert.deepEqual(withdrawals,[hostname]);
});
test('artifact mappings retain issued private material and old gateway bytes on a delivery failure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-reconciler-files-')),blocked=join(root,'blocked'),installationId=randomUUID(),cellId=randomUUID();
 try{
  await mkdir(blocked);const csrFile=join(root,installationId+'.public.csr'),certificateFile=join(root,installationId+'.public.pem'),manifestFile=join(blocked,'manifest.json');
  await writeFile(csrFile,'csr',{mode:0o600});await writeFile(certificateFile,'old certificate',{mode:0o600});
  const artifacts=new FileReconcilerArtifacts({keyDirectory:root,routes:[{cellId,output:manifestFile,publicCertificates:blocked}]});
  const venueId='00000000-0000-0000-0000-000000000001';
  assert.deepEqual(await artifacts.readPublicCertificate(installationId),{csr:'csr',pem:'old certificate'});
  await artifacts.publishPublicCertificate(installationId,venueId,[cellId],{csr:'csr',pem:'new certificate'});await artifacts.publishManifest(cellId,'signed manifest');
  assert.equal(await readFile(certificateFile,'utf8'),'new certificate');assert.equal(await readFile(manifestFile,'utf8'),'signed manifest');
  await chmod(blocked,0o500);assert.deepEqual(await artifacts.publishPublicCertificate(installationId,venueId,[cellId],{csr:'csr',pem:'issued replacement'}),{copied:[],complete:false});await chmod(blocked,0o700);
  assert.equal(await readFile(certificateFile,'utf8'),'issued replacement');assert.equal(await readFile(join(blocked,venueId+'.pem'),'utf8'),'new certificate');
  await chmod(blocked,0o500);await assert.rejects(artifacts.publishManifest(cellId,'must not replace'));await chmod(blocked,0o700);assert.equal(await readFile(manifestFile,'utf8'),'signed manifest');
  assert.equal(await artifacts.readPublicCertificate(randomUUID()),undefined);
  assert.throws(()=>new FileReconcilerArtifacts({keyDirectory:'relative',routes:[]}),/invalid_reconciler_files/);
 }finally{await chmod(blocked,0o700).catch(()=>{});await rm(root,{recursive:true,force:true});}
});
