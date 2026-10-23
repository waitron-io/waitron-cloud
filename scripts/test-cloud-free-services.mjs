import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {run} from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  {id: 'account-mail', cwd: '.', files: ['deploy/test-cloud/free-services-mail.test.mjs']},
  {id: 'relay-plans', cwd: '.', files: ['deploy/test-cloud/free-services-relay.test.mjs']},
  {id: 'translation-plans', cwd: 'packages/translation', files: ['test/free-service-plans.test.ts']},
  {id: 'relay-guards', cwd: 'packages/registration', files: ['test/relay-grants.test.ts', 'test/relay-worker.test.ts', 'test/relay-control.test.ts', 'test/relay-operator-stop.test.ts']},
  {id: 'translation-guards', cwd: 'packages/translation', files: ['test/machine.test.ts', 'test/worker.test.ts', 'test/collect-page.test.ts', 'test/consent.test.ts']},
  {id: 'http-guards', cwd: 'packages/account-http', files: ['test/relay-disabled.test.ts', 'test/translation.test.ts', 'test/translation-collect-pages.test.ts', 'test/content-translation-readers.test.ts']},
  {id: 'deployment-gates', cwd: '.', files: ['deploy/test-cloud/runtime.test.mjs', 'deploy/test-cloud/deployment.test.mjs']},
];
const suiteIds = suites.map(suite => suite.id);
function keys(value, names) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Invalid proof object');
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'Unexpected proof fields');
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

export async function summariseTestRun(events) {
  let result;
  for await (const event of events) {
    // Nested-runner warnings and private test output must not become successful evidence.
    if (event.type === 'test:stdout' || event.type === 'test:stderr') throw new Error('Unexpected test output');
    if (event.type !== 'test:summary') continue;
    if (event.data.file !== undefined) continue;
    assert.equal(result, undefined, 'Duplicate test summary');
    assert.equal(event.data.success, true, 'Failed suite');
    const {tests, passed, failed, cancelled, skipped, todo} = event.data.counts;
    assert.ok(Number.isSafeInteger(tests) && tests > 0);
    assert.equal(passed, tests);
    for (const count of [failed, cancelled, skipped, todo]) assert.equal(count, 0);
    result = {tests, passed, failed, cancelled, skipped, todo};
  }
  assert.ok(result, 'Missing final test summary');
  return result;
}

async function runSuite(suite) {
  return new Promise((resolve, reject) => {
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--suite', suite.id], {cwd: new URL(`${suite.cwd}/`, pathToFileURL(root)), env, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', bytes = 0, failed = false;
    const stop = () => {failed = true; child.kill('SIGTERM');};
    const timer = setTimeout(stop, 600000);
    const terminate = () => stop();
    process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
    child.stdout.on('data', chunk => {bytes += chunk.length; if (bytes > 4096) stop(); else output += chunk;});
    child.stderr.on('data', stop);
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer); process.removeListener('SIGINT', terminate); process.removeListener('SIGTERM', terminate);
      if (failed || code !== 0) {reject(new Error(`Suite refused: ${suite.id}`)); return;}
      try {resolve({id: suite.id, ...JSON.parse(output)});} catch {reject(new Error('Invalid suite summary'));}
    });
  });
}
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1048576}).trim();
async function proof() {
  assert.equal(git('status', '--porcelain'), '', 'Proof requires a clean committed checkout');
  assert.ok(process.env.TEST_DATABASE_URL && process.env.MAILPIT_TEST_URL && process.env.MAILPIT_TEST_SMTP_PORT, 'Use scripts/test-postgres.mjs');
  const cloudHead = git('rev-parse', 'HEAD'), cloudTree = git('rev-parse', 'HEAD^{tree}'), results = [];
  for (const suite of suites) {
    process.stderr.write(`Free-service proof: ${suite.id}\n`);
    results.push(await runSuite(suite));
  }
  assert.equal(git('rev-parse', 'HEAD'), cloudHead); assert.equal(git('status', '--porcelain'), '');
  const receipt = {version: 1, kind: 'test-cloud-free-services', cloudHead, cloudTree, scope: 'local-fixtures', relay: 'local-proof', translation: 'fake-loopback', deployedTranslation: 'off', waitronRelay: 'not-qualified', waitronTranslation: 'not-qualified', suites: results};
  validateFreeServiceReceipt(receipt);
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 2) process.stdout.write(JSON.stringify(await proof()) + '\n');
    else {
      assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--suite');
      const suite = suites.find(value => value.id === process.argv[3]); assert.ok(suite);
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      try {
        process.stdout.write(JSON.stringify(await summariseTestRun(run({files: suite.files, concurrency: 1, timeout: 120000, execArgv: [], signal: controller.signal}))) + '\n');
      } finally {process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);}
    }
  } catch {process.stderr.write('Free-service proof failed\n'); process.exitCode = 1;}
}
