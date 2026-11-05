import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';

const schema = JSON.parse(await readFile(new URL('./contracts/infrastructure-v1.schema.json', import.meta.url)));
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
const agreedRoles = ['api', 'portal', 'registration-worker', 'backup-worker', 'backup-verifier', 'remote-gateway', 'remote-reconciler', 'monitor-worker'];

function handoff(scope = 'country') {
  const country = scope === 'country';
  const prefix = country ? 'es' : 'global';
  const primary = country ? 'eu-south-2' : 'eu-central-1';
  const backup = country ? 'eu-west-3' : 'eu-west-1';
  return {
    version: 1, scope, country: country ? 'es' : null,
    regions: { primary, backup },
    cells: {
      [`${prefix}-01`]: {
        cluster_name: `${prefix}-01`, region: primary,
        az_ids: ['synthetic-az1', 'synthetic-az2', 'synthetic-az3'],
        private_subnet_ids: ['subnet-a', 'subnet-b', 'subnet-c'],
        node_security_group_id: 'sg-synthetic', oidc_issuer: 'https://issuer.invalid',
        ingress: {
          dns_name: 'ingress.invalid', zone_id: 'Z-SYNTHETIC', tcp_ports: [443],
          udp_ports: country ? [51820] : [],
          target_group_arns: country ? ['synthetic:tcp', 'synthetic:udp'] : ['synthetic:tcp'],
        },
      },
    },
    database: { endpoint: 'database.invalid', port: 5432, name: 'cloud', admin_secret_ref: 'synthetic:secret:admin', kms_key_ref: 'synthetic:key:database', backup_ref: 'synthetic:backup:database' },
    storage: {
      stream_bucket: country ? 'synthetic-streams' : null,
      snapshot_bucket: country ? 'synthetic-snapshots' : null,
      backup_buckets: country ? ['synthetic-backups'] : [],
      kms_key_refs: { storage: 'synthetic:key:storage' },
    },
    secrets: { database_admin: 'synthetic:secret:admin' },
    workload_roles: { api: 'synthetic:role:api' },
    observability: { logs: { application: 'synthetic:logs' }, signals: { alarm: 'synthetic:alarm' }, budget_ref: 'synthetic:budget' },
    dns: { zone_id: 'Z-SYNTHETIC', name: 'cloud.invalid', name_servers: ['ns1.invalid', 'ns2.invalid'] },
    recovery: { region: backup, database_backup_ref: 'synthetic:backup:database', key_refs: { database: 'synthetic:key:backup' }, secret_refs: { database: 'synthetic:secret:backup' }, runtime_enabled: false },
  };
}

function rejected(value, label) {
  assert.equal(validate(value), false, `${label} was accepted`);
}

function get(value, path) {
  return path.reduce((current, key) => current[key], value);
}

// Opening any fixed object admits credentials alongside references.
const objectPaths = [[], ['regions'], ['cells', 'es-01'], ['cells', 'es-01', 'ingress'], ['database'], ['storage'], ['observability'], ['dns'], ['recovery']];
for (const path of objectPaths) {
  test(`closed_handoff refuses an extra field in ${path.join('.') || 'root'}`, () => {
    const value = handoff();
    get(value, path).credentials = 'must never enter a handoff';
    rejected(value, `Extra field at ${path.join('.')}`);
  });
}

for (const scope of ['global', 'country']) {
  test(`accepts the independently shaped ${scope} handoff without changing it`, () => {
    const value = handoff(scope);
    const before = structuredClone(value);
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.deepEqual(value, before);
  });
}

// Making a fixed field optional must break its named consumer contract.
for (const path of objectPaths) {
  for (const key of Object.keys(get(handoff(), path))) {
    test(`closed_handoff requires ${[...path, key].join('.')}`, () => {
      const value = handoff();
      delete get(value, path)[key];
      rejected(value, `Missing ${[...path, key].join('.')}`);
    });
  }
}

