import {requiredCaseEvents} from './ci-required-cases.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {run} from 'node:test';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  {id: 'account-mail', cwd: '.', files: ['deploy/test-cloud/free-services-mail.test.mjs']},
  {id: 'relay-plans', cwd: '.', files: ['deploy/test-cloud/free-services-relay.test.mjs']},
  {id: 'translation-plans', cwd: 'packages/translation', files: ['test/free-service-plans.test.ts']},
  {id: 'relay-guards', cwd: 'packages/registration', files: ['test/relay-grants.test.ts', 'test/relay-worker.test.ts', 'test/relay-control.test.ts', 'test/relay-operator-stop.test.ts', 'test/content-translation-service.test.ts']},
  {id: 'translation-guards', cwd: 'packages/translation', files: ['test/machine.test.ts', 'test/worker.test.ts', 'test/collect-page.test.ts', 'test/consent.test.ts']},
  {id: 'http-guards', cwd: 'packages/account-http', files: ['test/relay-disabled.test.ts', 'test/translation.test.ts', 'test/translation-collect-pages.test.ts', 'test/content-translation-readers.test.ts']},
  {id: 'deployment-gates', cwd: '.', files: ['deploy/test-cloud/runtime.test.mjs', 'deploy/test-cloud/deployment.test.mjs']},
];
const suiteIds = suites.map(suite => suite.id);
const failureTypes = ['testCodeFailure','testTimeoutFailure','cancelledByParent','subtestsFailed','hookFailed','testAborted','uncaughtException','unhandledRejection'];
const failureCodes = ['ERR_ASSERTION','ERR_TEST_FAILURE','ERR_MODULE_NOT_FOUND','ERR_UNKNOWN_FILE_EXTENSION','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOENT','ENOSPC','23505','40P01','40001','53300','57P01'];
const commandStages=['checkout-before','environment','services','checkout-after','receipt'];
const refusalReasons=new Map([['Unexpected test output','unexpected-output'],['Failed suite','failed-suite'],['Missing final test summary','missing-final-summary'],['Missing file execution','missing-file-execution']]);
const countFields=['tests','passed','failed','cancelled','skipped','todo'];
const disconnectTitle='disconnected database clients exit with one fixed line and no raw error';
const workerFailure='Translation worker failed; check database, migrations and provider configuration\n';
const workerLines=[workerFailure,'Translation worker pass failed; retrying\n','Translation worker cleanup failed; retrying\n'];
function validDisconnectTuple(value){
  return Array.isArray(value)&&value.length===4&&
    (value[0]===null||Number.isSafeInteger(value[0])&&value[0]>=0&&value[0]<=255)&&
    [null,'SIGINT','SIGTERM','SIGKILL','SIGABRT','SIGSEGV'].includes(value[1])&&value[2]===''&&
    typeof value[3]==='string'&&value[3].length<=400&&
    value[3].split(/(?<=\n)/).every(line=>line===''||workerLines.includes(line));
}
function disconnectAssertion(error){
  for(let depth=0;depth<4&&error&&typeof error==='object';depth++,error=error.cause){
    if(error.code!=='ERR_ASSERTION'||!validDisconnectTuple(error.actual))continue;
    try{assert.deepEqual(error.expected,[1,null,'',workerFailure]);}
    catch{continue;}
    return {kind:'translation-disconnect',actual:error.actual,expected:error.expected};
  }
}
let proofStage;
function failureCode(error) {
  let code = 'unknown';
  for (let depth=0; depth<4 && error && typeof error==='object'; depth++) {
    if (failureCodes.includes(error.code)) code=error.code;
    error=error.cause;
  }
  return code;
}
function proofConcurrency(){
  const value=process.env.CLOUD_SERVICE_PROOF_CONCURRENCY;
  assert.ok(value===undefined||value==='1'||value==='2','Invalid proof concurrency');
  return value==='2'?2:1;
}
// Start provider and larger database suites first so their tails overlap.
const venueSuites = [
  {id:'storage',files:['deploy/test-cloud/venue-service-storage.test.mjs','deploy/test-cloud/venue-service-composition.test.mjs','packages/backups/test/venue-service-streams.test.ts']},
  {id:'backups',files:['packages/backups/test/venue-service-backups.test.ts','packages/backups/test/venue-service-captures.test.ts','packages/backups/test/venue-service-replacement.test.ts']},
  {id:'remote',files:['packages/remote-access/test/venue-service-remote.test.ts','packages/remote-access/test/venue-service-remote-boundaries.test.ts','packages/remote-access/test/venue-service-report-authority.test.ts']},
  {id:'recovery',files:['packages/account-http/test/venue-service-recovery.test.ts','packages/account-http/test/venue-service-replacement.test.ts']},
  {id:'installations',files:['packages/registration/test/venue-service-installations.test.ts','packages/registration/test/venue-service-registration-races.test.ts']},
  {id:'translation',files:['packages/translation/test/venue-service-translation.test.ts','packages/translation/test/venue-service-queue.test.ts','packages/translation/test/worker-cli.test.ts']},
  {id:'runtime',files:['deploy/test-cloud/venue-service-runtime.test.mjs','scripts/venue-service-cli.test.mjs','deploy/test-cloud/venue-service-startup.test.mjs']},
  {id:'relay',files:['packages/registration/test/venue-service-relay.test.ts']},
  {id:'rules',files:['packages/registration/test/venue-service-rules.test.ts']},
].map(suite=>({...suite,cwd:'.'}));
function keys(value, names) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Invalid proof object');
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'Unexpected proof fields');
}
export function parseServiceProofFailure(line) {
  if (!line.startsWith('SERVICE_PROOF_FAILURE ') || line.length>1024) return;
  try {
    const value=JSON.parse(line.slice('SERVICE_PROOF_FAILURE '.length));
    if(value.kind==='translation-disconnect'){
      keys(value,['kind','actual','expected']);assert.ok(validDisconnectTuple(value.actual));
      assert.deepEqual(value.expected,[1,null,'',workerFailure]);return value;
    }
    if(value.kind==='truncated'){
      keys(value,['kind','limit']);assert.equal(value.limit,16);return value;
    }
    if(value.kind==='command'){
      keys(value,['kind','stage','code']);assert.ok(commandStages.includes(value.stage));
      assert.ok([...failureCodes,'unknown'].includes(value.code));return value;
    }
    if(value.kind==='refusal'){
      keys(value,['kind','stage','reason','suite','fileIndex','counts','incomplete']);
      assert.equal(value.stage,'summary');assert.equal(value.incomplete,true);
      assert.ok([...refusalReasons.values(),'invalid-evidence'].includes(value.reason));
      const suite=[...suites,...venueSuites].find(suite=>suite.id===value.suite);
      assert.ok(value.suite==='unknown'?value.fileIndex===-1:suite&&Number.isSafeInteger(value.fileIndex)&&value.fileIndex>=0&&value.fileIndex<suite.files.length);
      if(value.counts!==null){keys(value.counts,countFields);for(const count of Object.values(value.counts))assert.ok(count===null||Number.isSafeInteger(count)&&count>=0);}
      return value;
    }
    const fields=value.kind==='case'?['line','failureType','code']:value.kind==='output'?['stream']:null;
    assert.ok(fields);keys(value,['kind','suite','fileIndex',...fields]);
    const suite=[...suites,...venueSuites].find(suite=>suite.id===value.suite);
    assert.ok(suite&&Number.isSafeInteger(value.fileIndex)&&value.fileIndex>=0&&value.fileIndex<suite.files.length);
    if(value.kind==='case'){
      assert.ok(Number.isSafeInteger(value.line)&&value.line>=0);
      assert.ok([...failureTypes,'unknown'].includes(value.failureType));
      assert.ok([...failureCodes,'unknown'].includes(value.code));
    }else assert.ok(['stdout','stderr'].includes(value.stream));
    return value;
  }catch{return;}
}
export function validateFreeServiceReceipt(value) {
  keys(value, ['version', 'kind', 'cloudHead', 'cloudTree', 'scope', 'relay', 'translation', 'deployedTranslation', 'waitronRelay', 'waitronTranslation', 'suites']);
  assert.equal(value.version, 1);
  assert.equal(value.kind, 'test-cloud-free-services');
  for (const name of ['cloudHead', 'cloudTree']) assert.match(value[name], /^[a-f0-9]{40}$/);
  for (const [name, expected] of Object.entries({scope: 'local-fixtures', relay: 'local-proof', translation: 'fake-loopback', deployedTranslation: 'off', waitronRelay: 'not-qualified', waitronTranslation: 'not-qualified'})) assert.equal(value[name], expected);
  assert.ok(Array.isArray(value.suites));
  assert.deepEqual(value.suites.map(suite => suite.id).sort(), [...suiteIds].sort());
  for (const suite of value.suites) {
    keys(suite, ['id', 'tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo']);
    assert.ok(Number.isSafeInteger(suite.tests) && suite.tests > 0, 'No executed tests');
    assert.equal(suite.passed, suite.tests);
    for (const name of ['failed', 'cancelled', 'skipped', 'todo']) assert.equal(suite[name], 0);
  }
  return true;
}

