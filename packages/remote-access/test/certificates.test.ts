import assert from 'node:assert/strict';
import {test} from 'node:test';
import {crypto} from 'acme-client';
import {validateCsr,dnsInstructions,verifyDelegation} from '../src/certificates.ts';
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