for (const [label, path, replacement] of [
  ['future version', ['version'], 2],
  ['string version', ['version'], '1'],
  ['unknown scope', ['scope'], 'organization'],
  ['country without country code', ['country'], null],
  ['unsupported country', ['country'], 'fr'],
  ['wrong primary region', ['regions', 'primary'], 'eu-central-1'],
  ['wrong backup region', ['regions', 'backup'], 'eu-west-1'],
  ['wrong cell region', ['cells', 'es-01', 'region'], 'eu-central-1'],
  ['wrong recovery region', ['recovery', 'region'], 'eu-west-1'],
  ['running recovery', ['recovery', 'runtime_enabled'], true],
  ['numeric recovery flag', ['recovery', 'runtime_enabled'], 0],
  ['missing cell', ['cells'], {}],
  ['duplicate availability zones', ['cells', 'es-01', 'az_ids'], ['az1', 'az1', 'az2']],
  ['only two availability zones', ['cells', 'es-01', 'az_ids'], ['az1', 'az2']],
  ['four availability zones', ['cells', 'es-01', 'az_ids'], ['az1', 'az2', 'az3', 'az4']],
  ['duplicate subnets', ['cells', 'es-01', 'private_subnet_ids'], ['subnet1', 'subnet1', 'subnet2']],
  ['only two subnets', ['cells', 'es-01', 'private_subnet_ids'], ['subnet1', 'subnet2']],
  ['string database port', ['database', 'port'], '5432'],
  ['fractional database port', ['database', 'port'], 5432.5],
  ['zero database port', ['database', 'port'], 0],
  ['oversized database port', ['database', 'port'], 65536],
  ['string ingress port', ['cells', 'es-01', 'ingress', 'tcp_ports'], ['443']],
  ['duplicate ingress port', ['cells', 'es-01', 'ingress', 'tcp_ports'], [443, 443]],
  ['invalid UDP port', ['cells', 'es-01', 'ingress', 'udp_ports'], [65536]],
  ['empty target groups', ['cells', 'es-01', 'ingress', 'target_group_arns'], []],
  ['empty database endpoint', ['database', 'endpoint'], ''],
  ['password object in database reference', ['database', 'admin_secret_ref'], { password: 'forbidden' }],
  ['secret object in secret reference', ['secrets', 'database_admin'], { value: 'forbidden' }],
  ['key bytes object in key reference', ['recovery', 'key_refs', 'database'], { key: 'forbidden' }],
  ['numeric log reference', ['observability', 'logs', 'application'], 12],
  ['numeric signal reference', ['observability', 'signals', 'alarm'], 12],
  ['numeric secret copy reference', ['recovery', 'secret_refs', 'database'], 12],
  ['numeric KMS reference', ['storage', 'kms_key_refs', 'storage'], 12],
  ['null country streams', ['storage', 'stream_bucket'], null],
  ['null country snapshots', ['storage', 'snapshot_bucket'], null],
  ['missing country backups', ['storage', 'backup_buckets'], []],
  ['duplicate backup buckets', ['storage', 'backup_buckets'], ['backup', 'backup']],
  ['empty name servers', ['dns', 'name_servers'], []],
  ['unknown workload role', ['workload_roles'], { administrator: 'synthetic:role:admin' }],
  ['object workload role', ['workload_roles'], { api: { credentials: 'forbidden' } }],
  ['invalid map key', ['secrets'], { '../global': 'synthetic:secret' }],
]) {
  test(`closed_handoff refuses ${label}`, () => {
    const value = handoff();
    const parent = get(value, path.slice(0, -1));
    parent[path.at(-1)] = replacement;
    rejected(value, label);
  });
}

test('global handoff cannot acquire venue storage or a country identity', () => {
  for (const [path, replacement] of [
    [['country'], 'es'],
    [['storage', 'stream_bucket'], 'streams'],
    [['storage', 'snapshot_bucket'], 'snapshots'],
    [['storage', 'backup_buckets'], ['backups']],
    [['regions', 'primary'], 'eu-south-2'],
    [['regions', 'backup'], 'eu-west-3'],
    [['recovery', 'region'], 'eu-west-3'],
  ]) {
    const value = handoff('global');
    get(value, path.slice(0, -1))[path.at(-1)] = replacement;
    rejected(value, `Global ${path.join('.')}`);
  }
});

test('cell maps preserve scope and accept additional cells in that scope', () => {
  for (const scope of ['global', 'country']) {
    const value = handoff(scope);
    const name = scope === 'global' ? 'global-01' : 'es-01';
    value.cells[name.replace('01', '02')] = structuredClone(value.cells[name]);
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    value.cells[scope === 'global' ? 'es-99' : 'global-99'] = structuredClone(value.cells[name]);
    rejected(value, 'Cross-scope cell');
  }
});

test('every agreed P1 role has a typed reference and no additional role is admitted', async () => {
  const contract = JSON.parse(await readFile(new URL('./contracts/p1-roles-v1.json', import.meta.url)));
  assert.equal(contract.version, 1);
  assert.equal(contract.status, 'agreed');
  assert.deepEqual(contract.roles.toSorted(), agreedRoles.toSorted());
  assert.deepEqual(contract.namespaces, { global: 'waitron-cloud-global', country: 'waitron-cloud-es' });
  assert.deepEqual(contract.ingress, { tcp_node_port: 30443, udp_node_port: 31820, health_node_port: 30999, tcp_port: 443, udp_port: 51820, external_traffic_policy: 'Cluster' });
  for (const role of agreedRoles) {
    assert.equal(contract.service_accounts[role], role);
    const value = handoff();
    value.workload_roles = { [role]: `synthetic:role:${role}` };
    assert.equal(validate(value), true, `${role}: ${JSON.stringify(validate.errors)}`);
    value.workload_roles[role] = 42;
    rejected(value, `Non-reference ${role}`);
  }
  assert.deepEqual(Object.keys(contract.service_accounts).toSorted(), agreedRoles.toSorted());
});
