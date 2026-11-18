import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Resolver} from 'node:dns/promises';
import {join} from 'node:path';
import {X509Certificate,createPrivateKey,createPublicKey} from 'node:crypto';
import {createRequire} from 'node:module';
import {startAcme} from './remote-fixtures.mjs';
const require=createRequire(new URL('../packages/remote-access/package.json',import.meta.url));const {crypto}=require('acme-client');
const f=await startAcme();try{
 const custom='staff.synthetic-cafe.example.test',assigned='staff.venue.example.test';
 const resolver=new Resolver({timeout:1000,tries:1});resolver.setServers([f.dnsServer]);
 await f.point(custom,assigned);
 await f.setA(assigned,'192.0.2.2');
 assert.deepEqual(await resolver.resolve4(custom),['192.0.2.2']);
 await f.setA(assigned,'192.0.2.3');
 assert.deepEqual(await resolver.resolve4(custom),['192.0.2.3']);
 console.log('PASS: the custom alias resolves only to the current cell address');
 const accountKeyFile=join(f.root,'account.pem');await writeFile(accountKeyFile,await crypto.createPrivateKey(),{mode:0o600});
 const hostname='staff.sol.example.test',[key,csr]=await crypto.createCsr({commonName:hostname,altNames:[hostname]});const csrFile=join(f.root,'staff.csr'),output=join(f.root,'staff.pem');await writeFile(csrFile,csr);
 const certificate=await f.issue({hostname,csrFile,accountKeyFile,output});const first=new X509Certificate(certificate);assert.equal(first.checkHost(hostname),hostname);assert.ok(first.publicKey.equals(createPublicKey(createPrivateKey(key))));
 const renewed=new X509Certificate(await f.issue({hostname,csrFile,accountKeyFile,output}));assert.notEqual(renewed.serialNumber,first.serialNumber);
 const missing='unproved.example.test',[,bad]=await crypto.createCsr({commonName:missing,altNames:[missing]});await writeFile(csrFile,bad);
 await assert.rejects(f.issue({hostname:missing,csrFile,accountKeyFile,output,omitDns:true}),/certificate_issuance_failed/);
 console.log('PASS: real DNS-01 issuance, same venue key, renewed serial and missing-DNS refusal');
}finally{await f.close();}
