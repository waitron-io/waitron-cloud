// A child-scoped hook stops only the validated service this invocation just created.
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const args = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let interrupted = false;
globalThis.isolationStateProbe = (command, argv, options) => {
  if (!interrupted && command === 'docker' && argv[0] === 'exec' && argv[2] === 'node' && argv[3] === '-e') {
    const inspect = spawnSync('docker', ['inspect', argv[1]], {encoding:'utf8',timeout:15000});
    if (inspect.status !== 0) throw Error('Cannot inspect controlled service');
    const container = JSON.parse(inspect.stdout)[0];
    if (container.Config.Labels['io.waitron.cloud-cost.role'] === 's3') {
      if (container.Id !== argv[1] || container.Config.Labels['io.waitron.cloud-cost.owner'] !== args.journal.token
        || container.Config.Labels['com.docker.compose.project'] !== args.prepared.project) throw Error('Unowned service');
      const stopped = spawnSync('docker', ['stop', '--time', '1', container.Id], {encoding:'utf8',timeout:15000});
      if (stopped.status !== 0) throw Error('Cannot stop controlled service');
      interrupted = true;
      if (process.argv[3] === 'abrupt') process.exit(75);
    }
  }
  return spawnSync(command, argv, options);
};
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'node:child_process' && context.parentURL?.endsWith('/local.mjs')) return {
    url: 'data:text/javascript,' + encodeURIComponent(`export {spawn} from 'node:child_process';
      export const spawnSync = (...args) => globalThis.isolationStateProbe(...args);`), shortCircuit:true,
  };
  return next(specifier, context);
}});
const local = await import('../local.mjs');
let stack;
try {
  stack = await local.startIsolatedStack(args);
  throw Error('Controlled interruption was admitted');
} catch (error) {
  if (!error.diagnostic || !interrupted) throw Error('Controlled interruption did not reach isolation');
  console.log(JSON.stringify({interrupted,diagnostic:error.diagnostic}));
} finally { await stack?.close(); }
