// Opt-in bridge proof: cancel the actual SSH channel during a running command.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LocalLeases} from './leases.mjs';
import {runLocal} from './local.mjs';
import {SSHTransport} from './transport.mjs';

const [host, recipe, source, privatePackage, ledger] = process.argv.slice(2);
test('SSH cancellation stops owned remote work before the Mac ledger grants reuse', {timeout: 900000}, async () => {
  const leases = new LocalLeases(ledger, {hostGeneration: 'cancel-'+Date.now(), slots: 1});
  const cancellation = new AbortController();
  let ready = false, output = '';
  class ObservedTransport extends SSHTransport {
    remote(mode, lease, options = {}) {
      return super.remote(mode, lease, {...options, onOutput: data => {
        process.stdout.write(data);
        output = (output + data.toString()).slice(-65536);
        if (mode === 'execute-v2' && output.includes('SSH-COMMAND-READY')) {
          ready = true;
          cancellation.abort();
        }
      }});
    }
  }
  const transport = new ObservedTransport({host, recipe, source, privatePackage});
  const result = await runLocal({leases, transport, signal: cancellation.signal, durationMs: 900000,
    request: {lane: 'I', turn: 'cancel-real-ssh', snapshot: createHash('sha256').update(readFileSync(source)).digest('hex'),
      argv: ['node', '-e', "console.log('SSH-COMMAND-READY');setInterval(()=>{},1000)"]}});
  console.log('SSH-CANCEL-RECEIPT', JSON.stringify(result));
  assert.equal(ready, true, 'The candidate must actually start before cancellation');
  assert.equal(result.code, 143);
  assert.equal(result.cleanup, 'absent');
  assert.equal(leases.inspect().slots[0].state, 'free');
  const independent = await transport.inspect(result.lease, {signal: AbortSignal.timeout(10000)});
  assert.equal(independent.absent, true);
  assert.equal(independent.operationPresent, false);
});
