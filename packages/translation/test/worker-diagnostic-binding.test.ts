import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);

test('the proof diagnostic selector executes the real disconnect case',async()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const title='disconnected database clients exit with one fixed line and no raw error';
 const {stdout,stderr}=await exec(process.execPath,['--test','--test-reporter=tap',
  '--test-name-pattern=^'+title+'$',fileURLToPath(new URL('./worker-cli.test.ts',import.meta.url))],
 {cwd:fileURLToPath(new URL('../',import.meta.url)),env,encoding:'utf8',timeout:25000,maxBuffer:1048576});
 assert.equal(stderr,'');
 assert.match(stdout,new RegExp('^# Subtest: '+title+'$','m'));
 assert.match(stdout,/^# tests 1$/m);assert.match(stdout,/^# pass 1$/m);
});
