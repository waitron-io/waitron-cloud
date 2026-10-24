import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('gateway startup probe reports a stopped gateway when its failure file is absent', t => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-order-control-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plan = join(root, 'plan.json'), config = join(root, 'probe.json'), bootstrap = join(root, 'bootstrap.mjs');
  writeFileSync(plan, JSON.stringify({ services: { gateway: { container_name: 'controlled-gateway' } } }));
  writeFileSync(config, JSON.stringify({ prepared: { file: plan, project: 'controlled-project' },
    journal: { token: 'controlled-owner' }, stateRoot: root }));
  writeFileSync(bootstrap, `import {registerHooks} from 'node:module';
    globalThis.controlledDocker=(command,argv)=>argv[0]==='inspect'
      ?{status:0,stdout:JSON.stringify([{Config:{Labels:{'io.waitron.cloud-cost.owner':'controlled-owner',
        'com.docker.compose.project':'controlled-project'}},State:{Running:false}}])}
      :{status:0,stdout:''};
    registerHooks({resolve(specifier,context,next){
      if(context.parentURL?.endsWith('/gateway-startup-order-probe.mjs')) {
        if(specifier==='node:child_process')return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(
          'export const spawnSync=(...args)=>globalThis.controlledDocker(...args);')};
        if(specifier==='../local.mjs')return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(
          "export async function startIsolatedStack(){const result=globalThis.gatewayOrderProbe('docker',['compose','-f','plan','up'],{});if(result.status!==0)throw Error('Controlled startup refusal');}")};
      }
      return next(specifier,context);
    }});`);
  const result = spawnSync(process.execPath, ['--import', bootstrap,
    new URL('./fixtures/gateway-startup-order-probe.mjs', import.meta.url).pathname, config],
  { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gateway_order=\{"running":false,"runtime":null\}/);
  assert.match(result.stderr, /Controlled startup refusal/);
  assert.equal(result.stderr.includes('ENOENT'), false);
});
