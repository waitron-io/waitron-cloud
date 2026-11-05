import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32, deflateRawSync} from 'node:zlib';
import test from 'node:test';
import {reuseProof} from './fixtures/ci-evidence.mjs';
const evidence = await import('./ci-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/ci-evidence.mjs')) return {};
  throw error;
});

const ci = '.github/workflows/ci.yml';
const rootSkip = 'root (${{ matrix.shard }}/4)';
const packageSkip = "package (${{ matrix.package }}${{ ((matrix.shards && format(', shard {0}/{1}', matrix.shard, matrix.shards)) || '') }})";
const sha = digit => digit.repeat(40);
const selected = {packages: [{package: '@waitron-cloud/operations', shard: 1}], receipts: [], typecheck: true, reuse: null};
const source = () => ({version: 1, repository: 'waitron-io/waitron-cloud', repositoryId: 123, pr: 51,
  event: {name: 'pull_request', number: 51, base: {sha: sha('a'), ref: 'main', repositoryId: 123, repository: 'waitron-io/waitron-cloud'},
    head: {sha: sha('b'), ref: 'feature', repositoryId: 123, repository: 'waitron-io/waitron-cloud'}, mergeBase: sha('a'), sha: sha('d')},
  checkout: {sha: sha('b'), tree: sha('c')},
  workflow: {id: 17, path: ci, ref: 'waitron-io/waitron-cloud/.github/workflows/ci.yml@refs/pull/51/merge', sha: sha('d'), executionSha: sha('d')},
  runId: 42, attempt: 2, selection: structuredClone(selected)});
const expectedSelected = ['changes', 'typecheck', 'root (1/4)', 'root (2/4)', 'root (3/4)', 'root (4/4)', 'package (@waitron-cloud/operations)', 'summary'];

test('contracts require exact scoped jobs and all unselected placeholders', () => {
  assert.equal(typeof evidence.expectedJobContract, 'function', 'Missing complete job contracts');
  assert.deepEqual(evidence.expectedJobContract(ci, selected), {required: expectedSelected, skipped: ['scripts', 'documentation', 'receipts']});
  for (const [field, value, required, skipped] of [
    ['documentation', {base: sha('a'), head: sha('b'), paths: ['README.md']}, ['changes', 'documentation', 'summary'], ['scripts', 'typecheck', rootSkip, packageSkip, 'receipts']],
    ['scripts', {base: sha('a'), head: sha('b'), paths: ['scripts/identity-upstream.mjs']}, ['changes', 'scripts', 'summary'], ['documentation', 'typecheck', rootSkip, packageSkip, 'receipts']],
  ]) assert.deepEqual(evidence.expectedJobContract(ci, {packages: [], receipts: [], typecheck: false, [field]: value}), {required, skipped});
  for (const bad of [{packages: [], receipts: [], typecheck: false}, {...selected, packages: selected.packages.concat(selected.packages)},
    {...selected, packages: [{package: '@waitron-cloud/portal', shard: 1, shards: 6}]},
    {...selected, documentation: {base: sha('a'), head: sha('b'), paths: ['README.md']}},
    {...selected, receipts: ['test:local-stack', 'test:local-stack']}]) assert.throws(() => evidence.expectedJobContract(ci, bad));
  const portal = {...selected, packages: [1, 2, 3, 4, 5, 6].map(shard => ({package: '@waitron-cloud/portal', shard, shards: 6})), receipts: ['test:local-stack']};
  assert.deepEqual(evidence.expectedJobContract(ci, portal), {required: expectedSelected.slice(0, 6).concat(
    [1, 2, 3, 4, 5, 6].map(i => `package (@waitron-cloud/portal, shard ${i}/6)`), ['receipts', 'summary']), skipped: ['scripts', 'documentation']});
});

