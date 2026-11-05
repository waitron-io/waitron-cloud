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
for (const directory of ['modules/state', 'roots/state']) {
  for (const name of (await readdir(new URL(`${directory}/`, import.meta.url))).filter(name => name.endsWith('.tf'))) {
    const path = `${directory}/${name}`;
    documents[path] = await readFile(new URL(path, import.meta.url), 'utf8');
  }
}

// Parse declarations without evaluating them or launching OpenTofu.
const container = `cloud-aws-state-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-state-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-state-syntax'], container);
    await execute('docker', ['container', 'rm', '--force', record.Id], options);
  }
}

function blocks(doc, kind) {
  return (doc[kind] ?? []).flatMap(entry => Object.entries(entry)
    .filter(([key]) => key !== '__is_block__')
    .map(([key, body]) => [JSON.parse(key), body]));
}
const resources = Object.fromEntries(blocks(parsed['modules/state/main.tf'], 'resource'));
for (const [kind, name] of [['aws_s3_bucket', 'state'], ['aws_kms_key', 'state']]) {
  test(`${kind} destruction is prevented by its actual lifecycle declaration`, () => {
    assert.equal(resources[kind][JSON.stringify(name)].lifecycle?.[0].prevent_destroy, true);
  });
}
test('the state root keeps backend settings external and binds only its explicit provider', () => {
  const terraform = parsed['roots/state/versions.tf'].terraform[0];
  assert.deepEqual(terraform.backend, [{ '"s3"': { __is_block__: true } }]);
  const module = Object.fromEntries(blocks(parsed['roots/state/main.tf'], 'module')).state;
  assert.deepEqual(module.providers, { aws: '${aws.state}' });
  const providers = blocks(parsed['roots/state/providers.tf'], 'provider');
  assert.equal(providers.length, 1);
  assert.equal(providers[0][1].alias, '"state"');
  assert.equal(providers[0][1].region, '${var.home_region}');
});
test('bucket keys are explicitly disabled to preserve per-object KMS contexts', () => {
  assert.equal(resources.aws_s3_bucket_server_side_encryption_configuration['"state"'].rule[0].bucket_key_enabled, false);
});
test('state custody never reads secret values or deletes versions by age', () => {
  assert.deepEqual(Object.keys(resources).sort(), ['aws_kms_key', 'aws_s3_bucket', 'aws_s3_bucket_policy', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_versioning']);
  assert.deepEqual(blocks(parsed['modules/state/main.tf'], 'data').map(([name]) => name).sort(), ['aws_caller_identity', 'aws_region']);
});
test('state examples contain only explicitly synthetic identities and no credentials', async () => {
  for (const directory of ['modules/state', 'roots/state']) {
    const fixture = await readFile(new URL(`${directory}/tests/state.tftest.hcl`, import.meta.url), 'utf8');
    const ids = [...fixture.matchAll(/arn:aws:[^:]+:[^:]*:([0-9]{12}):|account_id\s*=\s*"([0-9]{12})"|expected_account_id\s*=\s*"([0-9]{12})"/g)].map(match => match[1] ?? match[2] ?? match[3]);
    assert.ok(ids.length > 0);
    assert.ok(ids.every(id => ['111111111111', '222222222222', '333333333333'].includes(id)));
    assert.doesNotMatch(fixture, /(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN|password\s*=|secret_access_key|access_key\s*=/);
  }
});

test('real state plans disable backend access and retain the committed provider lock', async () => {
  const output = await runSuite('state', { execute: async (file, args, options) => {
    if (args[0] === 'run' && args.at(-1) === '/candidate/run.py') {
      const observe = `import subprocess, runpy
from pathlib import Path
original = subprocess.run
def observe(command, **options):
    root = Path(options['cwd'])
    lock = root / '.terraform.lock.hcl'
    checking = root.parts[-2:] == ('roots', 'state') and command[1] == 'init'
    if command[1] == 'init':
        assert command == ['tofu', 'init', '-backend=false', '-input=false', '-no-color'], 'backend must stay disabled'
    before = lock.read_bytes() if checking and lock.exists() else None
    result = original(command, **options)
    if checking:
        print('STATE_LOCK_UNCHANGED=' + str(before is not None and before == lock.read_bytes()), flush=True)
    return result
subprocess.run = observe
runpy.run_path('/candidate/run.py', run_name='__main__')
`;
      args = [...args.slice(0, -3), 'python', '-I', '-c', observe];
    }
    return execute(file, args, options);
  } });
  assert.match(output, /Success! 30 passed, 0 failed/);
  assert.match(output, /Success! 3 passed, 0 failed/);
  assert.match(output, /STATE_LOCK_UNCHANGED=True/);
});
