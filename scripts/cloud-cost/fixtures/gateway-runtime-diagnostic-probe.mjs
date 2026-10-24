// Redirect only the host mount and external binary; exercise the real runtime and child lifecycle.
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { join } from 'node:path';
const [root, fault] = process.argv.slice(2);
globalThis.gatewayRuntimeProbe = {
  writeFileSync(path, ...args) {
    if (!path.startsWith('/state/')) throw Error('Unexpected runtime write');
    if (fault === 'record-failure' && !path.endsWith('haproxy.cfg')) throw Error('PRIVATE_CANARY');
    return fs.writeFileSync(join(root, path.slice(7)), ...args);
  },
  spawn(command, args, options) {
    if (command !== 'haproxy') throw Error('Unexpected runtime binary');
    const outputs = {
      dns: "[ALERT] : 'server venue' : could not resolve address 'PRIVATE_CANARY'.",
      split: "[ALERT] : could not resolve address 'PRIVATE_CANARY'.",
      bind: '[ALERT] : cannot bind socket (PRIVATE_CANARY)',
      tls: '[ALERT] : unable to load certificate from file PRIVATE_CANARY',
      unknown: 'PRIVATE_CANARY',
    };
    if (fault === 'spawn') return spawn('/nonexistent-cloud-cost-haproxy', args, options);
    const output = outputs[fault] ?? 'PRIVATE_CANARY';
    const code = fault === 'success' ? 'process.exit(0)' : fault === 'signal'
      ? "process.kill(process.pid, 'SIGTERM')" : fault === 'overflow'
      ? "process.stderr.write('PRIVATE_CANARY'.repeat(100000));process.exitCode=1;" : fault === 'late-dns'
      ? "process.stderr.write('PRIVATE_CANARY'.repeat(1000)+\"could not resolve address 'PRIVATE_CANARY'\");process.exitCode=1;" : fault === 'unicode-limit'
      ? "process.stderr.write('界'.repeat(3000)+\"could not resolve address 'PRIVATE_CANARY'\");process.exitCode=1;" : fault === 'split'
      ? `process.stderr.write(${JSON.stringify(output.slice(0, 22))}); setTimeout(() => {process.stderr.write(${JSON.stringify(output.slice(22))});process.exitCode=1;},10)`
      : `process.stderr.write(${JSON.stringify(output)});process.exitCode=1;`;
    return spawn(process.execPath, ['-e', code], options);
  },
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/stack-runtime.mjs') && specifier === 'node:fs') return {
    url: 'data:text/javascript,' + encodeURIComponent(`export {readFileSync,appendFileSync,mkdirSync} from 'node:fs';
      export const writeFileSync=(...args)=>globalThis.gatewayRuntimeProbe.writeFileSync(...args);`), shortCircuit: true,
  };
  if (context.parentURL?.endsWith('/stack-runtime.mjs') && specifier === 'node:child_process') return {
    url: 'data:text/javascript,' + encodeURIComponent(`export {spawnSync} from 'node:child_process';
      export const spawn=(...args)=>globalThis.gatewayRuntimeProbe.spawn(...args);`), shortCircuit: true,
  };
  return next(specifier, context);
} });
const { runStackService } = await import('../stack-runtime.mjs');
try { await runStackService('gateway'); }
catch { process.exitCode = 1; }
