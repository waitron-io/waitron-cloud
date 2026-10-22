import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const installer = fileURLToPath(new URL('./prepare.py', import.meta.url));
async function python(t, body) {
  const scratch = await mkdtemp(join(tmpdir(), 'cloud-aws-archives-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  return execute('python3', ['-B', '-c', `
import hashlib, pathlib, runpy, stat, sys, zipfile
install = runpy.run_path(sys.argv[1])['install_archive']
root = pathlib.Path(sys.argv[2])
archive, output = root/'software.zip', root/'installed'
with zipfile.ZipFile(archive, 'w') as package:
    package.writestr('tofu', b'pinned executable')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
${body}
`, installer, scratch], { timeout: 10_000, env: { PATH: process.env.PATH }, maxBuffer: 1024 * 1024 });
}

// Removing checksum verification must install corrupt bytes and fail the refusal assertion.
test('archive checksum mismatch leaves no installed executable', async (t) => {
  await python(t, `
try:
    install(archive, '0'*64, 'tofu', output)
except ValueError as error:
    assert 'checksum' in str(error), str(error)
else:
    raise AssertionError('corrupt executable installed')
assert not output.exists()
`);
});
test('verified executable is installed with fixed bytes and executable permissions', async (t) => {
  await python(t, `
install(archive, digest, 'tofu', output)
assert output.is_file(), 'verified executable was not installed'
assert output.read_bytes() == b'pinned executable'
assert stat.S_IMODE(output.stat().st_mode) == 0o755
`);
});
for (const [label, entries, member] of [
  ['missing executable', "[('unrelated', b'other')]", 'tofu'],
  ['duplicate executable', "[('tofu', b'first'), ('tofu', b'second')]", 'tofu'],
  ['traversal member', "[('../escape', b'escape')]", '../escape'],
]) {
  test(`archive refuses ${label}`, async (t) => {
    await python(t, `
with zipfile.ZipFile(archive, 'w') as package:
    for name, data in ${entries}:
        package.writestr(name, data)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
try:
    install(archive, digest, ${JSON.stringify(member)}, output)
except ValueError as error:
    assert 'executable' in str(error) or 'member' in str(error), str(error)
else:
    raise AssertionError('invalid executable installed')
assert not output.exists()
`);
  });
}
test('archive refuses symlink executable entries', async (t) => {
  await python(t, `
with zipfile.ZipFile(archive, 'w') as package:
    entry = zipfile.ZipInfo('tofu')
    entry.create_system = 3
    entry.external_attr = (stat.S_IFLNK | 0o777) << 16
    package.writestr(entry, b'/outside')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
try:
    install(archive, digest, 'tofu', output)
except ValueError as error:
    assert 'executable' in str(error), str(error)
else:
    raise AssertionError('symlink executable installed')
assert not output.exists()
`);
});

async function downloadCase(t, body) {
  return python(t, `
import io
fetch = runpy.run_path(sys.argv[1])['download']
class Response(io.BytesIO):
    def geturl(self):
        return 'https://releases.hashicorp.com/terraform-provider-aws/6.42.0/software.zip'
url = 'https://releases.hashicorp.com/terraform-provider-aws/6.42.0/software.zip'
${body}
`);
}
test('software download writes the response through a bounded request', async (t) => {
  await downloadCase(t, `
requests = []
def opening(address, *, timeout):
    requests.append((address, timeout))
    return Response(b'verified later')
fetch(url, output, open_url=opening)
assert output.is_file(), 'downloaded bytes were not written'
assert output.read_bytes() == b'verified later'
assert requests == [(url, 15)]
`);
});
for (const [label, expression, expected] of [
  ['plain HTTP', "url.replace('https:', 'http:')", 'HTTPS'],
  ['unrecognised host', "'https://untrusted.invalid/software.zip'", 'official'],
  ['URL credentials', "url.replace('https://', 'https://secret@')", 'credentials'],
]) {
  test(`software download refuses ${label} before opening a request`, async (t) => {
    await downloadCase(t, `
requests = []
try:
    fetch(${expression}, output, open_url=lambda *a, **kw: (requests.append(a) or Response(b'unsafe bytes')))
except ValueError as error:
    assert ${JSON.stringify(expected)} in str(error), str(error)
else:
    raise AssertionError('unsafe download admitted')
assert requests == []
assert not output.exists()
`);
  });
}
test('software download refuses an oversized response and removes its partial file', async (t) => {
  await downloadCase(t, `
try:
    fetch(url, output, open_url=lambda *a, **kw: Response(b'12345'), max_bytes=4)
except ValueError as error:
    assert 'limit' in str(error), str(error)
else:
    raise AssertionError('oversized download admitted')
assert not output.exists()
`);
});
test('software download refuses a total deadline even when individual reads succeed', async (t) => {
  await downloadCase(t, `
ticks = iter([0, 181])
try:
    fetch(url, output, open_url=lambda *a, **kw: Response(b'12345'), clock=lambda: next(ticks))
except TimeoutError as error:
    assert 'deadline' in str(error), str(error)
else:
    raise AssertionError('unbounded download admitted')
assert not output.exists()
`);
});
test('software download refuses a redirect to an unofficial source', async (t) => {
  await downloadCase(t, `
class UntrustedResponse(Response):
    def geturl(self):
        return 'https://untrusted.invalid/software.zip'
try:
    fetch(url, output, open_url=lambda *a, **kw: UntrustedResponse(b'12345'))
except ValueError as error:
    assert 'official' in str(error), str(error)
else:
    raise AssertionError('unofficial redirect admitted')
assert not output.exists()
`);
});
test('software download removes partial output after a read fails', async (t) => {
  await downloadCase(t, `
class BrokenResponse(Response):
    def read(self, size):
        if self.tell():
            raise OSError('synthetic connection loss')
        return super().read(size)
try:
    fetch(url, output, open_url=lambda *a, **kw: BrokenResponse(b'partial'))
except OSError as error:
    assert 'connection loss' in str(error)
else:
    raise AssertionError('connection loss was hidden')
assert not output.exists()
`);
});

async function prepareCase(t, body) {
  return python(t, `
import json, shutil
copy = root/'prepare.py'
shutil.copyfile(sys.argv[1], copy)
archives = {}
software = {}
for name, member, data in [('tofu', 'tofu', b'tofu executable'), ('aws', 'terraform-provider-aws_v6.42.0_x5', b'provider executable')]:
    archive = root/(name+'.zip')
    with zipfile.ZipFile(archive, 'w') as package:
        package.writestr(member, data)
    address = 'https://releases.hashicorp.com/'+name+'.zip'
    software[name] = {'version': '1.11.0' if name == 'tofu' else '6.42.0', 'platforms': {'arm64': {'url': address, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'member': member}}}
    archives[address] = archive
(root/'tools-pins.json').write_text(json.dumps(software))
prepare = runpy.run_path(str(copy))['prepare']
requests = []
def fetch(address, destination):
    requests.append(address)
    shutil.copyfile(archives[address], destination)
${body}
`);
}
test('preparation installs the verified tools in the versioned offline mirror', async (t) => {
  await prepareCase(t, `
prepare(root/'tools', architecture='aarch64', fetch=fetch)
assert (root/'tools/bin/tofu').is_file(), 'prepared tool was not installed'
assert (root/'tools/bin/tofu').read_bytes() == b'tofu executable'
provider = root/'tools/provider-mirror/registry.opentofu.org/hashicorp/aws/6.42.0/linux_arm64/terraform-provider-aws_v6.42.0_x5'
assert provider.read_bytes() == b'provider executable'
assert stat.S_IMODE(provider.stat().st_mode) == 0o755
assert requests == ['https://releases.hashicorp.com/tofu.zip', 'https://releases.hashicorp.com/aws.zip']
assert not list(root.glob('tools/**/*.zip'))
`);
});
test('preparation refuses an unsupported architecture before downloading', async (t) => {
  await prepareCase(t, `
try:
    prepare(root/'tools', architecture='unqualified-cpu', fetch=fetch)
except ValueError as error:
    assert 'architecture' in str(error), str(error)
else:
    raise AssertionError('unsupported architecture admitted')
assert requests == []
assert not (root/'tools').exists()
`);
});
test('preparation never installs provider bytes with the wrong pinned digest', async (t) => {
  await prepareCase(t, `
software['aws']['platforms']['arm64']['sha256'] = '0'*64
(root/'tools-pins.json').write_text(json.dumps(software))
try:
    prepare(root/'tools', architecture='arm64', fetch=fetch)
except ValueError as error:
    assert 'checksum' in str(error), str(error)
else:
    raise AssertionError('unverified provider installed')
assert not list((root/'tools').glob('provider-mirror/**/*aws_v*'))
assert not list(root.glob('tools/**/*.zip'))
`);
});

test('download ignores ambient authenticated proxy settings before connecting', async (t) => {
  await downloadCase(t, `
import os, socket
os.environ['HTTPS_PROXY'] = 'http://synthetic:credential@127.0.0.1:12345'
os.environ['https_proxy'] = os.environ['HTTPS_PROXY']
connections = []
def connecting(address, *args, **kwargs):
    connections.append(address)
    raise OSError('synthetic boundary refusal')
socket.create_connection = connecting
try:
    fetch(url, output)
except OSError as error:
    assert 'synthetic boundary refusal' in str(error), str(error)
else:
    raise AssertionError('connection refusal hidden')
assert connections == [('releases.hashicorp.com', 443)], connections
assert not output.exists()
`);
});
test('redirect validation refuses unofficial destinations before a follow-up request', async (t) => {
  await downloadCase(t, `
import urllib.request
handler = runpy.run_path(sys.argv[1])['OfficialRedirect']()
try:
    handler.redirect_request(urllib.request.Request(url), None, 302, 'Found', {}, 'https://untrusted.invalid/software.zip')
except ValueError as error:
    assert 'official' in str(error), str(error)
else:
    raise AssertionError('unofficial follow-up request constructed')
`);
});

test('preparation submits only the fixed software build context to Docker', async () => {
  const { prepareTools } = await import('./tools.mjs');
  const { readdir, readFile, access } = await import('node:fs/promises');
  let context;
  let calls = 0;
  await prepareTools({ execute: async (file, args, options) => {
    calls++;
    assert.equal(file, 'docker');
    assert.deepEqual(args.slice(0, 4), ['build', '--pull=false', '--tag', 'waitron-cloud-aws-tools:1.11.0-aws6.42.0']);
    assert.equal(args.length, 5);
    context = args[4];
    assert.match(context, /cloud-aws-tool-build-/);
    assert.deepEqual((await readdir(context)).sort(), ['.dockerignore', 'Dockerfile', 'prepare.py', 'test-cli.tfrc', 'tools-pins.json', 'tools-requirements.txt']);
    const pins = JSON.parse(await readFile(join(context, 'tools-pins.json'), 'utf8'));
    assert.equal(pins.tofu.version, '1.11.0');
    assert.equal(pins.aws.version, '6.42.0');
    assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH']);
    assert.equal(options.timeout, 420_000);
    return { stdout: 'synthetic build completion', stderr: '' };
  } });
  assert.equal(calls, 1);
  await assert.rejects(access(context), { code: 'ENOENT' });
});
test('preparation propagates Docker failure and removes its disposable context', async (t) => {
  const { prepareTools } = await import('./tools.mjs');
  const { access } = await import('node:fs/promises');
  let context;
  t.after(() => context && rm(context, { recursive: true, force: true }));
  await assert.rejects(prepareTools({ execute: async (_, args) => {
    context = args[4];
    throw new Error('synthetic tool-build deadline');
  } }), /synthetic tool-build deadline/);
  await assert.rejects(access(context), { code: 'ENOENT' });
});

test('software build refuses a linked input before submitting a context', async (t) => {
  const { cp, symlink } = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'cloud-aws-linked-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL('.', import.meta.url)), dir, { recursive: true });
  await rm(join(dir, 'tools-pins.json'));
  await symlink('/etc/passwd', join(dir, 'tools-pins.json'));
  const { prepareTools } = await import(pathToFileURL(join(dir, 'tools.mjs')).href);
  let submitted = false;
  await assert.rejects(prepareTools({ execute: async () => { submitted = true; } }), /build input.*symlink/);
  assert.equal(submitted, false);
});

test('preparation CLI completes a pinned local software image', { timeout: 450_000 }, async () => {
  await execute(process.execPath, [fileURLToPath(new URL('./check.mjs', import.meta.url)), '--prepare-tools'],
    { timeout: 440_000, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const { stdout } = await execute('docker', ['image', 'inspect', 'waitron-cloud-aws-tools:1.11.0-aws6.42.0'],
    { timeout: 15_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const [prepared] = JSON.parse(stdout);
  assert.match(prepared.Id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(prepared.Config.User, '65532:65532');
  assert.ok(prepared.Config.Env.includes('TF_CLI_CONFIG_FILE=/opt/test-cli.tfrc'));
});

for (const kind of ['directory', 'oversized file']) {
  test(`software build refuses a ${kind} input before submitting a context`, async (t) => {
    const { cp, mkdir, writeFile } = await import('node:fs/promises');
    const { pathToFileURL } = await import('node:url');
    const dir = await mkdtemp(join(tmpdir(), 'cloud-aws-invalid-tools-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await cp(fileURLToPath(new URL('.', import.meta.url)), dir, { recursive: true });
    await rm(join(dir, 'tools-pins.json'));
    if (kind === 'directory') await mkdir(join(dir, 'tools-pins.json'));
    else await writeFile(join(dir, 'tools-pins.json'), Buffer.alloc(1024 * 1024 + 1));
    const { prepareTools } = await import(pathToFileURL(join(dir, 'tools.mjs')).href);
    let submitted = false;
    await assert.rejects(prepareTools({ execute: async () => { submitted = true; } }), /Unsupported software build input/);
    assert.equal(submitted, false);
  });
}
