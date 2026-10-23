import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { toolsImage } from './tools.mjs';

const sources = {};
for (const scope of ['global', 'country']) {
  for (const name of readdirSync(new URL(`roots/${scope}/`, import.meta.url)).filter(name => name.endsWith('.tf'))) {
    sources[`${scope}/${name}`] = readFileSync(new URL(`roots/${scope}/${name}`, import.meta.url), 'utf8');
  }
}
const name = `cloud-aws-topology-${randomUUID()}`;
const options = { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } };
let parsed;
try {
  parsed = JSON.parse(execFileSync('docker', [
    'run', '--rm', '--name', name, '--label', `io.waitron.aws-topology=${name}`, '--pull', 'never',
    '--network', 'none', '--user', '65532:65532', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--memory', '256m', '--cpus', '1', '--pids-limit', '32',
    toolsImage, 'python', '-I', '-c',
    'import hcl2,json,sys; print(json.dumps({k:hcl2.loads(v) for k,v in json.loads(sys.argv[1]).items()}))',
    JSON.stringify(sources),
  ], options));
} finally {
  const containers = execFileSync('docker', ['container', 'ls', '-aq', '--no-trunc', '--filter', `label=io.waitron.aws-topology=${name}`], options).trim();
  if (containers) {
    assert.match(containers, /^[a-f0-9]{64}$/);
    execFileSync('docker', ['container', 'rm', '--force', containers], options);
  }
}
function entries(scope, kind) {
  return Object.entries(parsed).filter(([path]) => path.startsWith(`${scope}/`)).flatMap(([, body]) => body[kind] ?? []);
}
function module(scope, name) {
  return entries(scope, 'module').find(body => body[JSON.stringify(name)])?.[JSON.stringify(name)];
}
for (const [scope, label, region] of [['global', 'global', 'eu-central-1'], ['country', 'es', 'eu-south-2']]) {
  // A backup alias or ambient default must never acquire primary compute.
  test(`${scope} composes primary network and cells through its explicit primary provider`, () => {
    assert.equal(module(scope, 'network')?.source, '"../../modules/network"');
    assert.deepEqual(module(scope, 'network').providers, { aws: `\${aws.${scope}}` });
    assert.equal(module(scope, 'network').scope, JSON.stringify(label));
    assert.equal(module(scope, 'network').region, JSON.stringify(region));
    assert.equal(module(scope, 'network').network, '${var.deployment.network}');
    assert.equal(module(scope, 'network').cells, '${var.deployment.cells}');
    assert.equal(module(scope, 'cell')?.source, '"../../modules/cell"');
    assert.deepEqual(module(scope, 'cell').providers, { aws: `\${aws.${scope}}` });
    assert.equal(module(scope, 'cell').for_each, '${var.deployment.cells}');
    assert.equal(module(scope, 'cell').cell_id, '${each.key}');
    assert.equal(module(scope, 'cell').kubernetes_version, '${var.compute.kubernetes_version}');
    assert.equal(module(scope, 'cell').operator_role_arns, '${var.compute.operator_role_arns}');
  });
  // Subnet IDs alone do not order outbound routes and their associations.
  test(`${scope} waits for the complete network before starting each cell`, () => {
    assert.deepEqual(module(scope, 'cell')?.depends_on, ['${module.network}']);
    assert.deepEqual(module(scope, 'cell').network, {
      vpc_id: '${module.network.network.vpc_id}',
      private_subnet_ids: '${module.network.network.cells[each.key].private_subnet_ids}',
    });
  });
  test(`${scope} attaches the same VPC database-client group to actual cell nodes`, () => {
    const group = entries(scope, 'resource').find(body => body['"aws_security_group"']?.['"database_clients"'])?.['"aws_security_group"']['"database_clients"'];
    assert.equal(group?.provider, `\${aws.${scope}}`);
    assert.equal(group.vpc_id, '${module.network.network.vpc_id}');
    assert.equal(module(scope, 'cell')?.database_client_security_group_id, '${aws_security_group.database_clients.id}');
    assert.equal(group.ingress, undefined);
    assert.equal(group.egress, undefined);
  });
  test(`${scope} requires explicit non-null compute settings`, () => {
    const compute = entries(scope, 'variable').find(body => body['"compute"'])?.['"compute"'];
    assert.equal(compute?.nullable, false);
    assert.equal(compute.default, undefined);
  });
}
