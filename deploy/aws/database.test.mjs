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
for (const name of (await readdir(new URL('modules/database/', import.meta.url))).filter(name => name.endsWith('.tf'))) {
  documents[name] = await readFile(new URL(`modules/database/${name}`, import.meta.url), 'utf8');
}
const container = `cloud-aws-database-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-database-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-database-syntax'], container);
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
const database = resources.find(([kind]) => kind === 'aws_db_instance')?.[2];
const backup = resources.find(([kind]) => kind === 'aws_db_instance_automated_backups_replication')?.[2];

// Deleting either lifecycle guard must fail independently of the planned values.
for (const [name, body] of [['database', database], ['regional backup', backup]]) {
  test(`${name} cannot be destroyed through an ordinary configuration change`, () => {
    assert.equal(body?.lifecycle?.[0].prevent_destroy, true);
  });
}
test('no_warm_secondary: only one primary database and a cold backup are declared', () => {
  assert.deepEqual(resources.map(([kind]) => kind).sort(), [
    'aws_db_instance', 'aws_db_instance_automated_backups_replication', 'aws_db_parameter_group',
    'aws_db_subnet_group', 'aws_security_group', 'aws_vpc_security_group_ingress_rule',
  ]);
  for (const [, , body] of resources) {
    assert.equal(body.count, undefined);
    assert.equal(body.for_each, undefined);
  }
  assert.equal(database.provider, undefined);
  assert.equal(backup.provider, '${aws.backup}');
  assert.deepEqual(blocks('data').map(([kind]) => kind).sort(), [
    'aws_availability_zones', 'aws_caller_identity', 'aws_caller_identity', 'aws_region', 'aws_region',
  ]);
});
test('regional provider bindings match their primary and cold-copy identity checks', () => {
  const data = Object.fromEntries(blocks('data').map(([kind, name, body]) => [`${kind}.${name}`, body]));
  for (const kind of ['aws_region', 'aws_caller_identity']) {
    assert.equal(data[`${kind}.primary`].provider, undefined);
    assert.equal(data[`${kind}.backup`].provider, '${aws.backup}');
  }
});
test('database plans preserve private Multi-AZ PostgreSQL, encrypted cold copies and input refusals', async () => {
  assert.match(await runSuite('database'), /Success! 27 passed, 0 failed/);
});
