import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, realpathSync, mkdirSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseServiceProofFailure} from './test-cloud-free-services.mjs';

function failedProof(body) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'service-proof-failure-')));
  try {
    const file = join(directory, 'private-path.test.mjs');
    writeFileSync(file, body);
    const program = join(directory, 'driver.mjs');
    writeFileSync(program, `import {run} from 'node:test';
import {summariseServiceMatrix} from ${JSON.stringify(new URL('./test-cloud-free-services.mjs', import.meta.url).href)};
const selected=[{id:'rules',files:[${JSON.stringify(file)}]}];
try { await summariseServiceMatrix(run({files:selected[0].files,execArgv:[]}), selected); }
catch { process.exitCode=1; }
`);
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS; delete env.CLOUD_SERVICE_PROOF_TIMINGS;
    return spawnSync(process.execPath, [program], {env, encoding:'utf8', timeout:10000});
  } finally { rmSync(directory, {recursive:true, force:true}); }
}

test('a real failed service assertion identifies its file and line without private values', () => {
  const result = failedProof(`import {test} from 'node:test';
import assert from 'node:assert/strict';
test('private-name', () => assert.equal('private-actual','private-expected'));
`);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const lines = result.stderr.trim().split('\n');
  assert.ok(lines[0].startsWith('SERVICE_PROOF_FAILURE '), result.stderr);
  const diagnostic = JSON.parse(lines[0].slice('SERVICE_PROOF_FAILURE '.length));
  assert.deepEqual(diagnostic, {kind:'case', suite:'rules', fileIndex:0, line:3, failureType:'testCodeFailure', code:'ERR_ASSERTION'});
  assert.ok(!result.stderr.includes('private-'), result.stderr);
});

test('unexpected child output remains a refusal and reports only its stream and position', () => {
  for (const stream of ['stdout','stderr']) {
    const result = failedProof(`import {test} from 'node:test';
test('private-name', () => process.${stream}.write('private-output\\n'));
`);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('private-'), result.stderr);
    assert.equal(result.stderr.trim(), [
      {kind:'output',suite:'rules',fileIndex:0,stream},
      {kind:'refusal',stage:'summary',reason:'unexpected-output',suite:'rules',fileIndex:0,counts:null,incomplete:true},
    ].map(value=>'SERVICE_PROOF_FAILURE '+JSON.stringify(value)).join('\n'));
  }
});

test('failure reports stop at sixteen records and explicitly mark truncation', () => {
  const result = failedProof(`import {test} from 'node:test';
for(let i=0;i<20;i++) test('private-name-'+i, () => {throw new Error('private-error');});
`);
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes('private-'), result.stderr);
  const rows=result.stderr.trim().split('\n').map(line=>JSON.parse(line.slice('SERVICE_PROOF_FAILURE '.length)));
  assert.equal(rows.length, 17);
  assert.ok(rows.slice(0,16).every(row=>row.kind==='case'&&row.suite==='rules'&&row.fileIndex===0&&row.code==='ERR_TEST_FAILURE'));
  assert.deepEqual(rows[16], {kind:'truncated',limit:16});
});

test('a real test timeout is distinguished from an assertion without leaking its name', () => {
  const result=failedProof(`import {test} from 'node:test';
test('private-timeout', {timeout:20}, async () => {await new Promise(resolve=>setTimeout(resolve,60));});
`);
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.ok(result.stderr.includes('"failureType":"testTimeoutFailure"'),result.stderr);
  assert.ok(!result.stderr.includes('private-'),result.stderr);
});

