import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// This wrapper catches a proof that never executes, qualifies another head or leaves owned resources.
test('billing exact-head upgrade and recovery receipt is qualified',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname;
 const scratch=await mkdtemp(join(tmpdir(),'billing-receipt-')),output=join(scratch,'receipt.json');
 try{
  const head=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
  const old='1a3e43e885edfbe9932c835e3f4fb8929718b2dc';
  const result=await exec(process.execPath,['scripts/schema-upgrade-receipt.mjs',output,'--billing','--old',old,'--new',head],{cwd:root,timeout:330000,maxBuffer:4*1024*1024}).then(()=>({ok:true}),error=>({ok:false,code:error.code,diagnostic:(error.stderr??'').split('\n').filter((line:string)=>line.startsWith('{\"event\":\"schema-upgrade-failed\"')).join('\n')}));
  assert.deepEqual(result,{ok:true},'the actual 44-to-45 upgrade and two-backup recovery must execute');
  const {verifySchemaUpgradeReceipt}=await import(new URL('../../../scripts/verify-schema-upgrade-receipt.mjs',import.meta.url).href);
  const receipt=verifySchemaUpgradeReceipt(JSON.parse(await readFile(output,'utf8')));
  assert.equal(receipt.schemaVersion,6);assert.equal(receipt.driver.head,head);assert.equal(receipt.releases.old.head,old);assert.equal(receipt.releases.new.head,head);
  console.log('BILLING_UPGRADE_RECEIPT '+JSON.stringify(receipt));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