test('siblings require independent complete native matrices and reject unknown or empty scope', () => {
  const range = {base: sha('a'), head: sha('b'), paths: ['deploy/aws/main.tf'], required: true};
  assert.deepEqual(evidence.expectedJobContract('.github/workflows/aws-infrastructure.yml', range), {
    required: ['changes', 'verify (guards-1)', 'verify (guards-2)', 'verify (guards-3)', 'verify (suites)', 'summary'], skipped: []});
  assert.deepEqual(evidence.expectedJobContract('.github/workflows/download-supervision-diagnostic.yml', range), {
    required: ['changes', 'linux-contention', 'summary'], skipped: []});
  assert.deepEqual(evidence.expectedJobContract('.github/workflows/venue-services-proof.yml', range), {
    required: ['changes', 'service-receipts (legacy)', 'service-receipts (venue)', 'summary'], skipped: []});
  assert.deepEqual(evidence.expectedJobContract('.github/workflows/venue-services-proof.yml', {...range, required: false}), {
    required: ['changes', 'summary'], skipped: ['service-receipts (${{ matrix.receipt }})']});
  assert.deepEqual(evidence.expectedJobContract('.github/workflows/cloud-cost.yml', {...range, required: false}), {
    required: ['discover', 'summary'], skipped: ['cost (${{ matrix.file }}, ${{ matrix.group }})']});
  for (const workflow of ['unknown.yml', '.github/workflows/aws-infrastructure.yml', '.github/workflows/venue-services-proof.yml']) {
    for (const bad of [{}, {...range, paths: []}, {...range, head: range.base}, {...range, required: undefined}]) {
      assert.throws(() => evidence.expectedJobContract(workflow, bad));
    }
  }
});

test('attempt evidence preserves original event and workflow provenance without optional API PR associations', () => {
  const input = source();
  const recorded = evidence.createPlanEvidence(input);
  assert.deepEqual(recorded.event, input.event);
  assert.deepEqual(recorded.workflow, input.workflow);
  assert.equal(recorded.planDigest, createHash('sha256').update(evidence.canonicalJson(selected)).digest('hex'));
  assert.deepEqual(evidence.parsePlanEvidence(Buffer.from(JSON.stringify(recorded))), recorded);
  for (const mutate of [s => delete s.event, s => s.event.number++, s => s.event.head.sha = sha('e'),
    s => s.workflow.executionSha = sha('e'), s => s.workflow.ref = 'outsider/fork/.github/workflows/ci.yml@refs/pull/51/merge',
    s => s.workflow.sha = sha('0'), s => s.checkout.tree = sha('0'), s => s.repositoryId = 0,
    s => s.version = 2, s => s.attempt = 0, s => s.selection = {}, s => s.runId = '42']) {
    const bad = source(); mutate(bad);
    assert.throws(() => evidence.createPlanEvidence(bad));
  }
  const corrupt = {...recorded, selection: {...selected, receipts: ['test:local-stack']}};
  assert.throws(() => evidence.parsePlanEvidence(Buffer.from(JSON.stringify(corrupt))), /digest/i);
  for (const bytes of [Buffer.from('{'), Buffer.alloc(256 * 1024 + 1), Buffer.from('null'), Buffer.from([0xff])]) {
    assert.throws(() => evidence.parsePlanEvidence(bytes));
  }
  assert.equal(evidence.canonicalJson({z: [2, 1], a: {c: true, b: null}}), '{"a":{"b":null,"c":true},"z":[2,1]}');
  for (const value of [undefined, NaN, {a: undefined}, {a: Infinity}, new Date(), [, 1]]) assert.throws(() => evidence.canonicalJson(value));
});

