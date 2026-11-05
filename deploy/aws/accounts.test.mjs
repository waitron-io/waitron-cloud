import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { toolsImage } from './tools.mjs';

const execute = promisify(execFile);
const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };
const documents = {};
for (const directory of ['modules/accounts', 'roots/accounts']) {
  for (const name of (await readdir(new URL(`${directory}/`, import.meta.url))).filter(name => name.endsWith('.tf'))) {
    const path = `${directory}/${name}`;
    documents[path] = await readFile(new URL(path, import.meta.url), 'utf8');
  }
}

// Parse declarations without evaluating them or launching OpenTofu.
const container = `cloud-aws-account-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-account-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-account-syntax'], container);
    await execute('docker', ['container', 'rm', '--force', record.Id], options);
  }
}

function blocks(doc, kind) {
  return (doc[kind] ?? []).flatMap(entry => Object.entries(entry)
    .filter(([key]) => key !== '__is_block__')
    .map(([key, body]) => [JSON.parse(key), body]));
}
const resource = Object.fromEntries(blocks(parsed['modules/accounts/main.tf'], 'resource'));
const member = resource.aws_organizations_account['"member"'];
const variables = Object.fromEntries(blocks(parsed['modules/accounts/variables.tf'], 'variable'));
const rootModule = Object.fromEntries(blocks(parsed['roots/accounts/main.tf'], 'module')).accounts;

test('managed account destruction is prevented by the actual lifecycle declaration', () => {
  assert.equal(member.lifecycle?.[0].prevent_destroy, true);
});
test('managed accounts explicitly refuse closing on deletion', () => {
  assert.equal(member.close_on_deletion, false);
});
test('only the non-sensitive new-member map owns resource addresses', () => {
  assert.equal(member.for_each, '${var.new_members}');
  assert.notEqual(variables.new_members.sensitive, true);
  assert.equal(variables.contacts.sensitive, true);
  assert.equal(member.email, '${var.contacts[each.key]}');
});
test('account module uses only the explicit Organization provider binding', () => {
  assert.deepEqual(rootModule.providers, { aws: '${aws.organization}' });
  assert.equal((parsed['modules/accounts/providers.tf']?.provider ?? []).length, 0);
  assert.equal((parsed['roots/accounts/providers.tf'].provider ?? []).length, 1);
  const provider = Object.fromEntries(blocks(parsed['roots/accounts/providers.tf'], 'provider')).aws;
  assert.equal(provider.alias, '"organization"');
});
test('account administration cannot own an Organization or change its policies', () => {
  const kinds = Object.values(parsed).flatMap(document => blocks(document, 'resource').map(([kind]) => kind));
  assert.deepEqual(kinds, ['aws_organizations_account']);
  assert.equal(member.parent_id, '${var.parent_ou_id}');
});
test('member IDs are protected administration outputs with no runtime handoff', () => {
  for (const directory of ['modules/accounts', 'roots/accounts']) {
    const outputs = blocks(parsed[`${directory}/outputs.tf`], 'output');
    assert.deepEqual(outputs.map(([name]) => name), ['member_ids']);
    assert.equal(outputs[0][1].sensitive, true);
  }
});
