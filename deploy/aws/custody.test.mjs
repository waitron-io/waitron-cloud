import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { toolsImage } from './tools.mjs';
import { runSuite } from './check.mjs';

const execute = promisify(execFile);
const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };
const documents = {};
for (const name of (await readdir(new URL('modules/custody/', import.meta.url))).filter(name => name.endsWith('.tf'))) {
  documents[name] = await readFile(new URL(`modules/custody/${name}`, import.meta.url), 'utf8');
}
const container = `cloud-aws-custody-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-custody-syntax=${container}`,
    '--pull', 'never', '--network', 'none', '--user', '65532:65532', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
    '--memory', '256m', '--cpus', '1', '--pids-limit', '32', toolsImage,
    'python', '-I', '-c',
    'import hcl2,json,sys; print(json.dumps({k:hcl2.loads(v) for k,v in json.loads(sys.argv[1]).items()}))',
    JSON.stringify(documents),
  ], options);
  parsed = JSON.parse(result.stdout);
} finally {
  let result;
  try {
    result = await execute('docker', ['container', 'inspect', container], options);
  } catch (error) {
    if (!error.stderr?.trim().endsWith(`No such container: ${container}`)
        && !error.stderr?.trim().endsWith(`No such object: ${container}`)) throw error;
  }
  if (result) {
    const [record, ...extra] = JSON.parse(result.stdout);
    assert.equal(extra.length, 0);
    assert.match(record.Id, /^[a-f0-9]{64}$/);
    assert.equal(record.Config.Labels['io.waitron.aws-custody-syntax'], container);
    await execute('docker', ['container', 'rm', '--force', record.Id], options);
  }
}
function blocks(kind) {
  return Object.values(parsed).flatMap(doc => (doc[kind] ?? []).flatMap(entry => Object.entries(entry)
    .filter(([key]) => key !== '__is_block__')
    .flatMap(([type, bodies]) => Object.entries(bodies).filter(([key]) => key !== '__is_block__')
      .map(([name, body]) => [JSON.parse(type), JSON.parse(name), body]))));
}
const resources = blocks('resource');
for (const name of ['primary', 'backup']) {
  test(`${name} key custody refuses ordinary destruction`, () => {
    assert.equal(resources.find(([kind, key]) => kind === 'aws_kms_key' && key === name)?.[2].lifecycle?.[0].prevent_destroy, true);
  });
}
test('secret shells preserve retention and their regional encryption bindings', () => {
  const secret = resources.find(([kind]) => kind === 'aws_secretsmanager_secret')?.[2];
  assert.equal(secret?.lifecycle?.[0].prevent_destroy, true);
  assert.equal(secret?.recovery_window_in_days, 30);
  assert.equal(secret?.kms_key_id, '${aws_kms_key.primary["secrets"].arn}');
  assert.equal(secret?.replica?.[0].kms_key_id, '${aws_kms_key.backup["secrets"].arn}');
  assert.equal(secret?.replica?.[0].region, '${var.region_pair.backup}');
  assert.equal(secret?.force_overwrite_replica_secret, false);
});
test('no_secret_values_in_state: custody creates metadata without reading or generating values', () => {
  assert.deepEqual(resources.map(([kind, name]) => `${kind}.${name}`).sort(), [
    'aws_iam_role.replication', 'aws_kms_key.backup', 'aws_kms_key.primary', 'aws_secretsmanager_secret.application',
  ]);
  assert.deepEqual(blocks('data').map(([kind]) => kind).sort(), ['aws_caller_identity', 'aws_caller_identity', 'aws_caller_identity', 'aws_caller_identity', 'aws_region', 'aws_region', 'aws_region', 'aws_region']);
  assert.equal(Object.values(parsed).flatMap(doc => doc.module ?? []).length, 0);
  assert.equal(resources.find(([kind, name]) => kind === 'aws_kms_key' && name === 'backup')?.[2].provider, '${aws.backup_keys}');
});
test('custody and scoped permissions compose without a cycle and retain every named refusal', async () => {
  const result = await runSuite('custody');
  const summaries = [...result.matchAll(/^(?:Isolated suite aggregate: )?Success! ([0-9]+) passed, 0 failed\.$/gm)].map(match => Number(match[1]));
  assert.equal([...result.matchAll(/Isolated suite aggregate: Success! 18 passed, 0 failed/g)].length, 2, 'custody and scope modules must each execute all 18 cases');
  for (const name of ['key_administration_keeps_only_explicit_management_actions', 'alarm_key_use_keeps_exact_account_and_sources']) {
    assert.equal(result.split(`run "${name}"... pass`).length - 1, 1, `${name} must execute once`);
  }
  assert.match(result, /Isolated suite aggregate: Success! 22 passed, 0 failed/);
  assert.match(result, /Isolated suite aggregate: Success! 18 passed, 0 failed/);
  assert.equal(summaries.at(-1), 3);
});

// Mock providers skip authentication, so the resource's parsed provider binding
// is the evidence that key management cannot fall back to deployment authority.
for (const [name, alias] of [['primary', 'keys'], ['backup', 'backup_keys']]) {
  test(`${name} key resources use the dedicated key administrator`, () => {
    assert.equal(resources.find(([kind, key]) => kind === 'aws_kms_key' && key === name)?.[2].provider, `${'${'}aws.${alias}}`);
  });
}
test('application metadata and replication trust use deployment authority', () => {
  for (const kind of ['aws_secretsmanager_secret', 'aws_iam_role']) {
    assert.equal(resources.find(([type]) => type === kind)?.[2].provider, undefined);
  }
});
for (const alias of ['keys', 'backup_keys']) {
  test(`${alias} checks the actual key administrator account and region`, () => {
    for (const type of ['aws_caller_identity', 'aws_region']) {
      assert.equal(blocks('data').find(([kind, name]) => kind === type && name === alias)?.[2].provider, `${'${'}aws.${alias}}`);
    }
  });
}
