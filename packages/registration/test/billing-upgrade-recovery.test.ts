import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// The v6 proof belongs to the delivered 44-to-45 tree; newer schemas need their own proof.
test('billing exact-head upgrade and recovery receipt is qualified',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,pin='3d3c3def00bf27d60f2d97f5c23cd4acc1aebf7d';
 const scratch=await mkdtemp(join(tmpdir(),'billing-historical-'));
 try{
  await exec('git',['archive','--output='+join(scratch,'release.tar'),pin],{cwd:root});
  await exec('tar',['-xf',join(scratch,'release.tar'),'-C',scratch]);await rm(join(scratch,'release.tar'));
  await exec('git',['init','-q'],{cwd:scratch});
  // The proof requires the actual signed commit identity and a clean tracked driver.
  await exec('git',['fetch','--quiet',root,pin],{cwd:scratch});await exec('git',['reset','--hard',pin],{cwd:scratch});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:scratch,timeout:120000,maxBuffer:4*1024*1024});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=await exec(process.execPath,['--test','--test-reporter=tap','test/billing-upgrade-recovery.test.ts'],{cwd:join(scratch,'packages/registration'),env,timeout:330000,maxBuffer:8*1024*1024});
  const line=result.stdout.split('\n').find(line=>line.startsWith('# BILLING_UPGRADE_RECEIPT '));assert.ok(line,'the original historical proof must execute');
  const receipt=JSON.parse(line.slice('# BILLING_UPGRADE_RECEIPT '.length));
  assert.equal(receipt.schemaVersion,6);assert.equal(receipt.driver.head,pin);assert.equal(receipt.releases.old.head,'1a3e43e885edfbe9932c835e3f4fb8929718b2dc');assert.equal(receipt.releases.new.head,pin);
  assert.equal(receipt.releases.old.migrations,44);assert.equal(receipt.releases.new.migrations,45);
  console.log('BILLING_UPGRADE_RECEIPT '+JSON.stringify(receipt));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
