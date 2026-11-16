import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('worker build timeout prints progress and service evidence before the original hook failure summary',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'worker-build-failure-')),calls=join(directory,'calls'),pids=join(directory,'pids');
 await writeFile(join(directory,'docker'),`#!${process.execPath}
import fs from 'node:fs';const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');fs.appendFileSync(${JSON.stringify(pids)},process.pid+'\\n');
if(args[0]==='build'){process.stderr.write('#7 resolve node:26 registry-tail-marker');setInterval(()=>{},1000);}
else if(args[0]==='info'){process.stderr.write('PRIVATE_PROBE_ERROR');process.exit(9);}
`,{mode:0o700});
 const preload=join(directory,'timeout.mjs');
 await writeFile(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import assert from 'node:assert/strict';const real=cp.execFileSync;cp.execFileSync=(cmd,args,options)=>{if(cmd!=='docker')throw Error('unexpected probe');if(args[0]==='build'){assert.equal(options.timeout,120000);assert.equal(options.maxBuffer,8*1024*1024);return real(cmd,args,{...options,timeout:1000});}return real(cmd,args,options);};syncBuiltinESMExports();`);
 try{
  const env:NodeJS.ProcessEnv={...process.env,PATH:directory+':'+process.env.PATH};delete env.NODE_TEST_CONTEXT;delete env.GITHUB_ACTIONS;delete env.RUNNER_ENVIRONMENT;
  const root=fileURLToPath(new URL('../../../',import.meta.url)),child=spawn(process.execPath,['--import',preload,'--test','--test-reporter=tap','--test-reporter-destination=stdout','--test-reporter=../../scripts/ci-required-cases.mjs','--test-reporter-destination=stdout','--test-name-pattern=^database worker survives resource failures, preserves venue identity and verifies later work$','test/container-worker.test.ts'],{cwd:join(root,'packages/backups'),env,timeout:10000});
  let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output+=bytes;});
  const status=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(status,1,output);
  const line=output.split('\n').find(line=>line.includes('docker_build_failure='));assert(line,'missing immediate build report: '+output);
  const report=JSON.parse(line.slice(line.indexOf('docker_build_failure=')+'docker_build_failure='.length).replaceAll('\\#','#'));
  assert.deepEqual(report.command.slice(0,3),['docker','build','--progress=plain']);assert(!report.command.includes('-q'));
  assert.match(report.command[report.command.indexOf('-t')+1],/^cloud-verifier-test:worker-/);assert.equal(report.command.at(-1),root);
  assert.equal(report.code,'ETIMEDOUT');assert.equal(report.signal,'SIGTERM');assert.match(report.stderrTail,/registry-tail-marker/);
  assert(output.indexOf('docker_build_failure=')<output.indexOf('docker_stall='));assert(output.indexOf('docker_stall=')<output.indexOf('# tests '));
  assert.match(output,/hookFailed/);assert.match(output,/ETIMEDOUT/);assert.match(output,/"operation":"build"/);assert.match(output,/"status":"exit-error"/);
  assert.doesNotMatch(output,/PRIVATE_PROBE_ERROR/);
  const invocations=(await readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as string[]);
  assert.equal(invocations.filter(args=>args[0]==='build').length,1);
  for(const pid of (await readFile(pids,'utf8')).trim().split('\n').map(Number))assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