test('source jobs require completed source summary, exact identity, complete skips and unique names and IDs', () => {
  const input = evidence.createPlanEvidence(source());
  const contract = evidence.expectedJobContract(ci, selected);
  const jobs = [...expectedSelected.map(name => ({name, conclusion: 'success'})),
    ...['scripts', 'documentation', 'receipts'].map(name => ({name, conclusion: 'skipped'}))]
    .map((job, i) => ({...job, id: i + 1, run_id: 42, run_attempt: 2, head_sha: sha('b'), status: 'completed'}));
  assert.doesNotThrow(() => evidence.assertSourceEvidence(input, selected, jobs, contract));
  for (let i = 0; i < jobs.length; i++) {
    assert.throws(() => evidence.assertSourceEvidence(input, selected, jobs.filter((_, j) => j !== i), contract));
    assert.throws(() => evidence.assertSourceEvidence(input, selected, jobs.concat(jobs[i]), contract));
  }
  for (const change of [{id: 0}, {id: 1}, {run_id: 43}, {run_attempt: 1}, {head_sha: sha('a')},
    {name: 'unknown'}, {status: 'in_progress'}, {conclusion: 'cancelled'}, {conclusion: 'failure'}, {conclusion: 'skipped'}]) {
    assert.throws(() => evidence.assertSourceEvidence(input, selected, jobs.map((j, i) => i === 1 ? {...j, ...change} : j), contract));
  }
  assert.throws(() => evidence.assertSourceEvidence(input, selected, jobs.map((j, i) => i === 1 ? {...j, name: 'changes'} : j), contract));
  assert.throws(() => evidence.assertSourceEvidence(input, selected, jobs.map((j, i) => i === jobs.length - 1 ? {...j, name: 'unknown-skipped'} : j), contract));
  const summary = jobs.findIndex(j => j.name === 'summary');
  assert.throws(() => evidence.assertSourceEvidence(input, selected, jobs.map((j, i) => i === summary ? {...j, status: 'in_progress', conclusion: null} : j), contract));
  assert.throws(() => evidence.assertSourceEvidence(input, {...selected, receipts: ['test:local-stack']}, jobs, contract));
  assert.throws(() => evidence.assertSourceEvidence(input, {...selected, reason: 'different original selection'}, jobs, contract));
  assert.throws(() => evidence.assertSourceEvidence(input, selected, jobs, {required: ['changes'], skipped: []}));
});

test('cost contracts use the complete native matrix and refuse omitted or invented cells', async () => {
  const {conformanceMatrix} = await import('./cloud-cost/conformance.mjs');
  const matrix = conformanceMatrix();
  const range = {base: sha('a'), head: sha('b'), paths: ['scripts/cloud-cost/cli.mjs'], required: true, matrix};
  const contract = evidence.expectedJobContract('.github/workflows/cloud-cost.yml', range);
  assert.equal(contract.required.length, 2 + matrix.length);
  for (const name of ['cost (stack-conformance.test.mjs, 1/3)', 'cost (stack-conformance.test.mjs, 2/3)',
    'cost (stack-conformance.test.mjs, 3/3)', 'cost (isolated-replay-conformance.test.mjs, 3/3)', 'discover', 'summary']) {
    assert.ok(contract.required.includes(name), name);
  }
  for (const bad of [matrix.slice(1), matrix.concat(matrix[0]), [{file: 'forged.test.mjs', group: '1/1'}], undefined]) {
    assert.throws(() => evidence.expectedJobContract('.github/workflows/cloud-cost.yml', {...range, matrix: bad}));
  }
});

test('capturing evidence uses exact checkout and original event even when API associations are empty', () => {
  assert.equal(typeof evidence.capturePlanEvidence, 'function', 'Missing original-event evidence capture');
  const s = source();
  const repo = {id: 123, full_name: 'waitron-io/waitron-cloud'};
  const event = {number: 51, pull_request: {number: 51,
    base: {sha: sha('a'), ref: 'main', repo}, head: {sha: sha('b'), ref: 'feature', repo}}};
  const context = {repository: repo.full_name, repositoryId: repo.id, sha: sha('d'), eventName: 'pull_request',
    runId: 42, attempt: 2, workflowId: 17, workflowPath: ci, workflowRef: s.workflow.ref, workflowSha: sha('d')};
  const git = (...args) => {
    const key = args.join(' ');
    if (key === 'rev-parse HEAD') return sha('b') + '\n';
    if (key === `rev-parse ${sha('b')}^{tree}`) return sha('c') + '\n';
    if (key === `merge-base ${sha('a')} ${sha('b')}`) return sha('a') + '\n';
    throw Error('Unexpected Git read: ' + key);
  };
  assert.deepEqual(evidence.capturePlanEvidence(event, context, selected, git), evidence.createPlanEvidence(s));
  assert.throws(() => evidence.capturePlanEvidence(event, {...context, eventName: 'push'}, selected, git));
  assert.throws(() => evidence.capturePlanEvidence(event, context, selected, (...args) => args[1] === 'HEAD' ? sha('d') : git(...args)));
});

