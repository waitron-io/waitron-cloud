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
sources['scope-permissions/outputs.tf'] = readFileSync(new URL('modules/scope-permissions/outputs.tf', import.meta.url), 'utf8');
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
    assert.deepEqual(module(scope, 'cell')?.depends_on, ['${module.network}', '${module.observability}']);
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

  // Mocked plans do not authenticate a provider; check the actual alias edges too.
  test(`${scope} keeps key administration separate while composing regional custody`, () => {
    const custody = module(scope, 'custody');
    assert.equal(custody?.source, '"../../modules/custody"');
    assert.deepEqual(custody.providers, {
      aws: `\${aws.${scope}}`,
      '${aws.backup}': `\${aws.${scope}_backup}`,
      '${aws.keys}': `\${aws.${scope}_keys}`,
      '${aws.backup_keys}': `\${aws.${scope}_backup_keys}`,
    });
    assert.equal(custody.scope, JSON.stringify(label));
    assert.deepEqual(custody.authorities, {
      deployment: `"arn:aws:iam::\${data.aws_caller_identity.${scope}.account_id}:role/waitron-${label}-deployment"`,
      key_administration: `"arn:aws:iam::\${data.aws_caller_identity.${scope}.account_id}:role/waitron-${label}-key-administration"`,
      recovery: '${var.recovery_role_arn}',
    });
    assert.deepEqual(custody.region_pair, {
      primary: JSON.stringify(region), backup: JSON.stringify(scope === 'global' ? 'eu-west-1' : 'eu-west-3'),
    });
    assert.equal(custody.observability_cells, '${toset([for name in keys(var.deployment.cells) : "waitron-${name}"])}');
    assert.equal(custody.depends_on, undefined);
  });
  test(`${scope} connects the management database to its private tier and the actual node client group`, () => {
    const database = module(scope, 'database');
    assert.equal(database?.source, '"../../modules/database"');
    assert.deepEqual(database.providers, { aws: `\${aws.${scope}}`, '${aws.backup}': `\${aws.${scope}_backup}` });
    assert.equal(database.scope, JSON.stringify(label));
    assert.deepEqual(database.network, {
      vpc_id: '${module.network.network.vpc_id}',
      database_subnet_ids: '${module.network.network.database_subnet_ids}',
      service_security_group_id: '${aws_security_group.database_clients.id}',
    });
    assert.deepEqual(database.kms, {
      primary: '${module.custody.kms.database}', backup: '${module.custody.backup_kms.database}',
    });
    assert.equal(database.settings, '${var.database}');
    assert.deepEqual(database.depends_on, ['${module.observability}']);
  });
  test(`${scope} requires explicit database sizing and recovery authority`, () => {
    for (const name of ['database', 'recovery_role_arn']) {
      const value = entries(scope, 'variable').find(body => body[JSON.stringify(name)])?.[JSON.stringify(name)];
      assert.equal(value?.nullable, false);
      assert.equal(value.default, undefined);
    }
  });
  // Sharing these policies across cells must not duplicate their AWS owner.
  test(`${scope} attaches recovery permissions once outside the cell iterator`, () => {
    const permissions = module(scope, 'scope_permissions');
    assert.equal(permissions?.source, '"../../modules/scope-permissions"');
    assert.deepEqual(permissions.providers, { aws: `\${aws.${scope}}` });
    assert.equal(permissions.scope, JSON.stringify(label));
    assert.equal(permissions.for_each, undefined);
    assert.equal(permissions.count, undefined);
    assert.equal(permissions.recovery_role_arn, '${var.recovery_role_arn}');
    assert.deepEqual(permissions.prefixes, { stream: '"streams/"', snapshot: '"snapshots/"' });
    assert.deepEqual(permissions.custody_refs, {
      kms: '${module.custody.kms}', backup_kms: '${module.custody.backup_kms}',
      secrets: '${module.custody.secrets}', backup_secret_refs: '${module.custody.backup_secret_refs}',
      replication_role_arn: '${module.custody.replication_role_arn}',
    });
    assert.equal(permissions.database_refs, '${module.database.database}');
    assert.equal(permissions.storage_refs, scope === 'global' ? null : '${local.storage_refs}');
    assert.equal(permissions.depends_on, undefined);
  });
  test(`${scope} exposes the same composed database and custody references for later consumers`, () => {
    const output = entries(scope, 'output').find(body => body['"data_topology"'])?.['"data_topology"'];
    assert.deepEqual(output?.value, {
      database: '${module.database.database}',
      keys: '${module.custody.kms}',
      backup_keys: '${module.custody.backup_kms}',
      secret_refs: '${module.custody.secrets}',
      backup_secret_refs: '${module.custody.backup_secret_refs}',
    });
  });
}

