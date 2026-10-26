import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const suite=fileURLToPath(new URL('./bound-container-verifier.test.ts',import.meta.url));
async function fixture(mode:string,allCases=false){
 const directory=await mkdtemp(join(tmpdir(),'bound-build-failure-')),temp=join(directory,'tmp'),calls=join(directory,'calls');
 await mkdir(temp);
 // The executable replaces only Docker. The real suite, hooks and filesystem cleanup run unchanged.
 await writeFile(join(directory,'docker'),String.raw`#!${process.execPath}
import * as fs from 'node:fs';const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\n');
fs.appendFileSync(${JSON.stringify(join(directory,'pids'))},String(process.pid)+'\n');
if(args[0]==='build'){
 if(args.includes('--progress=plain')&&args.includes('-q')){process.stderr.write('progress=plain and quiet cannot be used together');process.exit(44);}
 if(${JSON.stringify(mode)}==='success-cleanup-fails'){const index=args.indexOf('--iidfile');if(index>=0)fs.writeFileSync(args[index+1],'sha256:'+'1'.repeat(64));else console.log('sha256:'+'1'.repeat(64));process.exit(0);}
 process.stderr.write((${JSON.stringify(mode)}==='tail'?'discarded-head-marker'+'x'.repeat(10000):'')+'\n#7 resolve node:26 registry stalled\nregistry-tail-marker\n');
 if(${JSON.stringify(mode)}==='timeout')setInterval(()=>{},1000);else process.exit(42);
}else{process.stderr.write('fixture cleanup refused');if(${JSON.stringify(mode)}==='cleanup-timeout')setInterval(()=>{},1000);else process.exit(43);}
`,{mode:0o700});
 const preload=join(directory,'timeout.mjs');
 await writeFile(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import assert from 'node:assert/strict';const real=cp.execFileSync;cp.execFileSync=(cmd,args,options)=>{if(cmd==='docker'&&args[0]==='image')assert.equal(options.timeout,${JSON.stringify(mode)}==='success-cleanup-fails'?120000:1000);if(cmd==='docker'&&args[0]==='build'){assert.equal(options.timeout,120000);return real(cmd,args,{...options,timeout:args[0]==='build'&&${JSON.stringify(mode)}==='timeout'?1000:options.timeout});}return real(cmd,args,options);};syncBuiltinESMExports();`);
 try{
  const env:NodeJS.ProcessEnv={...process.env,PATH:directory+':'+process.env.PATH,TMPDIR:temp,TMP:temp,TEMP:temp};
  delete env.NODE_TEST_CONTEXT;
  const started=performance.now();let reportedAt:number|undefined;
  const child=spawn(process.execPath,['--import',preload,'--test','--test-reporter=spec',...(allCases?[]:['--test-name-pattern=^bound container returns exact child provenance only after confirmed cleanup$']),suite],{
   env,timeout:10000,
  });
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  const observe=()=>{if(reportedAt===undefined&&(stdout+stderr).includes('backup fixture build failed: '))reportedAt=performance.now();};
  child.stdout.on('data',chunk=>{stdout+=chunk;observe();});child.stderr.on('data',chunk=>{stderr+=chunk;observe();});
  const status=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const result={stdout,stderr};assert.equal(status,1,'a broken fixture must fail the suite');
  assert((result.stdout+result.stderr).includes('bound container returns'),result.stdout+result.stderr);
  try{await readFile(calls);}catch{throw Error(result.stdout+result.stderr);}
  for(const pid of (await readFile(join(directory,'pids'),'utf8')).trim().split('\n').map(Number))assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  return {elapsedMs:performance.now()-started,reportLeadMs:reportedAt===undefined?0:performance.now()-reportedAt,stdout:result.stdout,stderr:result.stderr,calls:(await readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as string[]),remaining:await readdir(temp)};
 }finally{await rm(directory,{recursive:true,force:true});}
}
function diagnostic(stderr:string){
 const line=stderr.split('\n').find(line=>line.includes('backup fixture build failed: '));
 assert(line,'build failure must be printed immediately to stderr, before the runner final summary');
 return JSON.parse(line.slice(line.indexOf('backup fixture build failed: ')+'backup fixture build failed: '.length));
}
test('failed bound fixture build reports command, elapsed time, exit status and bounded stderr tail',async()=>{
 const result=await fixture('tail'),report=diagnostic(result.stdout+result.stderr);
 assert.deepEqual(report.command.slice(0,4),['docker','build','--progress=plain','--iidfile']);
 assert(!report.command.includes('-q'));assert.match(report.command[report.command.indexOf('-t')+1],/^cloud-bound-test:bound-/);assert.equal(report.command.at(-1),fileURLToPath(new URL('../../../',import.meta.url)));
 assert.equal(report.status,42);assert(report.elapsedMs>=0);assert(report.elapsedMs<10000);
 assert.match(report.stderrTail,/#7 resolve node:26 registry stalled/);assert.match(report.stderrTail,/registry-tail-marker/);
 assert(!report.stderrTail.includes('discarded-head-marker'));assert(report.stderrTail.length<=8192);
});
test('failed bound fixture build bounds image removal and still removes its temporary directory',async()=>{
 const result=await fixture('refusal',true);
 assert.deepEqual(result.calls.map(args=>args[0]),['build','image']);const build=result.calls[0]!;assert.deepEqual(result.calls[1],['image','rm',build[build.indexOf('-t')+1]]);assert.deepEqual(result.remaining,[]);
 assert(result.stdout.indexOf('backup fixture build failed: ')<result.stdout.indexOf('✖ bound container returns'));assert.match(result.stdout,/ℹ pass 0/);assert.match(result.stdout,/a different command cannot replace the shipped verifier/);
});
test('timed out bound fixture build preserves timeout reason and partial progress with bounded cleanup',async()=>{
 const result=await fixture('timeout'),report=diagnostic(result.stdout+result.stderr);
 assert.equal(report.code,'ETIMEDOUT');assert.equal(report.signal,'SIGTERM');assert.match(report.stderrTail,/registry-tail-marker/);
 assert.deepEqual(result.calls.map(args=>args[0]),['build','image']);const build=result.calls[0]!;assert.deepEqual(result.calls[1],['image','rm',build[build.indexOf('-t')+1]]);assert.deepEqual(result.remaining,[]);
});
test('a built fixture still removes its own image and removes temporary files even when image cleanup fails',async()=>{
 const result=await fixture('success-cleanup-fails'),build=result.calls[0]!;
 assert.deepEqual(result.calls.at(-1),['image','rm',build[build.indexOf('-t')+1]]);
 assert.deepEqual(result.remaining,[]);assert.match(result.stdout+result.stderr,/fixture cleanup refused/);
});

test('a hung failed-build cleanup ends within its short budget and the original build report is already visible',async()=>{
 const result=await fixture('cleanup-timeout');
 assert.equal(diagnostic(result.stdout+result.stderr).status,42);
 assert(result.reportLeadMs>=500,'the build reason must be visible while cleanup is still blocked');
 assert(result.elapsedMs<5000,'failed-build cleanup must not spend another two-minute command budget');
 assert.deepEqual(result.calls.map(args=>args[0]),['build','image']);const build=result.calls[0]!;assert.deepEqual(result.calls[1],['image','rm',build[build.indexOf('-t')+1]]);assert.deepEqual(result.remaining,[]);
});