export function validateVenueServiceReceipt(value) {
  keys(value,['version','kind','cloudHead','cloudTree','scope','mode','productionEnforcement','suites']);
  assert.equal(value.version,2);assert.equal(value.kind,'test-cloud-venue-services');
  for(const field of ['cloudHead','cloudTree']){assert.equal(typeof value[field],'string');assert.match(value[field],/^[a-f0-9]{40}$/);}
  assert.equal(value.scope,'local-fixtures');assert.equal(value.mode,'test-venue-levels');assert.equal(value.productionEnforcement,'off');
  assert.ok(Array.isArray(value.suites));
  assert.deepEqual(value.suites.map(suite=>suite.id).sort(),venueSuites.map(suite=>suite.id).sort());
  for(const suite of value.suites){
    keys(suite,['id','tests','passed','failed','cancelled','skipped','todo']);
    assert.ok(Number.isSafeInteger(suite.tests)&&suite.tests>0,'No executed tests');assert.equal(suite.passed,suite.tests);
    for(const field of ['failed','cancelled','skipped','todo'])assert.equal(suite[field],0);
  }
  return true;
}

export async function summariseTestRun(events, expectedFiles = []) {
  let result;
  const files = new Map();
  for await (const event of events) {
    // Nested-runner warnings and private test output must not become successful evidence.
    if (event.type === 'test:stdout' || event.type === 'test:stderr') throw new Error('Unexpected test output');
    if (event.type !== 'test:summary') continue;
    assert.equal(event.data.success, true, 'Failed suite');
    const {tests, passed, failed, cancelled, skipped, todo} = event.data.counts;
    assert.ok(Number.isSafeInteger(tests) && tests > 0);
    assert.equal(passed, tests);
    for (const count of [failed, cancelled, skipped, todo]) assert.equal(count, 0);
    if (event.data.file !== undefined) {
      const file = resolve(event.data.file);
      assert.ok(expectedFiles.map(path => resolve(path)).includes(file) && !files.has(file), 'Unexpected file summary');
      files.set(file, tests);
    } else {
      assert.equal(result, undefined, 'Duplicate test summary');
      result = {tests, passed, failed, cancelled, skipped, todo};
    }
  }
  assert.ok(result, 'Missing final test summary');
  assert.equal(files.size, expectedFiles.length, 'Missing file execution');
  if (expectedFiles.length) assert.equal([...files.values()].reduce((sum, count) => sum + count, 0), result.tests);
  return result;
}