// Reversing this edge would either install replication too early or form a cycle.
test('country waits for replication policy through its role reference and keeps bucket reads independent', () => {
  const storage = module('country', 'storage');
  assert.equal(storage?.source, '"../../modules/storage"');
  assert.deepEqual(storage.providers, { aws: '${aws.country}', '${aws.backup}': '${aws.country_backup}' });
  assert.equal(storage.scope, '"es"');
  assert.deepEqual(storage.region_pair, { primary: '"eu-south-2"', backup: '"eu-west-3"' });
  assert.deepEqual(storage.kms, { primary: '${module.custody.kms.storage}', backup: '${module.custody.backup_kms.storage}' });
  assert.equal(storage.replication_role_arn, '${module.scope_permissions.replication_role_arn}');
  assert.deepEqual(storage.prefixes, { stream: '"streams/"', snapshot: '"snapshots/"' });
  assert.equal(storage.for_each, undefined);
  assert.equal(storage.count, undefined);
  assert.equal(storage.depends_on, undefined);
  const refs = entries('country', 'locals').find(body => body.storage_refs)?.storage_refs;
  assert.deepEqual(refs, {
    stream_bucket: '"waitron-es-stream-${data.aws_caller_identity.country.account_id}-eu-south-2"',
    snapshot_bucket: '"waitron-es-snapshot-${data.aws_caller_identity.country.account_id}-eu-south-2"',
    backup_buckets: {
      stream: '"waitron-es-stream-${data.aws_caller_identity.country.account_id}-eu-west-3"',
      snapshot: '"waitron-es-snapshot-${data.aws_caller_identity.country.account_id}-eu-west-3"',
    },
    kms_key_refs: { primary: '${module.custody.kms.storage}', backup: '${module.custody.backup_kms.storage}' },
  });
});
test('global never allocates venue stores or replication', () => {
  assert.equal(module('global', 'storage'), undefined);
  const permissions = module('global', 'scope_permissions');
  assert.equal(permissions?.storage_refs, null);
  assert.equal(permissions?.scope, '"global"');
});

// Carry policy readiness only through the role reference used by replication.
test('the replication role reference waits for its attached source policy', () => {
  const output = parsed['scope-permissions/outputs.tf'].output.find(body => body['"replication_role_arn"'])?.['"replication_role_arn"'];
  assert.equal(output?.value, '${var.custody_refs.replication_role_arn}');
  assert.deepEqual(output.depends_on, ['${aws_iam_role_policy.replication}']);
});

for (const [scope, label] of [['global', 'global'], ['country', 'es']]) {
  // A fixed issuer or shared iterator would trust the wrong Kubernetes cluster.
  test(`${scope} binds every workload identity to the matching cell and primary provider`, () => {
    const permissions = module(scope, 'workload_permissions');
    assert.equal(permissions?.source, '"../../modules/workload-permissions"');
    assert.deepEqual(permissions.providers, { aws: `\${aws.${scope}}` });
    assert.equal(permissions.for_each, '${var.deployment.cells}');
    assert.equal(permissions.scope, JSON.stringify(label));
    assert.equal(permissions.cell_name, '${each.key}');
    assert.equal(permissions.oidc_issuer, '${module.cell[each.key].cell.oidc_issuer}');
    assert.equal(permissions.namespace, JSON.stringify(`waitron-cloud-${label}`));
    const contract = JSON.parse(readFileSync(new URL('contracts/p1-roles-v1.json', import.meta.url), 'utf8'));
    const roles = scope === 'global' ? ['api', 'portal', 'registration-worker', 'monitor-worker'] : contract.roles;
    assert.deepEqual(Object.fromEntries(Object.entries(permissions.role_names).map(([role, account]) => [role.startsWith('"') ? JSON.parse(role) : role, account])), Object.fromEntries(roles.map(role => [role, JSON.stringify(contract.service_accounts[role])])));
    assert.equal(permissions.count, undefined);
    assert.equal(permissions.depends_on, undefined);
  });
  test(`${scope} gives cell workloads only their own completed scope references`, () => {
    const permissions = module(scope, 'workload_permissions');
    assert.deepEqual(permissions?.custody_refs, {
      kms: '${module.custody.kms}', backup_kms: '${module.custody.backup_kms}',
      secrets: '${module.custody.secrets}', backup_secret_refs: '${module.custody.backup_secret_refs}',
      replication_role_arn: '${module.custody.replication_role_arn}',
    });
    assert.equal(permissions.storage_refs, scope === 'global' ? null : '${local.storage_refs}');
    assert.equal(permissions.database_refs, '${module.database.database}');
    assert.equal(permissions.recovery_role_arn, '${var.recovery_role_arn}');
    assert.deepEqual(permissions.prefixes, { stream: '"streams/"', snapshot: '"snapshots/"' });
    const output = entries(scope, 'output').find(body => body['"workload_topology"'])?.['"workload_topology"'];
    assert.equal(output?.value, '${{for name, permissions in module.workload_permissions : name => {workload_roles = permissions.workload_roles, attachments = permissions.attachment_refs}}}');
  });
}

