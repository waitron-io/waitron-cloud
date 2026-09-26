import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chmod,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {crypto} from 'acme-client';
import {validateCsr,dnsInstructions,verifyDelegation} from '../src/certificates.ts';
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
test('custom hostnames require both routing and DNS-01 delegation to the bound assigned name',async()=>{
 const expected=dnsInstructions('staff.cafe.example','staff.sol.example.test');assert.deepEqual(expected,[{type:'CNAME',name:'staff.cafe.example',value:'staff.sol.example.test'},{type:'CNAME',name:'_acme-challenge.staff.cafe.example',value:'_acme-challenge.staff.sol.example.test'}]);
 await verifyDelegation('staff.cafe.example','staff.sol.example.test',async name=>[expected.find(r=>r.name===name)!.value]);
 await assert.rejects(verifyDelegation('staff.cafe.example','staff.sol.example.test',async()=>['foreign.example.test']),/dns_not_verified/);
 assert.throws(()=>dnsInstructions('127.0.0.1','staff.sol.example.test'),/invalid_hostname/);
});
test('explicit artifact mappings replace files atomically and retain old bytes on failure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-reconciler-files-')),blocked=join(root,'blocked'),installationId=randomUUID(),cellId=randomUUID();
 try{
  await mkdir(blocked);const csrFile=join(root,'staff.csr'),certificateFile=join(blocked,'staff.crt'),manifestFile=join(blocked,'manifest.json');
  await writeFile(csrFile,'csr',{mode:0o600});await writeFile(certificateFile,'old certificate',{mode:0o600});
  const artifacts=new FileReconcilerArtifacts({certificates:[{installationId,kind:'staff',csrFile,output:certificateFile}],routes:[{cellId,output:manifestFile}]});
  assert.equal(await artifacts.readCsr(installationId,'staff'),'csr');assert.equal(await artifacts.readCertificate(installationId,'staff'),'old certificate');
  await artifacts.publishCertificate(installationId,'staff','new certificate');await artifacts.publishManifest(cellId,'signed manifest');
  assert.equal(await readFile(certificateFile,'utf8'),'new certificate');assert.equal(await readFile(manifestFile,'utf8'),'signed manifest');
  await chmod(blocked,0o500);await assert.rejects(artifacts.publishCertificate(installationId,'staff','must not replace'));await chmod(blocked,0o700);
  assert.equal(await readFile(certificateFile,'utf8'),'new certificate');
  await chmod(blocked,0o500);await assert.rejects(artifacts.publishManifest(cellId,'must not replace'));await chmod(blocked,0o700);assert.equal(await readFile(manifestFile,'utf8'),'signed manifest');
  await assert.rejects(artifacts.readCsr(randomUUID(),'staff'),/certificate_mapping_missing/);
  assert.throws(()=>new FileReconcilerArtifacts({certificates:[{installationId,kind:'staff',csrFile:'relative',output:certificateFile}],routes:[]}),/invalid_reconciler_files/);
 }finally{await chmod(blocked,0o700).catch(()=>{});await rm(root,{recursive:true,force:true});}
});
