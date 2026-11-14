import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as integration from './test-cloud-integration.mjs';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('paid remote command failure retains bounded stderr and its exit status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paid-remote-command-'));
  const originalPath = process.env.PATH;
  try {
    await writeFile(join(directory, 'docker'), `#!${process.execPath}
process.stderr.write('discarded-prefix'+'x'.repeat(9000)+'\\nAssertionError: integration.paid_remote_certificate_binding\\n');
process.exitCode=23;
`, {mode: 0o700});
    process.env.PATH = directory + ':' + originalPath;
    assert.equal(typeof integration.integrationCommand, 'function');
    await assert.rejects(integration.integrationCommand(['exec', 'synthetic-client'], '', 'client-paid-remote'), error => {
      assert.match(error.message, /integration.command_failed:client-paid-remote/);
      assert.equal(error.diagnostic.exitCode, 23);
      assert.equal(error.diagnostic.signal, null);
      assert.match(error.diagnostic.stderr, /AssertionError: integration.paid_remote_certificate_binding/);
      assert.equal(error.diagnostic.stderr.length, 8192);
      assert.equal(error.diagnostic.stderr.includes('discarded-prefix'), false);
      assert.equal(error.diagnostic.stderrTruncated, true);
      return true;
    });
  } finally {process.env.PATH = originalPath; await rm(directory, {recursive: true, force: true});}
});

test('private stream failures reveal only a named invariant',()=>{
  assert.equal(typeof integration.streamCommandDiagnostic,'function','Filtered stream diagnostics are missing');
  assert.equal(integration.streamCommandDiagnostic('AssertionError: integration.stream_recoverableAt\nPRIVATE_CANARY'),':integration.stream_recoverableAt');
  assert.equal(integration.streamCommandDiagnostic('integration.stream_observer\nPRIVATE_CANARY'),':integration.stream_observer');
  assert.equal(integration.streamCommandDiagnostic('integration.stream_snapshot\nPRIVATE_CANARY'),':integration.stream_snapshot');
  for(const text of ['PRIVATE_CANARY','integration.stream_PRIVATE_CANARY','integration.stream_recoverableAtPRIVATE_CANARY','token=PRIVATE_CANARY']) assert.equal(integration.streamCommandDiagnostic(text),'');
});

test('stream-start failures retain child status and safe stderr without private bytes',()=>{
  assert.equal(typeof integration.streamStartCommandDiagnostic,'function','Child failure details are missing');
  assert.equal(integration.streamStartCommandDiagnostic('AssertionError [ERR_ASSERTION]: integration.fixture_refused\nPRIVATE_CANARY',23,null),
    ':exit=23:signal=none:stderr=ERR_ASSERTION,integration.fixture_refused');
  assert.equal(integration.streamStartCommandDiagnostic('token=PRIVATE_CANARY',null,'SIGKILL'),
    ':exit=null:signal=SIGKILL:stderr=redacted');
});

// A start refusal or deadline must identify its fixed category without echoing credentials.
test('client-start failures keep local refusal and timeout categories private',()=>{
  assert.equal(integration.streamStartCommandDiagnostic('AssertionError [ERR_ASSERTION]: integration.local_start\nPRIVATE_CANARY',1,null),
    ':exit=1:signal=none:stderr=ERR_ASSERTION,integration.local_start');
  assert.equal(integration.streamStartCommandDiagnostic('DOMException [TimeoutError]: PRIVATE_CANARY',1,null),
    ':exit=1:signal=none:stderr=TimeoutError');
});

test('client-start refusal keeps only its HTTP status and known Cloud error',()=>{
  assert.equal(integration.streamStartCommandDiagnostic('ERR_ASSERTION integration.local_start:http=503:cloud.unavailable PRIVATE_CANARY',1,null),
    ':exit=1:signal=none:stderr=ERR_ASSERTION,integration.local_start,cloud.unavailable:http=503');
  assert.equal(integration.streamStartCommandDiagnostic('ERR_ASSERTION integration.local_start:http=PRIVATE_CANARY:cloud.PRIVATE_CANARY',1,null),
    ':exit=1:signal=none:stderr=ERR_ASSERTION,integration.local_start');
});
