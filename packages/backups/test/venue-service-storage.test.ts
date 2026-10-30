import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Package discovery must execute the real database/provider boundary rather than leave a detached fixture.
test('venue storage boundary runs through the discovered package suite',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),env={...process.env};delete env.NODE_TEST_CONTEXT;
 try{
  const result=await exec(process.execPath,['--test','--test-reporter=tap','--test-timeout=120000','deploy/test-cloud/venue-service-storage.test.mjs'],{cwd:root,env,timeout:170000,maxBuffer:4*1024*1024});
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  assert.match(result.stdout,/# pass 10\b/);assert.match(result.stdout,/# fail 0\b/);assert.match(result.stdout,/# skipped 0\b/);
 }catch(error){const failure=error as Error&{stdout?:string;stderr?:string};process.stdout.write(failure.stdout??'');process.stderr.write(failure.stderr??'');throw error;}
});
