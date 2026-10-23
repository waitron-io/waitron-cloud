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
for (const name of (await readdir(new URL('modules/observability/', import.meta.url)).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(name => name.endsWith('.tf'))) {
  documents[name] = await readFile(new URL(`modules/observability/${name}`, import.meta.url), 'utf8');
}
const container = `cloud-aws-observability-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-observability-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-observability-syntax'], container);
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
test('regional evidence sources have encrypted finite log destinations', () => {
  const groups = resources.find(([kind]) => kind === 'aws_cloudwatch_log_group')?.[2];
  assert.ok(groups, 'Infrastructure must declare its own primary log groups');
  assert.equal(groups.kms_key_id, '${var.kms_key_arn}');
  assert.equal(groups.retention_in_days, '${var.retention.operational_days}');
  assert.ok(resources.some(([kind]) => kind === 'aws_flow_log'));
  assert.ok(resources.some(([kind]) => kind === 'aws_cloudtrail'));
});
test('only infrastructure evidence and operator signal resources are declared', () => {
  const allowed = new Set(['aws_cloudwatch_log_group', 'aws_cloudtrail', 'aws_s3_bucket',
    'aws_s3_bucket_versioning', 'aws_s3_bucket_ownership_controls', 'aws_s3_bucket_public_access_block',
    'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_lifecycle_configuration',
    'aws_s3_bucket_policy', 'aws_iam_role', 'aws_iam_role_policy', 'aws_flow_log',
    'aws_sns_topic', 'aws_sns_topic_policy', 'aws_budgets_budget', 'aws_cloudwatch_metric_alarm']);
  assert.ok(resources.length > 0);
  for (const [kind] of resources) assert.ok(allowed.has(kind), kind);
  assert.deepEqual(blocks('data').map(([kind]) => kind).sort(), ['aws_caller_identity', 'aws_region']);
  assert.equal(Object.values(parsed).flatMap(doc => doc.module ?? []).length, 0);
});
test('evidence bucket refuses ordinary destruction and no force deletion', () => {
  const bucket = resources.find(([kind]) => kind === 'aws_s3_bucket')?.[2];
  assert.equal(bucket?.lifecycle?.[0].prevent_destroy, true);
  assert.equal(bucket?.force_destroy, false);
});
test('flow delivery binds to its own group and emits only network metadata fields', () => {
  const flow = resources.find(([kind]) => kind === 'aws_flow_log')?.[2];
  assert.equal(flow?.log_destination, '${aws_cloudwatch_log_group.operational["vpc"].arn}');
  assert.equal(flow?.iam_role_arn, '${aws_iam_role.flow.arn}');
  assert.equal(JSON.parse(flow?.log_format ?? 'null'), '$${version} $${account-id} $${interface-id} $${srcaddr} $${dstaddr} $${srcport} $${dstport} $${protocol} $${packets} $${bytes} $${start} $${end} $${action} $${log-status}');
});
test('regional evidence, source permissions and refusal plans execute through the fixed offline entry point', async () => {
  assert.match(await runSuite('observability'), /Isolated suite aggregate: Success! 27 passed, 0 failed/);
});
