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
for (const scope of ['global', 'country']) {
  for (const name of (await readdir(new URL(`roots/${scope}/`, import.meta.url))).filter(name => name.endsWith('.tf'))) {
    documents[`${scope}/${name}`] = await readFile(new URL(`roots/${scope}/${name}`, import.meta.url), 'utf8');
  }
}
const container = `cloud-aws-bindings-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-bindings=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-bindings'], container);
    await execute('docker', ['container', 'rm', '--force', record.Id], options);
  }
}
function entries(scope, kind) {
  return Object.entries(parsed).filter(([path]) => path.startsWith(scope + '/')).flatMap(([, doc]) => doc[kind] ?? []);
}

// A mock skips actual provider authentication, so inspect the real parsed
// provider configuration as well as planning the identity refusals.
for (const [scope, primary, backup] of [['global', 'eu-central-1', 'eu-west-1'], ['country', 'eu-south-2', 'eu-west-3']]) {
  const names = [scope, `${scope}_backup`, `${scope}_keys`, `${scope}_backup_keys`];
  test(`${scope} has exactly four explicit aliases and no ambient provider`, () => {
    const providers = entries(scope, 'provider');
    assert.deepEqual(providers.map(entry => Object.keys(entry).filter(k => k !== '__is_block__')), Array.from({ length: 4 }, () => ['"aws"']));
    assert.deepEqual(providers.map(entry => JSON.parse(entry['"aws"'].alias)).sort(), [...names].sort());
  });
  for (const name of names) {
    test(`${name} assumes its exact protected external role and pins the account`, () => {
      const provider = entries(scope, 'provider').map(entry => entry['"aws"']).find(body => body.alias === JSON.stringify(name));
      assert.equal(provider.region, JSON.stringify(name.includes('backup') ? backup : primary));
      assert.deepEqual(provider.assume_role?.map(body => body.role_arn), [`\${try(var.bindings["${name}"].role_arn, "")}`]);
      assert.deepEqual(provider.allowed_account_ids, [`\${try(var.bindings["${name}"].expected_identity, "")}`]);
      assert.equal(provider.profile, undefined);
      assert.equal(provider.access_key, undefined);
      assert.equal(provider.secret_key, undefined);
      assert.equal(provider.token, undefined);
    });
    test(`${name} account and region reads use that same explicit alias`, () => {
      const data = entries(scope, 'data').flatMap(entry => Object.entries(entry).filter(([type]) => type !== '__is_block__')
        .flatMap(([type, bodies]) => Object.entries(bodies).filter(([key]) => key !== '__is_block__').map(([key, body]) => [JSON.parse(type), JSON.parse(key), body])));
      for (const kind of ['aws_caller_identity', 'aws_region']) {
        assert.equal(data.find(([type, key]) => type === kind && key === name)?.[2].provider, `\${aws.${name}}`);
      }
    });
  }
  test(`${scope} keeps every live backend setting outside the repository`, () => {
    const backends = entries(scope, 'terraform').flatMap(body => body.backend ?? []);
    assert.equal(backends.length, 1);
    assert.deepEqual(Object.keys(backends[0]), ['"s3"']);
    assert.deepEqual(Object.keys(backends[0]['"s3"']).filter(key => key !== '__is_block__'), []);
  });
  test(`${scope} admission inputs cannot be null or silently default to ambient bindings`, () => {
    for (const name of ['deployment', 'bindings']) {
      const variable = entries(scope, 'variable').find(body => body[JSON.stringify(name)])?.[JSON.stringify(name)];
      assert.equal(variable?.nullable, false);
      assert.equal(variable?.default, undefined);
    }
  });
}

// A missing root case or a runner that silently skips one must fail the receipt.
test('both independent roots execute every scope, role and actual-provider refusal', async () => {
  const result = await runSuite('integration');
  assert.deepEqual([...result.matchAll(/Isolated suite aggregate: Success! ([0-9]+) passed, 0 failed\./g)].map(match => Number(match[1])), [29, 29]);
  assert.equal((result.match(/run "primary_cells_use_their_exact_network_entries"\.\.\. pass/g) ?? []).length, 2);
  for (const scope of ['global', 'country']) {
    assert.ok(result.includes('run "rejects_foreign_operator_account_before_cell_reads"... pass'));
    for (const alias of [scope, `${scope}_backup`, `${scope}_keys`, `${scope}_backup_keys`]) {
      assert.ok(result.includes(`run "rejects_actual_${alias}_account"... pass`));
      assert.ok(result.includes(`run "rejects_actual_${alias}_region"... pass`));
    }
  }
});
