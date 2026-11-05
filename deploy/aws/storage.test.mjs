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
for (const name of (await readdir(new URL('modules/storage/', import.meta.url))).filter(name => name.endsWith('.tf'))) {
  documents[name] = await readFile(new URL(`modules/storage/${name}`, import.meta.url), 'utf8');
}
const container = `cloud-aws-storage-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-storage-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-storage-syntax'], container);
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
const buckets = resources.filter(([kind]) => kind === 'aws_s3_bucket');
for (const side of ['primary', 'backup']) {
  test(`${side} storage refuses ordinary destruction and preserves region bindings`, () => {
    assert.equal(buckets.find(([, name]) => name === side)?.[2].lifecycle?.[0].prevent_destroy, true);
    for (const [kind, name, body] of resources.filter(([, name]) => name === side)) {
      assert.equal(body.provider, side === 'backup' ? '${aws.backup}' : undefined);
      if (kind !== 'aws_s3_bucket') assert.equal(body.bucket, '${aws_s3_bucket.' + side + '[each.key].bucket}');
    }
  });
}
test('storage declares only two stores per region and no secret values or Object Lock resources', () => {
  assert.deepEqual(resources.map(([kind, name]) => `${kind}.${name}`).sort(), [
    ...['aws_s3_bucket', 'aws_s3_bucket_versioning', 'aws_s3_bucket_public_access_block',
      'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_lifecycle_configuration',
      'aws_s3_bucket_policy'].flatMap(kind => ['primary', 'backup'].map(side => `${kind}.${side}`)),
    'aws_s3_bucket_replication_configuration.cold',
  ].sort());
  for (const [, , body] of resources) {
    assert.equal(body.for_each, '${local.kinds}');
    assert.equal(body.count, undefined);
  }
  assert.deepEqual(blocks('data').map(([kind]) => kind).sort(), [
    'aws_caller_identity', 'aws_caller_identity', 'aws_region', 'aws_region',
  ]);
});
test('replication starts after both version histories, encryption configurations and destination policy exist', () => {
  const body = resources.find(([kind]) => kind === 'aws_s3_bucket_replication_configuration')[2];
  assert.deepEqual(body.depends_on, [
    '${aws_s3_bucket_versioning.primary}', '${aws_s3_bucket_versioning.backup}',
    '${aws_s3_bucket_server_side_encryption_configuration.primary}', '${aws_s3_bucket_server_side_encryption_configuration.backup}',
    '${aws_s3_bucket_policy.backup}',
  ]);
});
test('storage plans retain encrypted version histories and exact country-only replication boundaries', async () => {
  assert.match(await runSuite('storage'), /Success! 24 passed, 0 failed/);
});
