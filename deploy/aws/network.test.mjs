import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolsImage } from './tools.mjs';
import { runSuite } from './check.mjs';

const execute = promisify(execFile);
const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };

function expression(value) {
  assert.equal(typeof value, 'string');
  return value.startsWith('${') ? value.slice(2, -1) : value;
}

// Version 1.11 mocks share computed IDs across instances. Evaluate the original
// routing expressions with distinct address labels so crossed keys stay visible.
test('surviving zone graph evaluates actual routing expressions with distinct resource identities', async (t) => {
  const source = (await Promise.all(['main.tf', 'outputs.tf'].map(file => readFile(new URL(`modules/network/${file}`, import.meta.url), 'utf8')))).join('\n');
  const name = `cloud-aws-network-graph-${randomUUID()}`;
  t.after(async () => {
    let result;
    try {
      result = await execute('docker', ['container', 'inspect', name], options);
    } catch (error) {
      if (!error.stderr?.trim().endsWith(`No such container: ${name}`)
          && !error.stderr?.trim().endsWith(`No such object: ${name}`)) throw error;
    }
    if (result) {
      const [record, ...extra] = JSON.parse(result.stdout);
      assert.equal(extra.length, 0);
      assert.match(record.Id, /^[a-f0-9]{64}$/);
      assert.equal(record.Config.Labels['io.waitron.aws-network-graph'], name);
      await execute('docker', ['container', 'rm', '--force', record.Id], options);
    }
  });
  const parsed = await execute('docker', [
    'run', '--rm', '--name', name, '--label', `io.waitron.aws-network-graph=${name}`,
    '--pull', 'never', '--network', 'none', '--user', '65532:65532', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
    '--memory', '256m', '--cpus', '1', '--pids-limit', '32', toolsImage, 'python', '-I', '-c',
    'import hcl2,json,sys; print(json.dumps(hcl2.loads(sys.argv[1])))', source,
  ], options);
  const document = JSON.parse(parsed.stdout);
  const resources = {};
  for (const entry of document.resource) {
    for (const [kind, declarations] of Object.entries(entry)) {
      if (kind !== '__is_block__') resources[kind] = { ...resources[kind], ...declarations };
    }
  }
  const body = (kind, name) => resources[JSON.stringify(kind)][JSON.stringify(name)];
  const bindings = {
    'aws_nat_gateway.zone': 'local.symbols.nat',
    'aws_eip.zone': 'local.symbols.eip',
    'aws_subnet.public': 'local.symbols.public',
    'aws_subnet.cell': 'local.symbols.cell',
    'aws_route_table.private': 'local.symbols.route',
    'aws_route_table.database': 'local.symbols.database_route',
    'aws_route_table.public': 'local.symbols.public_route',
    'aws_subnet.database': 'local.symbols.database',
    'aws_vpc.primary': 'local.symbols.vpc',
    'aws_internet_gateway.primary': 'local.symbols.internet',
  };
  const lift = value => {
    let result = expression(value);
    for (const [resource, symbol] of Object.entries(bindings)) result = result.replaceAll(resource, symbol);
    return result;
  };
  const evaluate = (kind, name, attributes) => {
    const config = body(kind, name);
    return `{for each in [for key,value in ${lift(config.for_each)} : {key=key,value=value}] : each.key => {${attributes.map(attribute => `${attribute}=(${lift(config[attribute])})`).join(',')}}}`;
  };
  const render = value => {
    if (typeof value === 'string') return lift(value);
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(render).join(',')}]`;
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${render(item)}`).join(',')}}`;
  };
  const locals = Object.assign({}, ...document.locals);
  delete locals.__is_block__;
  const main = `locals {
    ${Object.entries(locals).map(([key, value]) => `${key} = ${expression(value)}`).join('\n')}
    symbols = {
      vpc = {id="primary-vpc"}
      internet = {id="internet-gateway"}
      public_route = {id="public-route"}
      database_route = {for az in keys(local.zones) : az => {id="database-route/\${az}"}}
      database = {for az in keys(local.zones) : az => {id="database/\${az}"}}
      nat = {for az in keys(local.zones) : az => {id="nat/\${az}"}}
      eip = {for az in keys(local.zones) : az => {id="eip/\${az}"}}
      public = {for az in keys(local.zones) : az => {id="public/\${az}"}}
      route = {for az in keys(local.zones) : az => {id="route/\${az}"}}
      cell = {for key in keys(local.cell_subnets) : key => {id="cell/\${key}"}}
    }
  }
  output "graph" {
    value = {
      storage = ${render(Object.fromEntries(['vpc_id', 'service_name', 'vpc_endpoint_type', 'route_table_ids'].map(key => [key, body('aws_vpc_endpoint', 's3')[key]])))}
      public_route = ${render(Object.fromEntries(['route_table_id', 'destination_cidr_block', 'gateway_id'].map(key => [key, body('aws_route', 'public')[key]])))}
      network = ${render(Object.assign({}, ...document.output)['\"network\"'].value)}
      database = ${evaluate('aws_route_table_association', 'database', ['subnet_id', 'route_table_id'])}
      public = ${evaluate('aws_route_table_association', 'public', ['subnet_id', 'route_table_id'])}
      nats = ${evaluate('aws_nat_gateway', 'zone', ['subnet_id', 'allocation_id'])}
      routes = ${evaluate('aws_route', 'private', ['nat_gateway_id', 'route_table_id'])}
      cells = ${evaluate('aws_route_table_association', 'cell', ['subnet_id', 'route_table_id'])}
    }
  }`;
  const directory = await mkdtemp(join(tmpdir(), 'cloud-aws-network-graph-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const module = join(directory, 'deploy/aws/modules/network');
  await mkdir(join(module, 'tests'), { recursive: true });
  for (const file of ['versions.tf', 'variables.tf']) await cp(new URL(`modules/network/${file}`, import.meta.url), join(module, file));
  await writeFile(join(module, 'main.tf'), main);
  await writeFile(join(module, 'tests/network.tftest.hcl'), `mock_provider "aws" {}
    variables {
      scope="es"
      region="eu-south-2"
      network={az_ids=["eus2-az1","eus2-az2","eus2-az3"]}
      cells={es-01={},es-02={}}
    }
    run "surviving_az_routes" {
      command=plan
      assert {
        condition=alltrue(flatten([for lost in var.network.az_ids : [for az in var.network.az_ids :
          try(output.graph.storage.vpc_id == "primary-vpc" &&
            output.graph.storage.service_name == "com.amazonaws.eu-south-2.s3" &&
            output.graph.storage.vpc_endpoint_type == "Gateway" &&
            toset(output.graph.storage.route_table_ids) == toset(["route/eus2-az1","route/eus2-az2","route/eus2-az3"]) &&
            output.graph.public_route.route_table_id == "public-route" &&
            output.graph.public_route.destination_cidr_block == "0.0.0.0/0" &&
            output.graph.public_route.gateway_id == "internet-gateway" &&
            output.graph.network.vpc_id == "primary-vpc" &&
            output.graph.network.public_subnet_ids[az] == "public/\${az}" &&
            output.graph.network.database_subnet_ids[az] == "database/\${az}" &&
            output.graph.network.private_route_table_ids[az] == "route/\${az}" &&
            output.graph.database[az].subnet_id == "database/\${az}" &&
            output.graph.database[az].route_table_id == "database-route/\${az}" &&
            output.graph.public[az].subnet_id == "public/\${az}" &&
            output.graph.public[az].route_table_id == "public-route" &&
            output.graph.routes[az].nat_gateway_id == "nat/\${az}" &&
            output.graph.routes[az].route_table_id == "route/\${az}" &&
            output.graph.nats[az].subnet_id == "public/\${az}" &&
            output.graph.nats[az].allocation_id == "eip/\${az}" &&
            output.graph.routes[az].nat_gateway_id != "nat/\${lost}" &&
            output.graph.nats[az].subnet_id != "public/\${lost}" &&
            alltrue([for cell in keys(var.cells) : output.graph.network.cells[cell].private_subnet_ids[az] == "cell/\${cell}/\${az}" &&
            output.graph.cells["\${cell}/\${az}"].subnet_id == "cell/\${cell}/\${az}" &&
            output.graph.cells["\${cell}/\${az}"].route_table_id == "route/\${az}" &&
            output.graph.cells["\${cell}/\${az}"].route_table_id != "route/\${lost}"]),false) if az != lost]]))
        error_message="Each surviving zone path must avoid the removed zone resources"
      }
    }`);
  await execute('git', ['init', '--quiet', directory], options);
  await execute('git', ['-C', directory, 'add', 'deploy/aws'], options);
  assert.match(await runSuite('network', { directory: join(directory, 'deploy/aws') }), /Success! 1 passed, 0 failed/);
});

test('network plans retain the primary paths, subnet boundaries and exact invalid-input refusals', async () => {
  assert.match(await runSuite('network'), /Success! 28 passed, 0 failed/);
});
