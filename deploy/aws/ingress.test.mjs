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
for (const name of (await readdir(new URL('modules/ingress/', import.meta.url)).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(name => name.endsWith('.tf'))) {
  documents[name] = await readFile(new URL(`modules/ingress/${name}`, import.meta.url), 'utf8');
}
const container = `cloud-aws-ingress-syntax-${randomUUID()}`;
let parsed;
try {
  const result = await execute('docker', [
    'run', '--rm', '--name', container, '--label', `io.waitron.aws-ingress-syntax=${container}`,
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
    assert.equal(record.Config.Labels['io.waitron.aws-ingress-syntax'], container);
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
// These catch a TLS terminator, a live Kubernetes discovery or an extra public firewall path.
test('ingress owns only network forwarding and scoped firewall paths', () => {
  assert.ok(resources.some(([kind]) => kind === 'aws_lb'), 'Ingress must declare a load balancer');
  const allowed = new Set(['aws_lb', 'aws_lb_listener', 'aws_lb_target_group', 'aws_security_group',
    'aws_vpc_security_group_ingress_rule', 'aws_vpc_security_group_egress_rule']);
  for (const [kind] of resources) assert.ok(allowed.has(kind), kind);
  assert.equal(resources.length, 7, 'No additional firewall or forwarding resource may bypass the admitted paths');
  assert.deepEqual(blocks('data').map(([kind]) => kind).sort(), ['aws_availability_zones', 'aws_region']);
  assert.equal(Object.values(parsed).flatMap(doc => doc.module ?? []).length, 0);
});
test('ingress needs no TLS private key, certificate or image input', () => {
  const names = Object.values(parsed).flatMap(doc => (doc.variable ?? []).flatMap(Object.keys)).filter(key => key !== '__is_block__').map(key => JSON.parse(key));
  assert.deepEqual(names.sort(), ['cell_id', 'network', 'ports', 'scope']);
});
test('forwarding references bind each listener to its own target group without mock identity aliasing', () => {
  const listener = resources.find(([kind]) => kind === 'aws_lb_listener')?.[2];
  assert.equal(listener?.load_balancer_arn, '${aws_lb.cell.arn}');
  assert.equal(listener?.default_action?.[0].target_group_arn, '${aws_lb_target_group.service[each.key].arn}');
  assert.equal(listener?.certificate_arn, undefined);
});
test('standalone firewall rules have no competing inline rule owner', () => {
  const group = resources.find(([kind]) => kind === 'aws_security_group')?.[2];
  assert.equal(group?.ingress, undefined, 'Inline ingress ownership can revoke standalone rules');
  assert.equal(group?.egress, undefined, 'Inline egress ownership can revoke standalone rules');
});
test('ingress plans preserve three-zone TLS and UDP paths and refuse public administration', async () => {
  assert.match(await runSuite('ingress'), /Success! 22 passed, 0 failed/);
});