export async function summariseServiceMatrix(events,selected){
  const files=selected.flatMap(suite=>suite.files.map(file=>resolve(file)));
  assert.equal(new Set(files).size,files.length,'Duplicate matrix file');
  assert.equal(new Set(selected.map(suite=>suite.id)).size,selected.length,'Duplicate matrix suite');
  assert.ok(selected.length>0&&selected.every(suite=>suite.files.length>0),'Empty matrix suite');
  const summaries=new Map();
  const started=performance.now(),timings=process.env.CLOUD_SERVICE_PROOF_TIMINGS==='1';
  const positions=new Map(selected.flatMap(suite=>suite.files.map((file,fileIndex)=>[resolve(file),{suite:suite.id,fileIndex}])));
  let failures=0;
  let lastPosition, lastCounts, lastType, lastSuccess;
  function report(value){
    if(failures<16)process.stderr.write('SERVICE_PROOF_FAILURE '+JSON.stringify(value)+'\n');
    else if(failures===16)process.stderr.write('SERVICE_PROOF_FAILURE {"kind":"truncated","limit":16}\n');
    failures++;
  }
  async function* observed(){
    for await(const event of events){
      const data=event.data,position=typeof data?.file==='string'?positions.get(resolve(data.file)):undefined;
      lastPosition=position;lastCounts=event.type==='test:summary'?data.counts:undefined;
      lastType=event.type;lastSuccess=data?.success;
      if(event.type==='test:fail'&&position){
        const error=data.details?.error;
        report({kind:'case',...position,line:Number.isSafeInteger(data.line)&&data.line>0?data.line:0,failureType:failureTypes.includes(error?.failureType)?error.failureType:'unknown',code:failureCode(error)});
        // Only this assertion's finite worker messages can cross the privacy boundary.
        if(resolve(data.file)===resolve(root,'packages/translation/test/worker-cli.test.ts')&&data.name===disconnectTitle){
          const diagnostic=disconnectAssertion(data.details?.error);if(diagnostic)report(diagnostic);
        }
      }
      if((event.type==='test:stdout'||event.type==='test:stderr')&&position)report({kind:'output',...position,stream:event.type==='test:stdout'?'stdout':'stderr'});
      const duration=event.type==='test:complete'?data?.details?.duration_ms:data?.duration_ms;
      if(timings&&position&&Number.isFinite(duration)&&duration>=0){
        const base={...position,durationMs:duration,elapsedMs:performance.now()-started};
        if(event.type==='test:complete'&&data.name!==data.file&&Number.isSafeInteger(data.line)&&data.line>0&&Number.isSafeInteger(data.testNumber)&&data.testNumber>0)
          process.stderr.write('SERVICE_PROOF_TIMING '+JSON.stringify({kind:'case',...base,line:data.line,testNumber:data.testNumber,nesting:data.nesting,caseType:data.details.type==='suite'?'suite':'test'})+'\n');
        if(event.type==='test:summary')process.stderr.write('SERVICE_PROOF_TIMING '+JSON.stringify({kind:'file',...base,tests:data.counts.tests})+'\n');
      }
      if(event.type==='test:summary'&&event.data.file!==undefined)summaries.set(resolve(event.data.file),event.data.counts);
      yield event;
    }
  }
  try{await summariseTestRun(observed(),files);}
  catch(error){
    // Validation may stop before Node emits the corresponding failure event.
    const reason=lastType==='test:summary'&&lastSuccess!==true?'failed-suite':lastType==='test:stdout'||lastType==='test:stderr'?'unexpected-output':refusalReasons.get(error?.message)??'invalid-evidence';
    report({kind:'refusal',stage:'summary',reason,suite:lastPosition?.suite??'unknown',fileIndex:lastPosition?.fileIndex??-1,counts:lastCounts?Object.fromEntries(countFields.map(field=>[field,Number.isSafeInteger(lastCounts[field])&&lastCounts[field]>=0?lastCounts[field]:null])):null,incomplete:true});
    throw error;
  }
  return selected.map(suite=>{
    const value={id:suite.id,tests:0,passed:0,failed:0,cancelled:0,skipped:0,todo:0};
    for(const file of suite.files)for(const field of ['tests','passed','failed','cancelled','skipped','todo'])value[field]+=summaries.get(resolve(file))[field];
    return value;
  });
}
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1048576}).trim();
async function proof(venueLevels=false) {
  const concurrency=proofConcurrency();
  proofStage='checkout-before';
  assert.equal(git('status', '--porcelain'), '', 'Proof requires a clean committed checkout');
  proofStage='environment';
  assert.ok(process.env.TEST_DATABASE_URL && process.env.MAILPIT_TEST_URL && process.env.MAILPIT_TEST_SMTP_PORT, 'Use scripts/test-postgres.mjs');
  proofStage='checkout-before';
  const cloudHead = git('rev-parse', 'HEAD'), cloudTree = git('rev-parse', 'HEAD^{tree}');
  const selected=(venueLevels?venueSuites:suites).map(suite=>({...suite,files:suite.files.map(file=>resolve(root,suite.cwd,file))}));
  // Parallel mode permits four files in total; serial mode runs one.
  const controller=new AbortController(),stop=()=>controller.abort();
  const timer=setTimeout(stop,600000);
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  let results;
  try{
    proofStage='services';
    for(const suite of selected)process.stderr.write(`Free-service proof: ${suite.id}\n`);
    results=await summariseServiceMatrix(requiredCaseEvents(run({files:selected.flatMap(suite=>suite.files),concurrency:concurrency===2?4:1,timeout:120000,execArgv:[],signal:controller.signal})),selected);
  }finally{clearTimeout(timer);controller.abort();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
  proofStage='checkout-after';
  assert.equal(git('rev-parse', 'HEAD'), cloudHead); assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('rev-parse','HEAD^{tree}'),cloudTree);
  proofStage='receipt';
  if(venueLevels){
    const receipt={version:2,kind:'test-cloud-venue-services',cloudHead,cloudTree,scope:'local-fixtures',mode:'test-venue-levels',productionEnforcement:'off',suites:results};
    validateVenueServiceReceipt(receipt);return receipt;
  }
  const receipt = {version: 1, kind: 'test-cloud-free-services', cloudHead, cloudTree, scope: 'local-fixtures', relay: 'local-proof', translation: 'fake-loopback', deployedTranslation: 'off', waitronRelay: 'not-qualified', waitronTranslation: 'not-qualified', suites: results};
  validateFreeServiceReceipt(receipt);
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Node test filters can omit cases without incrementing the skipped count.
    assert.equal(process.env.NODE_OPTIONS, undefined, 'Proof requires default Node options');
    proofConcurrency();
    const args=process.argv.slice(2),venueLevels=args[0]==='--venue-levels';if(venueLevels)args.shift();
    if (args.length === 0) process.stdout.write(JSON.stringify(await proof(venueLevels)) + '\n');
    else {
      assert.equal(args.length, 2); assert.equal(args[0], '--suite');
      const suite = (venueLevels?venueSuites:suites).find(value => value.id === args[1]); assert.ok(suite);
      proofStage='services';
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      try {
        const [{id: _id,...summary}]=await summariseServiceMatrix(requiredCaseEvents(run({files: suite.files, concurrency: proofConcurrency(), timeout: 120000, execArgv: [], signal: controller.signal})), [suite]);
        process.stdout.write(JSON.stringify(summary) + '\n');
      } finally {controller.abort(); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);}
    }
  } catch(error) {
    if(proofStage)process.stderr.write('SERVICE_PROOF_FAILURE '+JSON.stringify({kind:'command',stage:proofStage,code:failureCode(error)})+'\n');
    process.stderr.write('Free-service proof failed\n'); process.exitCode = 1;
  }
}
