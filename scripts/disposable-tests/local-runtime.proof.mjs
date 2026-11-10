// Opt in explicitly on the dedicated host; ordinary CI never imports this proof.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LocalLeases} from './leases.mjs';
import {runLocal} from './local.mjs';
import * as transport from './transport.mjs';

const [host, recipe, source, ledger, ...privatePackages] = process.argv.slice(2);
test('the Mac controller runs actual PostgreSQL checks, preserves exit3 and releases verified absence', {timeout: 900000}, async () => {
  assert.equal(typeof transport.SSHTransport, 'function', 'The real SSH transport must exist');
  const leases = new LocalLeases(ledger, {hostGeneration: 'controller-'+Date.now(), slots: 1, bootstrap:true});
  const request = {lane: 'I', turn: 'postgres-exit3', snapshot: createHash('sha256').update(readFileSync(source)).digest('hex'),
    argv: ['node','scripts/test-postgres.mjs','exec','pnpm','--dir','packages/registration','exec','node','-e',
      "const{spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['--test','test/monitoring.test.ts'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||125);console.log('LOCAL-COMMAND-COMPLETE');process.exit(3)"]};
  const result = await runLocal({leases, request, transport: new transport.SSHTransport({host, recipe, source, privatePackages}), durationMs: 1200000});
  console.log('LOCAL-TURN-RECEIPT', JSON.stringify(result));
  assert.equal(result.code, 3);
  assert.equal(result.cleanup, 'absent');
  assert.equal(leases.inspect().slots[0].state, 'free');
});
