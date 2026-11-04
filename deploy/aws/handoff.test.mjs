import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import { runSuite } from './check.mjs';

const execute = promisify(execFile);
const schema = JSON.parse(await readFile(new URL('./contracts/infrastructure-v1.schema.json', import.meta.url)));
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);

// The expected objects are hand-derived from the synthetic provider references,
// independently of the root's conversion and per-cell selection expressions.
function expected(scope, cell, count) {
  const country = scope === 'country';
  const prefix = country ? 'es' : 'global';
  const region = country ? 'eu-south-2' : 'eu-central-1';
  const backup = country ? 'eu-west-3' : 'eu-west-1';
  const account = country ? '333333333333' : '222222222222';
  const az = country ? 'eus2' : 'euc1';
  const index = Number(cell.slice(-2));
  const key = place => `arn:aws:kms:${place}:${account}:key/${place === region ? '11111111-1111-1111-1111-111111111111' : '22222222-2222-2222-2222-222222222222'}`;
  const secretNames = country ? ['backup-master-key', 'email-key-ring', 'gateway-signing', 'wireguard', 'installation-signing'] : ['email-key-ring', 'sign-in-signing'];
  const secrets = place => Object.fromEntries(secretNames.map(name => [name, `arn:aws:secretsmanager:${place}:${account}:secret:waitron-${prefix}/${name}-ABCDEF`]));
  const roles = country ? ['api', 'portal', 'registration-worker', 'backup-worker', 'backup-verifier', 'remote-gateway', 'remote-reconciler', 'monitor-worker'] : ['api', 'portal', 'registration-worker', 'monitor-worker'];
  const alarm = `arn:aws:cloudwatch:${region}:${account}:alarm:synthetic`;
  const signals = {
    'database-storage': alarm, 'database-connections': alarm,
    ...Object.fromEntries(Array.from({ length: count }, (_, i) => [`nodes-waitron-${prefix}-0${i + 1}`, alarm])),
    ...(country ? { 'replication-stream': alarm, 'replication-snapshot': alarm } : {}),
    operator: `arn:aws:sns:${region}:${account}:waitron-${prefix}-operator`,
  };
  return {
    version: 1, scope, country: country ? 'es' : null, regions: { primary: region, backup },
    cells: { [cell]: {
      cluster_name: `waitron-${cell}`, region, az_ids: [`${az}-az1`, `${az}-az2`, `${az}-az3`],
      private_subnet_ids: [1, 2, 3].map(n => `subnet-${String((index - 1) * 3 + n).padStart(17, '0')}`),
      node_security_group_id: `sg-${String(index).padStart(17, '0')}`,
      oidc_issuer: `https://oidc.eks.${region}.amazonaws.com/id/${cell}`,
      ingress: {
        dns_name: `${cell}.${region}.elb.synthetic.invalid`, zone_id: `ZLB${index}`, tcp_ports: [443], udp_ports: country ? [51820] : [],
        target_group_arns: (country ? ['https', 'wireguard'] : ['https']).map(name => `arn:aws:elasticloadbalancing:${region}:${account}:targetgroup/${cell}-${name}/1111111111111111`),
      },
    } },
    database: { endpoint: 'synthetic.invalid', port: 5432, name: `cloud_${prefix}`, admin_secret_ref: `arn:aws:secretsmanager:${region}:${account}:secret:admin-ABCDEF`, kms_key_ref: key(region), backup_ref: `arn:aws:rds:${backup}:${account}:auto-backup:synthetic` },
    storage: country ? { stream_bucket: `waitron-es-stream-${account}-${region}`, snapshot_bucket: `waitron-es-snapshot-${account}-${region}`, backup_buckets: [`waitron-es-snapshot-${account}-${backup}`, `waitron-es-stream-${account}-${backup}`], kms_key_refs: { primary: key(region), backup: key(backup) } } : { stream_bucket: null, snapshot_bucket: null, backup_buckets: [], kms_key_refs: {} },
    secrets: secrets(region),
    workload_roles: Object.fromEntries(roles.map(role => [role, `arn:aws:iam::${account}:role/waitron-${prefix}-${cell}-${role}`])),
    observability: { logs: { rds: `arn:aws:logs:${region}:${account}:log-group:/aws/rds/instance/waitron-${prefix}/postgresql`, vpc: `arn:aws:logs:${region}:${account}:log-group:/waitron/${prefix}/vpc-flow`, eks: `arn:aws:logs:${region}:${account}:log-group:/aws/eks/waitron-${cell}/cluster`, metrics: `arn:aws:logs:${region}:${account}:log-group:/aws/containerinsights/waitron-${cell}/performance` }, signals, budget_ref: `arn:aws:budgets::${account}:budget/waitron-${prefix}-monthly` },
    dns: { zone_id: country ? 'ZSPAIN' : 'ZGLOBAL', name: country ? 'es.waitron.io' : 'waitron.io', name_servers: [1, 2, 3, 4].map(n => `ns-${n}.synthetic.invalid`) },
    recovery: { region: backup, database_backup_ref: `arn:aws:rds:${backup}:${account}:auto-backup:synthetic`, key_refs: Object.fromEntries(['database', 'storage', 'secrets', 'logs'].map(name => [name, key(backup)])), secret_refs: secrets(backup), runtime_enabled: false },
  };
}

