// Selecting the gateway through Compose must bring its backend up before HAProxy resolves it.
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plan = JSON.parse(readFileSync(args.prepared.file, 'utf8'));
let selected = false;
globalThis.gatewayOrderProbe = (command, argv, options) => {
  if (command === 'docker' && argv[0] === 'compose' && argv[3] === 'up') {
    if (selected) throw Error('Gateway selection repeated');
    selected = true;
    const result = spawnSync(command, [...argv, 'gateway'], options);
    if (result.status !== 0) return result;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const inspected = spawnSync('docker', ['inspect', plan.services.gateway.container_name],
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
      if (inspected.status !== 0) throw Error('Cannot inspect selected gateway');
      const [gateway] = JSON.parse(inspected.stdout);
      if (gateway.Config.Labels['io.waitron.cloud-cost.owner'] !== args.journal.token
        || gateway.Config.Labels['com.docker.compose.project'] !== args.prepared.project) throw Error('Unowned gateway');
      if (!gateway.State.Running) {
        let runtime = null;
        try { runtime = JSON.parse(readFileSync(join(args.stateRoot, 'gateway-failure.json'), 'utf8')); }
        catch { /* A killed gateway may leave no runtime evidence; its stopped state still refuses. */ }
        console.error('gateway_order=' + JSON.stringify({ running: false, runtime }));
        return { status: 1, stdout: '', stderr: '' };
      }
      const lookup = spawnSync('docker', ['exec', gateway.Id, 'node', '-e',
        "require('node:dns').lookup('waitron',error=>process.exit(error?1:0))"],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
      if (lookup.status === 0) {
        console.error('gateway_order=' + JSON.stringify({ running: true, backendResolved: true }));
        return spawnSync(command, argv, options);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    throw Error('Selected gateway did not resolve its backend');
  }
  return spawnSync(command, argv, options);
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'node:child_process' && context.parentURL?.endsWith('/local.mjs')) return {
    url: 'data:text/javascript,' + encodeURIComponent(`export {spawn} from 'node:child_process';
      export const spawnSync=(...args)=>globalThis.gatewayOrderProbe(...args);`), shortCircuit: true,
  };
  return next(specifier, context);
} });
const { startIsolatedStack } = await import('../local.mjs');
let stack;
try {
  stack = await startIsolatedStack(args);
  if (!selected) throw Error('Compose selection was not exercised');
  console.log(JSON.stringify({ ready: stack.ready, isolation: stack.isolation }));
} finally { await stack?.close(); }
