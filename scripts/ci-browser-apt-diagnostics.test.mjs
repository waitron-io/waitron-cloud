import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const prelude = `
import json, subprocess, sys
sys.dont_write_bytecode = True
sys.path.insert(0, 'scripts/fixtures')
from ci_apt_diagnostics import run_apt
requests = ['/second/dists/noble/InRelease']
`;

async function probe(body) {
  try {
    return await execute('python3', ['-c', prelude + body], {timeout: 10000, maxBuffer: 2 ** 20});
  } catch (error) {
    assert.fail(`Diagnostic probe failed: ${error.stderr}`);
  }
}

for (const stage of ['update', 'download']) {
  // Removing the timeout report must lose the partial child output, not the refusal.
  test(`APT ${stage} timeout exposes partial progress and retains the original exception`, async () => {
    const {stdout, stderr} = await probe(`
command = [sys.executable, '-c', 'import os, time; os.write(1, b"Download attempt 1/1\\\\n"); os.write(2, b"waiting for index\\\\xff"); time.sleep(30)']
try:
    run_apt(command, stage='${stage}', scenario='runner-indexes', mode='fallback',
            requests=requests, request_start=0, capture_output=True, text=True, timeout=2)
except subprocess.TimeoutExpired as error:
    assert error.cmd == command and error.timeout == 2
    assert error.stdout == b'Download attempt 1/1\\n'
    assert error.stderr == b'waiting for index\\xff'
    print('original timeout retained')
else:
    raise AssertionError('timeout was swallowed')
`);
    assert.equal(stdout.trim(), 'original timeout retained');
    assert.match(stderr, /apt-fixture-failure/);
    assert.deepEqual(JSON.parse(stderr), {
      event: 'apt-fixture-failure', stage, scenario: 'runner-indexes', mode: 'fallback',
      reason: 'TimeoutExpired', timeout: 2,
      stdoutTail: 'Download attempt 1/1\n', stderrTail: 'waiting for index�',
      requestCount: 1, requestTail: ['/second/dists/noble/InRelease'],
    });
  });
}

// Losing the exit record must hide the failing stage; reporting must not alter its result.
test('APT nonzero exit reports its stage and returns the original captured result', async () => {
  const {stdout, stderr} = await probe(`
result = run_apt([sys.executable, '-c', 'import sys; print("Hash Sum mismatch", file=sys.stderr); sys.exit(23)'],
                 stage='download', scenario='single-component', mode='package-hash',
                 requests=requests, request_start=1, capture_output=True, text=True, timeout=2)
assert result.returncode == 23 and result.stdout == '' and result.stderr == 'Hash Sum mismatch\\n'
print('original result retained')
`);
  assert.equal(stdout.trim(), 'original result retained');
  assert.ok(stderr.length > 0, 'failure evidence is missing');
  assert.deepEqual(JSON.parse(stderr), {
    event: 'apt-fixture-failure', stage: 'download', scenario: 'single-component', mode: 'package-hash',
    reason: 'exit', returncode: 23, stdoutTail: '', stderrTail: 'Hash Sum mismatch\n',
    requestCount: 0, requestTail: [],
  });
});

// Reporting on success would pollute the fixture's single JSON result stream.
test('APT success stays silent and preserves command options and output', async () => {
  const {stdout, stderr} = await probe(`
import tempfile
from pathlib import Path
with tempfile.TemporaryDirectory() as directory:
    Path(directory, 'expected').write_text('download bytes')
    result = run_apt([sys.executable, '-c', 'from pathlib import Path; print(Path("expected").read_text())'],
                     stage='download', scenario='runner-indexes', mode='fallback',
                     requests=requests, request_start=0, cwd=directory,
                     capture_output=True, text=True, timeout=2)
    assert result.returncode == 0 and result.stdout == 'download bytes\\n' and result.stderr == ''
print('success unchanged')
`);
  assert.equal(stdout.trim(), 'success unchanged');
  assert.equal(stderr, '');
});

// Omitting either cap would let a failed fixture flood the parent test's bounded buffer.
test('APT failure evidence bounds output and keeps only this stage request tail', async () => {
  const {stdout, stderr} = await probe(`
requests.extend('/second/index-' + str(i) + '-' + 'x' * 500 for i in range(30))
result = run_apt([sys.executable, '-c', 'import sys; print("a" * 20000 + "stdout-end"); print("b" * 20000 + "stderr-end", file=sys.stderr); sys.exit(7)'],
                 stage='update', scenario='multi-component', mode='fallback',
                 requests=requests, request_start=1, capture_output=True, text=True, timeout=2)
assert len(result.stdout) == 20011 and len(result.stderr) == 20011 and result.returncode == 7
print('full result retained')
`);
  assert.equal(stdout.trim(), 'full result retained');
  assert.ok(stderr.length > 0, 'failure evidence is missing');
  const record = JSON.parse(stderr);
  assert.equal(record.stdoutTail, 'a'.repeat(4085) + 'stdout-end\n');
  assert.equal(record.stderrTail, 'b'.repeat(4085) + 'stderr-end\n');
  assert.equal(record.requestCount, 30);
  assert.deepEqual(record.requestTail, Array.from({length: 16}, (_, i) =>
    (`/second/index-${i + 14}-` + 'x'.repeat(500)).slice(0, 200)));
  assert.ok(stderr.length < 13000);
});

// Taking a request snapshot before the child runs would lose the progress being diagnosed.
test('APT failure includes requests received while the child was running', async () => {
  const {stdout, stderr} = await probe(`
import http.server, threading
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args): pass
    def do_GET(self):
        requests.append(self.path)
        self.send_response(200)
        self.end_headers()
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever)
thread.start()
try:
    result = run_apt([sys.executable, '-c', 'import urllib.request, sys; urllib.request.urlopen(sys.argv[1]).read(); sys.exit(9)',
                      'http://127.0.0.1:' + str(server.server_port) + '/second/dists/noble/main/binary-amd64/Packages.xz'],
                     stage='update', scenario='runner-indexes', mode='fallback',
                     requests=requests, request_start=1, capture_output=True, text=True, timeout=2)
    assert result.returncode == 9
finally:
    server.shutdown()
    server.server_close()
    thread.join()
print('request captured')
`);
  assert.equal(stdout.trim(), 'request captured');
  const record = JSON.parse(stderr);
  assert.equal(record.requestCount, 1);
  assert.deepEqual(record.requestTail, ['/second/dists/noble/main/binary-amd64/Packages.xz']);
});
