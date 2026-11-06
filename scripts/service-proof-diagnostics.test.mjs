import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, realpathSync, mkdirSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
    assert.equal(result.stderr.trim(), 'SERVICE_PROOF_FAILURE '+JSON.stringify({kind:'output',suite:'rules',fileIndex:0,stream}));
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
try {await checkServiceReceipt(true,${JSON.stringify(directory)});} catch {process.exitCode=1;}
`);
    const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
    const result=spawnSync(process.execPath,[program],{env,encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);assert.equal(result.stderr,'');
    assert.equal(result.stdout,[row,output,{kind:'truncated',limit:16}].map(value=>'SERVICE_PROOF_FAILURE venue '+JSON.stringify(value)+'\n').join(''));
    assert.ok(!result.stdout.includes('private-'));
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
