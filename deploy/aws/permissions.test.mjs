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
for (const name of (await readdir(new URL('modules/workload-permissions/', import.meta.url))).filter(name => name.endsWith('.tf'))) {
  documents[name] = await readFile(new URL(`modules/workload-permissions/${name}`, import.meta.url), 'utf8');
}
const container = `cloud-aws-permissions-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-permissions-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-permissions-syntax'], container);
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
test('runtime permissions declare only per-cell identity and inline scoped policies', () => {
  assert.deepEqual(resources.map(([kind, name]) => `${kind}.${name}`).sort(), [
    'aws_iam_openid_connect_provider.cell', 'aws_iam_role.workload', 'aws_iam_role_policy.recovery',
    'aws_iam_role_policy.replication', 'aws_iam_role_policy.runtime',
  ]);
  assert.deepEqual(blocks('data').map(([kind]) => kind).sort(), ['aws_caller_identity', 'aws_region']);
  const variables = Object.values(parsed).flatMap(doc => doc.variable ?? []).flatMap(block => Object.keys(block).filter(key => key !== '__is_block__').map(key => JSON.parse(key)));
  assert.deepEqual(variables.sort(), ['cell_name', 'custody_refs', 'database_refs', 'namespace', 'oidc_issuer', 'prefixes', 'recovery_role_arn', 'role_names', 'scope', 'storage_refs']);
});
test('workload names include the scope and cell and cannot collide across cells', () => {
  assert.equal(resources.find(([kind]) => kind === 'aws_iam_role')?.[2].name, '"waitron-${var.scope}-${var.cell_name}-${each.key}"');
});
