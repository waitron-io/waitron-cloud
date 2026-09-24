import assert from 'node:assert/strict';
import {test} from 'node:test';
import forge from 'node-forge';
import {certificateNeedsRenewal} from '../src/renewal.ts';
test('renewal checks hostname, CSR key and the last third or thirty days of certificate life',()=>{
 const keys=forge.pki.rsa.generateKeyPair(2048),csr=forge.pki.createCertificationRequest();csr.publicKey=keys.publicKey;csr.setSubject([{name:'commonName',value:'staff.example.test'}]);csr.sign(keys.privateKey);
 const cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='01';cert.setSubject([{name:'commonName',value:'staff.example.test'}]);cert.setIssuer(cert.subject.attributes);cert.validity.notBefore=new Date('2026-01-01');cert.validity.notAfter=new Date('2026-04-01');cert.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:'staff.example.test'}]}]);cert.sign(keys.privateKey);
 const pem=forge.pki.certificateToPem(cert),request=forge.pki.certificationRequestToPem(csr);
 assert.equal(certificateNeedsRenewal(pem,request,'staff.example.test',Date.parse('2026-01-10')),false);
 assert.equal(certificateNeedsRenewal(pem,request,'staff.example.test',Date.parse('2026-03-10')),true);
 assert.equal(certificateNeedsRenewal(pem,request,'other.example.test',Date.parse('2026-01-10')),true);
 assert.equal(certificateNeedsRenewal('broken',request,'staff.example.test'),true);
 const other=forge.pki.rsa.generateKeyPair(2048);csr.publicKey=other.publicKey;csr.sign(other.privateKey);
 assert.equal(certificateNeedsRenewal(pem,forge.pki.certificationRequestToPem(csr),'staff.example.test',Date.parse('2026-01-10')),true);
});