// Removing a root export, crossing cells or using map-shaped subnet/target/store
// collections must fail at the real planned JSON boundary.
test('one and two cells in both independent roots publish complete schema-valid exact handoffs', async () => {
  const output = await runSuite('integration', { execute: async (file, args, options) => {
    if (args.at(-1) === '/candidate/run.py') {
      const directory = args[args.indexOf('--mount') + 1].match(/source=([^,]+),/)[1];
      const path = `${directory}/suite.json`;
      const plan = JSON.parse(await readFile(path, 'utf8')).filter(entry => entry.filter === 'tests/handoff.tftest.hcl');
      assert.deepEqual(plan.map(entry => entry.directory), ['roots/global', 'roots/country'], 'fixed integration suite must include both complete handoffs');
      await writeFile(path, JSON.stringify(plan));
      const driver = await readFile(`${directory}/run.py`, 'utf8');
      const command = 'command = ["tofu", "test", f"-filter={entry[\'filter\']}", "-no-color"]';
      assert.ok(driver.includes(command));
      await writeFile(`${directory}/run.py`, driver.replace(command, command.slice(0, -1) + ', "-json", "-verbose"]'));
    }
    try { return await execute(file, args, { ...options, maxBuffer: 32 * 1024 * 1024 }); }
    catch (error) {
      if (args.at(-1) !== "/candidate/run.py") throw error;
      throw new Error(`${error.stdout ?? ""}\n${error.stderr ?? ""}`, { cause: error });
    }
  } });
  const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const { selectInfrastructure } = await import('./handoff.mjs');
  const plans = events.filter(event => event.type === 'test_plan');
  assert.equal(plans.length, 4);
  for (const [i, plan] of plans.entries()) {
    const scope = i < 2 ? 'global' : 'country';
    const count = i % 2 + 1;
    const change = plan.test_plan.output_changes.infrastructure_v1_by_cell;
    assert.ok(change, `${scope} needs its complete handoff output`);
    const hasUnknown = value => value === true || (value && typeof value === 'object' && Object.values(value).some(hasUnknown));
    assert.equal(Boolean(hasUnknown(change.after_unknown)), false, `all synthetic references must be known: ${JSON.stringify(change.after_unknown)}`);
    const values = change.after;
    const names = Array.from({ length: count }, (_, n) => `${scope === 'global' ? 'global' : 'es'}-0${n + 1}`);
    assert.deepEqual(Object.keys(values), names);
    for (const cell of names) {
      assert.equal(validate(values[cell]), true, JSON.stringify(validate.errors));
      assert.deepEqual(values[cell], expected(scope, cell, count));
      const prefix = scope === 'global' ? 'global' : 'es';
      assert.deepEqual(selectInfrastructure(values, prefix, cell), expected(scope, cell, count));
      assert.throws(() => selectInfrastructure(values, prefix === 'global' ? 'es' : 'global', cell), /Invalid infrastructure selection/);
    }
  }
  assert.equal(events.filter(event => event.type === 'test_summary' && event.test_summary.passed === 2 && event.test_summary.failed === 0).length, 2);
});

