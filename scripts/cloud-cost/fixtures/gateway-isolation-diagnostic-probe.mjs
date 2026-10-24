// Give only this invocation's gateway an unresolvable synthetic backend, then observe its real exit.
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const args = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const faultModule = `import {registerHooks} from 'node:module';
globalThis.gatewayConfigFault=(path,value)=>path==='/state/haproxy.cfg'
  ?value.replace('server venue waitron:8080 check','server venue missing-backend.invalid:8080 check'):value;
registerHooks({resolve(specifier,context,next){
 if(specifier==='node:fs'&&context.parentURL?.endsWith('/cost-stack-runtime.mjs'))return {
 url:'data:text/javascript,'+encodeURIComponent(\`import * as fs from 'node:fs';
 export {readFileSync,appendFileSync,mkdirSync} from 'node:fs';
 export const writeFileSync=(path,value,...args)=>fs.writeFileSync(path,globalThis.gatewayConfigFault(path,value),...args);\`),shortCircuit:true};
 return next(specifier,context);
}});`;
writeFileSync(join(args.codeRoot, 'gateway-config-fault.mjs'), faultModule, { mode: 0o600, flag: 'wx' });
const plan = JSON.parse(readFileSync(args.prepared.file, 'utf8'));
plan.services.gateway.command = ['node', '--import', '/code/gateway-config-fault.mjs', '/code/cost-stack-runtime.mjs', 'gateway'];
const bytes = JSON.stringify(plan);
writeFileSync(args.prepared.file, bytes);
const journal = JSON.parse(readFileSync(args.journal.path, 'utf8'));
journal.localResources.find(row => row.kind === 'compose-plan' && row.state === 'ready' && row.path === args.prepared.file).sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(args.journal.path, JSON.stringify(journal));
let observed = false;
globalThis.gatewayIsolationProbe = (command, argv, options) => {
  if (!observed && command === 'docker' && argv[0] === 'exec' && argv[2] === 'node' && argv[3] === '-e') {
    const inspect = () => {
      const result = spawnSync('docker', ['inspect', argv[1]], { encoding: 'utf8', timeout: 15000 });
      if (result.status !== 0) throw Error('Cannot inspect controlled gateway');
      return JSON.parse(result.stdout)[0];
    };
    let container = inspect();
    if (container.Config.Labels['io.waitron.cloud-cost.role'] === 'gateway') {
      if (container.Id !== argv[1] || container.Config.Labels['io.waitron.cloud-cost.owner'] !== args.journal.token
        || container.Config.Labels['com.docker.compose.project'] !== args.prepared.project) throw Error('Unowned gateway');
      const deadline = Date.now() + 5000;
      while (container.State.Running && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        container = inspect();
      }
      if (container.State.Running || container.State.ExitCode !== 1) throw Error('Controlled gateway did not exit');
      observed = true;
    }
  }
  return spawnSync(command, argv, options);
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'node:child_process' && context.parentURL?.endsWith('/local.mjs')) return {
    url: 'data:text/javascript,' + encodeURIComponent(`export {spawn} from 'node:child_process';
      export const spawnSync=(...args)=>globalThis.gatewayIsolationProbe(...args);`), shortCircuit: true,
  };
  return next(specifier, context);
} });
const { startIsolatedStack } = await import('../local.mjs');
let stack;
try {
  stack = await startIsolatedStack(args);
  throw Error('Controlled gateway failure was admitted');
} catch (error) {
  if (!observed || !error.diagnostic) throw Error('Controlled gateway did not reach isolation');
  console.log(JSON.stringify(error.diagnostic));
} finally { await stack?.close(); }