test('the actual receipt parent retains split failure records and refuses private or malformed fields', () => {
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'service-proof-parent-')));
  try {
    mkdirSync(join(directory,'scripts'));
    const row={kind:'case',suite:'rules',fileIndex:0,line:3,failureType:'testCodeFailure',code:'ERR_ASSERTION'};
    const output={kind:'output',suite:'rules',fileIndex:0,stream:'stderr'};
    const lines=[row,output,{...row,private:'private-value'},{...row,suite:'private-suite'},{...row,code:'private-code'},{...row,line:-1},{...row,fileIndex:-1},{...row,failureType:'private-type'}, {kind:'truncated',limit:16}].map(value=>'SERVICE_PROOF_FAILURE '+JSON.stringify(value)+'\n').join('');
    writeFileSync(join(directory,'scripts/test-postgres.mjs'), `process.stderr.write(${JSON.stringify(lines.slice(0,20))});
setTimeout(()=>{process.stderr.write(${JSON.stringify(lines.slice(20))});process.exitCode=1;},10);
`);
    for(const args of [['init','-q'],['add','.'],['-c','user.name=Service proof fixture','-c','user.email=fixture@example.invalid','commit','-s','-qm','Create controlled child refusal']]){
      const result=spawnSync('git',args,{cwd:directory,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    }
    const program=join(directory,'driver.mjs');
    writeFileSync(program,`import {checkServiceReceipt} from ${JSON.stringify(new URL('./fixtures/service-proof.ts',import.meta.url).href)};
try {await checkServiceReceipt(process.argv[2]==='true',${JSON.stringify(directory)});} catch {process.exitCode=1;}
`);
    const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
    for(const [mode,label] of [[true,'venue'],[false,'legacy']]){
      const result=spawnSync(process.execPath,[program,String(mode)],{env,encoding:'utf8',timeout:10000});
      assert.equal(result.status,1);assert.equal(result.stderr,'');
      assert.equal(result.stdout,[row,output,{kind:'truncated',limit:16}].map(value=>'SERVICE_PROOF_FAILURE '+label+' '+JSON.stringify(value)+'\n').join(''));
      assert.ok(!result.stdout.includes('private-'));
    }
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('the actual single-suite CLI reports a failing case and still exits without a receipt', () => {
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'service-proof-cli-')));
  try {
    for(const path of ['scripts','deploy/test-cloud'])mkdirSync(join(directory,path),{recursive:true});
    copyFileSync(new URL('./test-cloud-free-services.mjs',import.meta.url),join(directory,'scripts/test-cloud-free-services.mjs'));
    for(const path of ['deploy/test-cloud/venue-service-runtime.test.mjs','scripts/venue-service-cli.test.mjs','deploy/test-cloud/venue-service-startup.test.mjs'])writeFileSync(join(directory,path),"import {test} from 'node:test';test('private-name',()=>{});\n");
    writeFileSync(join(directory,'deploy/test-cloud/venue-service-runtime.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';\ntest('private-name',()=>assert.equal('private-actual','private-expected'));\n");
    const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
    const result=spawnSync(process.execPath,['scripts/test-cloud-free-services.mjs','--venue-levels','--suite','runtime'],{cwd:directory,env,encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.ok(result.stderr.includes('SERVICE_PROOF_FAILURE '+JSON.stringify({kind:'case',suite:'runtime',fileIndex:0,line:2,failureType:'testCodeFailure',code:'ERR_ASSERTION'})),result.stderr);
    assert.ok(result.stderr.endsWith('Free-service proof failed\n'));
    assert.ok(!result.stderr.includes('private-'),result.stderr);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('a late asynchronous failure retains the failed file summary before Node emits its failure', () => {
  const result=failedProof(`import {test} from 'node:test';
test('private-late',()=>{setTimeout(()=>Promise.reject(new Error('private-late-error')),0);});
`);
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.ok(result.stderr.includes('"kind":"refusal"'),result.stderr);
  assert.ok(result.stderr.includes('"reason":"failed-suite"'),result.stderr);
  assert.ok(result.stderr.includes('"suite":"rules","fileIndex":0'),result.stderr);
  assert.ok(result.stderr.includes('"incomplete":true'),result.stderr);
  assert.ok(!result.stderr.includes('private-'),result.stderr);
});

test('the full proof identifies a post-run checkout refusal without printing its private file', () => {
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'service-proof-dirty-')));
  try {
    const files=['deploy/test-cloud/venue-service-storage.test.mjs','deploy/test-cloud/venue-service-composition.test.mjs','packages/backups/test/venue-service-streams.test.ts',
      'packages/backups/test/venue-service-backups.test.ts','packages/backups/test/venue-service-captures.test.ts','packages/backups/test/venue-service-replacement.test.ts',
      'packages/remote-access/test/venue-service-remote.test.ts','packages/remote-access/test/venue-service-remote-boundaries.test.ts','packages/remote-access/test/venue-service-report-authority.test.ts',
      'packages/account-http/test/venue-service-recovery.test.ts','packages/account-http/test/venue-service-replacement.test.ts',
      'packages/registration/test/venue-service-installations.test.ts','packages/registration/test/venue-service-registration-races.test.ts',
      'packages/translation/test/venue-service-translation.test.ts','packages/translation/test/venue-service-queue.test.ts','packages/translation/test/worker-cli.test.ts',
      'deploy/test-cloud/venue-service-runtime.test.mjs','scripts/venue-service-cli.test.mjs','deploy/test-cloud/venue-service-startup.test.mjs',
      'packages/registration/test/venue-service-relay.test.ts','packages/registration/test/venue-service-rules.test.ts'];
    for(const path of files){mkdirSync(join(directory,path,'..'),{recursive:true});writeFileSync(join(directory,path),"import {test} from 'node:test';test('private-name',()=>{});\n");}
    copyFileSync(new URL('./test-cloud-free-services.mjs',import.meta.url),join(directory,'scripts/test-cloud-free-services.mjs'));
    writeFileSync(join(directory,files[0]),"import {test} from 'node:test';import {writeFileSync} from 'node:fs';test('private-name',()=>writeFileSync('private-stray-file','private-value'));\n");
    for(const args of [['init','-q'],['add','.'],['-c','user.name=Service proof fixture','-c','user.email=fixture@example.invalid','commit','-s','-qm','Create dirty-proof fixture']]){
      const result=spawnSync('git',args,{cwd:directory,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    }
    const env={...process.env,TEST_DATABASE_URL:'postgres://fixture.invalid/database',MAILPIT_TEST_URL:'http://fixture.invalid',MAILPIT_TEST_SMTP_PORT:'1'};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
    const result=spawnSync(process.execPath,['scripts/test-cloud-free-services.mjs','--venue-levels'],{cwd:directory,env,encoding:'utf8',timeout:20000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.ok(result.stderr.includes('SERVICE_PROOF_FAILURE '+JSON.stringify({kind:'command',stage:'checkout-after',code:'ERR_ASSERTION'})),result.stderr);
    assert.ok(!result.stderr.includes('private-'),result.stderr);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('the diagnostic parser refuses every private field and invalid boundary', () => {
  const row={kind:'case',suite:'rules',fileIndex:0,line:0,failureType:'unknown',code:'unknown'};
  const output={kind:'output',suite:'rules',fileIndex:0,stream:'stdout'};
  const refusal={kind:'refusal',stage:'summary',reason:'failed-suite',suite:'unknown',fileIndex:-1,counts:null,incomplete:true};
  const command={kind:'command',stage:'checkout-after',code:'ERR_ASSERTION'};
  for(const value of [row,output,refusal,command,{kind:'truncated',limit:16}])assert.deepEqual(parseServiceProofFailure('SERVICE_PROOF_FAILURE '+JSON.stringify(value)),value);
  const invalid=[{...row,fileIndex:1},{...row,line:-1},{...row,line:'private'}, {...row,code:'private'}, {...row,failureType:'private'}, {...row,private:'private'},
    {...output,stream:'private'}, {kind:'truncated',limit:17}, {kind:'truncated',limit:16,private:'private'},
    {...refusal,incomplete:false},{...refusal,stage:'private'},{...refusal,reason:'private'},{...refusal,counts:{tests:'private'}},{...refusal,fileIndex:0},
    {...command,stage:'private'},{...command,code:'private'},{...command,private:'private'}];
  for(const value of invalid)assert.equal(parseServiceProofFailure('SERVICE_PROOF_FAILURE '+JSON.stringify(value)),undefined,JSON.stringify(value));
  assert.equal(parseServiceProofFailure('SERVICE_PROOF_FAILURE '+JSON.stringify(row)+' '.repeat(1024)),undefined);
});

test('sender metadata is sanitized independently of the parent parser and maps the second file', () => {
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'service-proof-metadata-')));
  try {
    const program=join(directory,'driver.mjs');
    writeFileSync(program,`import {summariseServiceMatrix} from ${JSON.stringify(new URL('./test-cloud-free-services.mjs',import.meta.url).href)};
const selected=[{id:'backups',files:['/private-first','/private-second']}];
async function* events(){
yield {type:'test:fail',data:{file:'/private-second',line:'private-line',details:{error:{code:'private-code',failureType:'private-type',cause:{code:'private-cause'}}}}};
yield {type:'test:summary',data:{file:'/private-second',success:false,counts:{tests:1,passed:0,failed:1,cancelled:0,skipped:0,todo:0}}};
}
try{await summariseServiceMatrix(events(),selected);}catch{process.exitCode=1;}
`);
    const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
    const result=spawnSync(process.execPath,[program],{env,encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');
    const rows=result.stderr.trim().split('\n').map(line=>JSON.parse(line.slice('SERVICE_PROOF_FAILURE '.length)));
    assert.deepEqual(rows[0],{kind:'case',suite:'backups',fileIndex:1,line:0,failureType:'unknown',code:'unknown'});
    assert.ok(!result.stderr.includes('private-'),result.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('an allowlisted cause survives two private wrapper errors', () => {
  const result=failedProof(`import {test} from 'node:test';
test('private-name',()=>{throw new Error('private-outer',{cause:new Error('private-middle',{cause:Object.assign(new Error('private-inner'),{code:'ETIMEDOUT'})})});});
`);
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.ok(result.stderr.includes('"code":"ETIMEDOUT"'),result.stderr);
  assert.ok(!result.stderr.includes('private-'),result.stderr);
});
