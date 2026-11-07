import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('a real disconnect assertion retains the selected backends and termination results',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'translation-disconnect-binding-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const failed='Translation worker failed; check database, migrations and provider configuration\n';
 const retry='Translation worker pass failed; retrying\n';
 for(const iteration of [0,1,2]){
 const counter=join(directory,`iteration-${iteration}`);await writeFile(counter,'0');
 const preload=`import {readFileSync,writeFileSync} from 'node:fs';
 if(process.argv[1]?.endsWith('/src/worker-cli.ts')){
  const index=Number(readFileSync(${JSON.stringify(counter)},'utf8'));
  writeFileSync(${JSON.stringify(counter)},String(index+1));
  const report=console.error;
  console.error=(...args)=>{if(index===${iteration}&&args[0]===${JSON.stringify(failed.trim())})report(${JSON.stringify(retry.trim())});report(...args);};
 }`;
 env.NODE_OPTIONS='--import=data:text/javascript;base64,'+Buffer.from(preload).toString('base64');
 const file=fileURLToPath(new URL('./worker-cli.test.ts',import.meta.url));
 const title='disconnected database clients exit with one fixed line and no raw error';
 const driver=`import {run} from 'node:test';
 import {summariseServiceMatrix} from ${JSON.stringify(new URL('../../../scripts/test-cloud-free-services.mjs',import.meta.url).href)};
 try{await summariseServiceMatrix(run({files:[${JSON.stringify(file)}],execArgv:[],testNamePatterns:[${JSON.stringify('^'+title+'$')}]}),[{id:'translation',files:[${JSON.stringify(file)}]}]);}
 catch{process.exitCode=1;}`;
 const driverFile=join(directory,'driver.mjs');await writeFile(driverFile,driver);
 const result=await exec(process.execPath,[driverFile],
  {cwd:fileURLToPath(new URL('../../../',import.meta.url)),env,encoding:'utf8',timeout:25000,maxBuffer:1048576})
  .then(value=>({...value,code:0}),error=>error);
 assert.equal(result.code,1,result.stderr);assert.equal(result.stdout,'');
 const rows=result.stderr.trim().split('\n').filter((line:string)=>line.startsWith('SERVICE_PROOF_FAILURE ')).map((line:string)=>JSON.parse(line.slice('SERVICE_PROOF_FAILURE '.length)));
 const diagnostic=rows.find((row:{kind:string})=>row.kind==='translation-disconnect');
 assert.ok(diagnostic,result.stderr);
 assert.deepEqual(diagnostic.actual,[1,null,'',retry+failed]);
 assert.deepEqual(diagnostic.expected,[1,null,'',failed]);
 assert.equal(diagnostic.termination?.iteration,iteration,result.stderr);
 assert.ok(diagnostic.termination.backends.length>0&&diagnostic.termination.backends.length<=4);
 for(const backend of diagnostic.termination.backends){
  assert.deepEqual(Object.keys(backend).sort(),['killed','pid']);
  assert.ok(Number.isInteger(backend.pid)&&backend.pid>0&&backend.pid<=2147483647);
  assert.equal(backend.killed,true);
 }
 }
});
