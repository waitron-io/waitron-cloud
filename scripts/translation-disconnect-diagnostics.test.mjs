import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseServiceProofFailure} from './test-cloud-free-services.mjs';

const failed='Translation worker failed; check database, migrations and provider configuration\n';
const retry='Translation worker pass failed; retrying\n';
const title='disconnected database clients exit with one fixed line and no raw error';
function refusal(actual,name=title){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'translation-disconnect-diagnostic-')));
 try{
  mkdirSync(join(directory,'scripts'));
  mkdirSync(join(directory,'packages/translation/test'),{recursive:true});
  copyFileSync(new URL('./test-cloud-free-services.mjs',import.meta.url),join(directory,'scripts/test-cloud-free-services.mjs'));
  const file=join(directory,'packages/translation/test/worker-cli.test.ts');
  writeFileSync(file,`import {test} from 'node:test';import assert from 'node:assert/strict';
 test(${JSON.stringify(name)},()=>assert.deepEqual(${JSON.stringify(actual)},[1,null,'',${JSON.stringify(failed)}]));`);
  const driver=join(directory,'driver.mjs');
  writeFileSync(driver,`import {run} from 'node:test';import {summariseServiceMatrix} from './scripts/test-cloud-free-services.mjs';
 try{await summariseServiceMatrix(run({files:[${JSON.stringify(file)}],execArgv:[]}),[{id:'translation',files:[${JSON.stringify(file)}]}]);}catch{process.exitCode=1;}`);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
  return spawnSync(process.execPath,[driver],{cwd:directory,env,encoding:'utf8',timeout:10000});
 }finally{rmSync(directory,{recursive:true,force:true});}
}
test('the proof retains the disconnect assertion tuple when its values are fixed worker messages',()=>{
 const actual=[1,null,'',retry+failed];
 const result=refusal(actual);
 assert.equal(result.status,1,result.stderr);assert.equal(result.stdout,'');
 const rows=result.stderr.trim().split('\n').map(parseServiceProofFailure).filter(Boolean);
 assert.ok(rows.some(row=>row.kind==='translation-disconnect'),result.stderr);
 const diagnostic=rows.find(row=>row.kind==='translation-disconnect');
 assert.deepEqual(diagnostic,{kind:'translation-disconnect',actual,expected:[1,null,'',failed]});
});
test('raw worker text and another case cannot gain an assertion-output exemption',()=>{
 for(const [actual,name]of [[[1,null,'','private-raw-error'],title],[[1,null,'',retry+failed],'another private case']]){
  const result=refusal(actual,name);assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.ok(!result.stderr.includes('translation-disconnect'),result.stderr);
  assert.ok(!result.stderr.includes('private'),result.stderr);
 }
});

test('the parent parser accepts only the exact disconnect expectation and finite worker output',()=>{
 const row={kind:'translation-disconnect',actual:[null,'SIGKILL','',''],expected:[1,null,'',failed]};
 assert.deepEqual(parseServiceProofFailure('SERVICE_PROOF_FAILURE '+JSON.stringify(row)),row);
 for(const invalid of [
  {...row,private:'private'}, {...row,actual:[1,null,'private','']},
  {...row,actual:[1,null,'','private']}, {...row,actual:[1,'private','','']},
  {...row,actual:[256,null,'','']}, {...row,actual:[-1,null,'','']},
  {...row,actual:[1.5,null,'','']}, {...row,actual:[1,null,'',failed.repeat(8)]},
  {...row,expected:[0,null,'','']}, {...row,expected:[1,null,'','private']},
 ])assert.equal(parseServiceProofFailure('SERVICE_PROOF_FAILURE '+JSON.stringify(invalid)),undefined);
});

test('the actual receipt parent forwards the safe disconnect tuple on a failing child',()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'translation-disconnect-parent-')));
 try{
  mkdirSync(join(directory,'scripts'));
  const row={kind:'translation-disconnect',actual:[1,null,'',retry+failed],expected:[1,null,'',failed]};
  const line='SERVICE_PROOF_FAILURE '+JSON.stringify(row)+'\n';
  writeFileSync(join(directory,'scripts/test-postgres.mjs'),`process.stderr.write(${JSON.stringify(line)});process.exitCode=1;`);
  for(const args of [['init','-q'],['add','.'],['-c','user.name=Diagnostic fixture','-c','user.email=fixture@example.invalid','commit','-s','-qm','Create controlled refusal']]){
   const r=spawnSync('git',args,{cwd:directory,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  }
  const driver=join(directory,'driver.mjs');
  writeFileSync(driver,`import {checkServiceReceipt} from ${JSON.stringify(new URL('./fixtures/service-proof.ts',import.meta.url).href)};
 try{await checkServiceReceipt(true,${JSON.stringify(directory)});}catch{process.exitCode=1;}`);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
  const result=spawnSync(process.execPath,[driver],{env,cwd:directory,encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.equal(result.stderr,'');
  assert.equal(result.stdout,'SERVICE_PROOF_FAILURE venue '+JSON.stringify(row)+'\n');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