function zipMember(bytes, {name = 'plan.json', extra = false, mode = 0o100644, method = 0, flags = 0, trailing = Buffer.alloc(0)} = {}) {
  const rawName = Buffer.from(name);
  const data = method === 8 ? deflateRawSync(bytes) : bytes;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(bytes), 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(rawName.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(bytes), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(rawName.length, 28); central.writeUInt32LE((mode * 65536) >>> 0, 38);
  const body = Buffer.concat([local, rawName, data]);
  const index = Buffer.concat([central, rawName, ...(extra ? [central, rawName] : [])]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(extra ? 2 : 1, 8);
  end.writeUInt16LE(extra ? 2 : 1, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, index, end, trailing]);
}

test('artifact admission binds attempt, name, size and digest and decodes only one regular bounded JSON member', () => {
  assert.equal(typeof evidence.readPlanArtifact, 'function', 'Missing bounded artifact decoder');
  const s = evidence.createPlanEvidence(source());
  const bytes = Buffer.from(JSON.stringify(s));
  const zip = zipMember(bytes);
  const artifact = archive => ({id: 61, name: 'ci-plan-v1-ci-42-2', expired: false, size_in_bytes: archive.length,
    digest: 'sha256:' + createHash('sha256').update(archive).digest('hex'),
    workflow_run: {id: 42, head_sha: sha('b'), repository_id: 123, head_repository_id: 123}});
  for (const archive of [zip, zipMember(bytes, {method: 8})]) {
    assert.deepEqual(evidence.readPlanArtifact(artifact(archive), archive, {workflowPath: ci, runId: 42, attempt: 2, head: sha('b'), repositoryId: 123}), s);
  }
  const identity = {workflowPath: ci, runId: 42, attempt: 2, head: sha('b'), repositoryId: 123};
  for (const change of [{id: 0}, {name: 'ci-plan-v1-ci-42-1'}, {expired: true}, {size_in_bytes: zip.length - 1},
    {digest: 'sha256:' + 'a'.repeat(64)}, {workflow_run: {...artifact(zip).workflow_run, id: 43}},
    {workflow_run: {...artifact(zip).workflow_run, head_sha: sha('d')}},
    {workflow_run: {...artifact(zip).workflow_run, head_repository_id: 124}}]) {
    assert.throws(() => evidence.readPlanArtifact({...artifact(zip), ...change}, zip, identity));
  }
  for (const archive of [zipMember(bytes, {name: '../plan.json'}), zipMember(bytes, {extra: true}),
    zipMember(bytes, {mode: 0o120777}), zipMember(bytes, {flags: 1}), zipMember(bytes, {method: 99}),
    zipMember(bytes, {trailing: Buffer.from('surprise')}), zip.subarray(0, -1), Buffer.alloc(0),
    zipMember(Buffer.alloc(256 * 1024 + 1), {method: 8}), zipMember(Buffer.from('{'))]) {
    assert.throws(() => evidence.readPlanArtifact(artifact(archive), archive, identity));
  }
  const corrupted = Buffer.from(zip); corrupted[30 + 'plan.json'.length + bytes.indexOf('feature')] ^= 0x20;
  assert.throws(() => evidence.readPlanArtifact(artifact(corrupted), corrupted, identity));
});

test('evidence writer publishes original-event JSON from a real head checkout and refuses partial publication', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-plan-evidence-'));
  const git = (...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {cwd: root, encoding: 'utf8'}).trim();
  const script = fileURLToPath(new URL('./ci-evidence.mjs', import.meta.url));
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
    writeFileSync(join(root, 'README.md'), 'First\n'); git('add', '.'); git('commit', '-sm', 'First');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'README.md'), 'Second\n'); git('add', '.'); git('commit', '-sm', 'Second');
    const head = git('rev-parse', 'HEAD');
    const repo = {id: 123, full_name: 'waitron-io/waitron-cloud'};
    const eventFile = join(root, 'event.json');
    writeFileSync(eventFile, JSON.stringify({number: 51, pull_request: {number: 51,
      base: {sha: base, ref: 'main', repo}, head: {sha: head, ref: 'feature', repo}}}));
    const env = {...process.env, GITHUB_EVENT_PATH: eventFile, GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: sha('d'),
      GITHUB_REPOSITORY: repo.full_name, GITHUB_REPOSITORY_ID: '123', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2',
      GITHUB_WORKFLOW_REF: 'waitron-io/waitron-cloud/.github/workflows/ci.yml@refs/pull/51/merge', GITHUB_WORKFLOW_SHA: sha('d'),
      CI_WORKFLOW_ID: '17', CI_PLAN: JSON.stringify(selected), GITHUB_OUTPUT: join(root, 'outputs')};
    delete env.NODE_TEST_CONTEXT;
    const run = overrides => spawnSync(process.execPath, [script, '--write', join(root, 'plan.json')],
      {cwd: root, env: {...env, ...overrides}, encoding: 'utf8', timeout: 5000});
    const first = run({});
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal(existsSync(join(root, 'plan.json')), true, 'Writer must publish the source plan');
    const recorded = evidence.parsePlanEvidence(readFileSync(join(root, 'plan.json')));
    assert.equal(recorded.event.base.sha, base); assert.equal(recorded.checkout.sha, head);
    assert.equal(recorded.checkout.tree, git('rev-parse', 'HEAD^{tree}'));
    assert.equal(readFileSync(join(root, 'outputs'), 'utf8'), 'artifact_name=ci-plan-v1-ci-42-2\n');
    assert.notEqual(run({}).status, 0, 'Existing evidence must not be overwritten');
    unlinkSync(join(root, 'plan.json'));
    for (const overrides of [{CI_WORKFLOW_ID: ''}, {GITHUB_EVENT_NAME: 'push'}, {GITHUB_RUN_ATTEMPT: '0'}, {CI_PLAN: '{}'}]) {
      const result = run(overrides);
      assert.notEqual(result.status, 0, JSON.stringify(overrides));
      assert.equal(existsSync(join(root, 'plan.json')), false, 'Invalid evidence must not be published');
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('archive data descriptors and malformed local or directory records cannot bypass member checks', () => {
  const s = evidence.createPlanEvidence(source());
  const bytes = Buffer.from(JSON.stringify(s));
  const original = zipMember(bytes, {method: 8});
  const originalDirectory = original.readUInt32LE(original.length - 6);
  const body = Buffer.from(original.subarray(0, originalDirectory));
  body.writeUInt16LE(8, 6); body.fill(0, 14, 26);
  const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50);
  descriptor.writeUInt32LE(crc32(bytes), 4); descriptor.writeUInt32LE(original.readUInt32LE(18), 8); descriptor.writeUInt32LE(bytes.length, 12);
  const directory = Buffer.from(original.subarray(originalDirectory, -22)); directory.writeUInt16LE(8, 8);
  const end = Buffer.from(original.subarray(-22)); end.writeUInt32LE(body.length + 16, 16);
  const archive = Buffer.concat([body, descriptor, directory, end]);
  const identity = {workflowPath: ci, runId: 42, attempt: 2, head: sha('b'), repositoryId: 123};
  const meta = bytes => ({id: 61, name: 'ci-plan-v1-ci-42-2', expired: false, size_in_bytes: bytes.length,
    digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    workflow_run: {id: 42, head_sha: sha('b'), repository_id: 123, head_repository_id: 123}});
  assert.deepEqual(evidence.readPlanArtifact(meta(archive), archive, identity), s);
  const offset = body.length + 16;
  for (const [at, width, value] of [[0, 4, 0], [6, 2, 1], [8, 2, 0], [26, 2, 1], [30, 1, 0],
    [body.length + 4, 4, 0], [body.length + 8, 4, 1], [body.length + 12, 4, 1],
    [offset + 34, 2, 1], [offset + 42, 4, 1], [archive.length - 18, 2, 1]]) {
    const corrupted = Buffer.from(archive); corrupted.writeUIntLE(value, at, width);
    assert.throws(() => evidence.readPlanArtifact(meta(corrupted), corrupted, identity), `${at}:${width}`);
  }
  const wrongAttempt = evidence.createPlanEvidence({...source(), attempt: 1});
  const wrongBytes = zipMember(Buffer.from(JSON.stringify(wrongAttempt)));
  assert.throws(() => evidence.readPlanArtifact(meta(wrongBytes), wrongBytes, identity));
});


test('native reuse cannot also claim a full invocation', () => {
  for (const key of ['aws-infrastructure', 'cloud-cost', 'venue-services-proof', 'download-supervision-diagnostic']) {
    const path = `.github/workflows/${key}.yml`, proof = {...reuseProof(), workflowPath: path};
    assert.doesNotThrow(() => evidence.expectedJobContract(path, {required: false, reuse: proof}));
    assert.throws(() => evidence.expectedJobContract(path, {required: false, reuse: proof, full: true}), /Reused sibling cannot be a full invocation/);
  }
});
