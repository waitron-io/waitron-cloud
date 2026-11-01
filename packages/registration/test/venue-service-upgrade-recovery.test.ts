import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// The v7 proof belongs to the delivered 45-to-46 tree; later schemas need their own proof.
test('venue service exact head upgrade and recovery is qualified',{timeout:360000},async()=>{
 const root=new URL('../../../',import.meta.url).pathname,pin='9a75808dd17a86f2dc1e9b87614be4e55e81deb2';
 const scratch=await mkdtemp(join(tmpdir(),'venue-service-historical-'));
 try{
  await exec('git',['archive','--output='+join(scratch,'release.tar'),pin],{cwd:root});
  await exec('tar',['-xf',join(scratch,'release.tar'),'-C',scratch]);await rm(join(scratch,'release.tar'));
  await exec('git',['init','-q'],{cwd:scratch});
  // The proof requires the actual signed commit identity and a clean tracked driver.
  await exec('git',['fetch','--quiet',root,pin],{cwd:scratch});await exec('git',['reset','--hard',pin],{cwd:scratch});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:scratch,timeout:120000,maxBuffer:4*1024*1024});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=await exec(process.execPath,['--test','--test-reporter=tap','test/venue-service-upgrade-recovery.test.ts'],{cwd:join(scratch,'packages/registration'),env,timeout:330000,maxBuffer:8*1024*1024});
  const line=result.stdout.split('\n').find(line=>line.startsWith('# VENUE_SERVICE_UPGRADE_RECEIPT '));assert.ok(line,'the original historical proof must execute');
  const receipt=JSON.parse(line.slice('# VENUE_SERVICE_UPGRADE_RECEIPT '.length));
  assert.equal(receipt.schemaVersion,7);assert.equal(receipt.driver.head,pin);assert.equal(receipt.releases.old.head,'b338275c3ba4e2b211d7617b03d38e95b916ee7c');assert.equal(receipt.releases.new.head,pin);
  assert.equal(receipt.releases.old.migrations,45);assert.equal(receipt.releases.new.migrations,46);
  console.log('VENUE_SERVICE_UPGRADE_RECEIPT '+JSON.stringify(receipt));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
