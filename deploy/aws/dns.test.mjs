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
for (const folder of ['modules/dns', 'roots/delegation']) {
  for (const name of (await readdir(new URL(`${folder}/`, import.meta.url))).filter(name => name.endsWith('.tf'))) {
    documents[`${folder}/${name}`] = await readFile(new URL(`${folder}/${name}`, import.meta.url), 'utf8');
  }
}
const container = `cloud-aws-dns-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-dns-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-dns-syntax'], container);
    await execute('docker', ['container', 'rm', '--force', record.Id], options);
  }
}
function blocks(kind, folder) {
  return Object.entries(parsed).filter(([path]) => path.startsWith(folder + "/")).map(([, document]) => document).flatMap(doc => (doc[kind] ?? []).flatMap(entry => Object.entries(entry)
    .filter(([key]) => key !== '__is_block__')
    .flatMap(([type, bodies]) => Object.entries(bodies).filter(([key]) => key !== '__is_block__')
      .map(([name, body]) => [JSON.parse(type), JSON.parse(name), body]))));
}
// A removed lifecycle guard would let a future rename destroy the public zone.
test('managed public zones refuse destructive replacement and recursive deletion', () => {
  const zones = blocks('resource', 'modules/dns').filter(([kind]) => kind === 'aws_route53_zone');
  assert.equal(zones.length, 1);
  assert.equal(zones[0][2].force_destroy, false);
  assert.deepEqual(zones[0][2].lifecycle?.map(body => body.prevent_destroy), [true]);
  assert.equal(zones[0][2].vpc, undefined, 'Managed zones must be public');
});
test('delegation binds every read and write only to the explicit global provider', () => {
  const providers = Object.entries(parsed).filter(([path]) => path.startsWith('roots/delegation/')).flatMap(([, doc]) => doc.provider ?? []);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]['"aws"'].alias, '"global"');
  assert.equal(providers[0]['"aws"'].region, '"eu-central-1"');
  for (const [, , body] of [...blocks('resource', 'roots/delegation'), ...blocks('data', 'roots/delegation')]) {
    assert.equal(body.provider, '${aws.global}', 'Country/ambient credentials must never edit the parent');
  }
});
test('DNS declarations contain no registrar, live routing, attachment or cross-account state consumer', () => {
  assert.deepEqual(blocks('resource', 'modules/dns').map(([kind]) => kind).sort(), ['aws_iam_policy', 'aws_route53_zone']);
  assert.deepEqual(blocks('resource', 'roots/delegation').map(([kind]) => kind).sort(), ['aws_iam_policy', 'aws_route53_record']);
  assert.deepEqual(blocks('data', 'modules/dns').map(([kind]) => kind).sort(), ['aws_region', 'aws_route53_zone']);
  assert.deepEqual(blocks('data', 'roots/delegation').map(([kind]) => kind).sort(), ['aws_caller_identity', 'aws_region', 'aws_route53_zone']);
  assert.equal(Object.values(parsed).flatMap(doc => doc.module ?? []).length, 0);
});
test('delegation defers all backend settings to protected external bootstrap', () => {
  const settings = Object.entries(parsed).filter(([path]) => path.startsWith('roots/delegation/')).flatMap(([, doc]) => doc.terraform ?? []).flatMap(body => body.backend ?? []);
  assert.equal(settings.length, 1);
  assert.deepEqual(Object.keys(settings[0]), ['"s3"']);
  assert.deepEqual(Object.keys(settings[0]['"s3"']).filter(key => key !== '__is_block__'), []);
});

test('DNS plans qualify country ownership, explicit adoption and parent delegation refusals', async () => {
  const result = await runSuite('dns');
  assert.deepEqual([...result.matchAll(/Isolated suite aggregate: Success! ([0-9]+) passed, 0 failed\./g)].map(match => Number(match[1])), [17, 19]);
});