// Choosing a first entry or matching only a prefix could bind another cell's
// identity roles. Selection must preserve the requested complete object exactly.
test('selection keeps the explicit scope and cell without changing the export', async () => {
  const { selectInfrastructure } = await import('./handoff.mjs');
  for (const scope of ['global', 'country']) {
    const prefix = scope === 'global' ? 'global' : 'es';
    const values = { [`${prefix}-01`]: expected(scope, `${prefix}-01`, 2), [`${prefix}-02`]: expected(scope, `${prefix}-02`, 2) };
    const before = structuredClone(values);
    assert.deepEqual(selectInfrastructure(values, prefix, `${prefix}-02`), values[`${prefix}-02`]);
    assert.deepEqual(values, before);
  }
});

for (const [label, alter, scope, cell] of [
  ['missing explicit cell', value => value, 'es', undefined],
  ['unknown cell', value => value, 'es', 'es-99'],
  ['unknown scope', value => value, 'fr', 'es-01'],
  ['prototype cell', value => value, 'es', '__proto__'],
  ['crossed scope', value => ({ 'es-01': expected('global', 'global-01', 1) }), 'es', 'es-01'],
  ['crossed cell', value => ({ 'es-01': expected('country', 'es-02', 1) }), 'es', 'es-01'],
  ['more than one embedded cell', value => { value['es-01'].cells['es-02'] = value['es-01'].cells['es-01']; return value; }, 'es', 'es-01'],
  ['unknown version', value => { value['es-01'].version = 2; return value; }, 'es', 'es-01'],
  ['extra secret bytes', value => { value['es-01'].database.password = 'SYNTHETIC_FORBIDDEN'; return value; }, 'es', 'es-01'],
  ['unknown role', value => { value['es-01'].workload_roles.administrator = 'synthetic'; return value; }, 'es', 'es-01'],
  ['running recovery', value => { value['es-01'].recovery.runtime_enabled = true; return value; }, 'es', 'es-01'],
]) {
  test(`selection refuses ${label}`, async () => {
    const { selectInfrastructure } = await import('./handoff.mjs');
    assert.throws(() => selectInfrastructure(alter({ 'es-01': expected('country', 'es-01', 1) }), scope, cell), /Invalid infrastructure selection/);
  });
}

test('selection command emits one unchanged object and no output for invalid selections', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'cloud-handoff-selection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const value = expected('country', 'es-02', 2);
  const path = join(directory, 'output.json');
  await writeFile(path, JSON.stringify({ infrastructure_v1_by_cell: { sensitive: false, type: ['object', {}], value: { 'es-02': value } } }));
  const command = new URL('./handoff.mjs', import.meta.url).pathname;
  const result = await execute(process.execPath, [command, path, 'es', 'es-02']);
  assert.deepEqual(JSON.parse(result.stdout), value);
  assert.equal(result.stderr, '');
  for (const args of [[path, 'es', 'es-99'], [path, 'global', 'es-02'], [path, 'es'], [path, 'es', 'es-02', 'extra']]) {
    await assert.rejects(execute(process.execPath, [command, ...args]), error => error.code === 1 && error.stdout === '' && /Invalid infrastructure selection|Usage:/.test(error.stderr));
  }
});