for (const [scope, label] of [['global', 'global'], ['country', 'es']]) {
  // A shared node group or backup alias can expose the wrong cell's service.
  test(`${scope} connects each ingress to its own node group and the primary public network`, () => {
    const ingress = module(scope, 'ingress');
    assert.equal(ingress?.source, '"../../modules/ingress"');
    assert.deepEqual(ingress.providers, { aws: `\${aws.${scope}}` });
    assert.equal(ingress.for_each, '${var.deployment.cells}');
    assert.equal(ingress.scope, JSON.stringify(label));
    assert.equal(ingress.cell_id, '${each.key}');
    assert.deepEqual(ingress.network, {
      vpc_id: '${module.network.network.vpc_id}',
      public_subnet_ids: '${module.network.network.public_subnet_ids}',
      node_security_group_id: '${module.cell[each.key].cell.node_security_group_id}',
    });
    assert.deepEqual(ingress.ports, { tcp: [443], udp: scope === 'global' ? [] : [51820] });
    const dns = module(scope, 'dns');
    assert.equal(dns?.source, '"../../modules/dns"');
    assert.deepEqual(dns.providers, { aws: `\${aws.${scope}}` });
    assert.equal(dns.scope, JSON.stringify(label));
    assert.equal(dns.zone_name, JSON.stringify(scope === 'global' ? 'waitron.io' : 'es.waitron.io'));
    assert.equal(dns.create_zone, '${var.dns.create_zone}');
    assert.equal(dns.existing_zone_id, '${var.dns.existing_zone_id}');
    assert.equal(dns.for_each, undefined);
    assert.equal(dns.count, undefined);
  });
}

for (const [scope, label] of [['global', 'global'], ['country', 'es']]) {
  // Derived producer names let destinations exist before EKS/RDS enable delivery.
  test(`${scope} installs primary evidence destinations before their producers without a cycle`, () => {
    const evidence = module(scope, 'observability');
    assert.equal(evidence?.source, '"../../modules/observability"');
    assert.deepEqual(evidence.providers, { aws: `\${aws.${scope}}` });
    assert.equal(evidence.scope, JSON.stringify(label));
    assert.equal(evidence.kms_key_arn, '${module.custody.kms.logs}');
    assert.equal(evidence.budget_limit_usd, '${var.budget_limit_usd}');
    assert.deepEqual(evidence.resources, {
      vpc_id: '${module.network.network.vpc_id}',
      database_identifier: JSON.stringify(`waitron-${label}`),
      cell_names: '${toset([for name in keys(var.deployment.cells) : "waitron-${name}"])}',
      replication: scope === 'global' ? {} : '${{for kind in ["stream", "snapshot"] : kind => {source_bucket = kind == "stream" ? local.storage_refs.stream_bucket : local.storage_refs.snapshot_bucket, destination_bucket = local.storage_refs.backup_buckets[kind], rule_id = "cold"}}}',
    });
    assert.equal(evidence.for_each, undefined);
    assert.equal(evidence.count, undefined);
    assert.equal(evidence.depends_on, undefined);
    const budget = entries(scope, 'variable').find(body => body['"budget_limit_usd"'])?.['"budget_limit_usd"'];
    assert.equal(budget?.nullable, false);
    assert.equal(budget.default, undefined);
    assert.deepEqual(module(scope, 'cell').depends_on, ['${module.network}', '${module.observability}']);
    assert.deepEqual(module(scope, 'database').depends_on, ['${module.observability}']);
    const output = entries(scope, 'output').find(body => body['"evidence_topology"'])?.['"evidence_topology"'];
    assert.equal(output?.value, '${module.observability.observability}');
  });
}
