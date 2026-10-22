import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, lstat, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runProcess = promisify(execFile);
const toolsImage = 'waitron-cloud-aws-tools:task1-parser';
const inspector = fileURLToPath(new URL('./inspect.py', import.meta.url));

async function copySources(source, target) {
  if ((await lstat(source)).isSymbolicLink()) throw new Error('Source root symlink is forbidden');
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    const stat = await lstat(from);
    if (stat.isSymbolicLink()) throw new Error(`${entry.name}: symlink is forbidden`);
    if (entry.isDirectory()) {
      if (['.aws', '.terraform', '.git', 'node_modules'].includes(entry.name)) continue;
      await copySources(from, to);
    } else if (/\.(?:tf|tofu|tfvars|tftest\.hcl|tofutest\.hcl|tf\.json|tofu\.json|tftest\.json|tofutest\.json|tfvars\.json)$/.test(entry.name)) {
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`${entry.name}: unsupported source file`);
      await writeFile(to, await readFile(from), { mode: 0o644 });
    }
  }
}

export async function checkSources(directory, { execute = runProcess } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'cloud-aws-inspection-'));
  const name = `cloud-aws-inspection-${randomUUID()}`;
  const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };
  let submitted = false;
  try {
    await copySources(directory, join(scratch, 'source'));
    await writeFile(join(scratch, 'inspect.py'), await readFile(inspector), { mode: 0o644 });
    submitted = true;
    await execute('docker', [
      'run', '--rm', '--name', name, '--label', `io.waitron.aws-inspection=${name}`, '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
      '--mount', `type=bind,source=${scratch},target=/candidate,readonly`,
      toolsImage, 'python', '-I', '/candidate/inspect.py', '/candidate/source',
    ], options);
  } catch (error) {
    if (error.stderr?.trim()) throw new Error(error.stderr.trim());
    throw error;
  } finally {
    try {
      if (submitted) await cleanupContainer(name, execute, options);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

async function cleanupContainer(name, execute, options) {
  let result;
  try {
    result = await execute('docker', ['container', 'inspect', name], options);
  } catch (error) {
    if (error.stderr?.trim().endsWith(`No such container: ${name}`)
        || error.stderr?.trim().endsWith(`No such object: ${name}`)) return;
    throw new Error('Cannot confirm parser container cleanup', { cause: error });
  }
  const records = JSON.parse(result.stdout);
  if (records.length !== 1 || !/^[a-f0-9]{64}$/.test(records[0].Id)
      || records[0].Config?.Labels?.['io.waitron.aws-inspection'] !== name) {
    throw new Error('Parser container ownership mismatch; cleanup refused');
  }
  await execute('docker', ['container', 'rm', '--force', records[0].Id], options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error('Infrastructure suite execution and tool preparation are not implemented; run the source-policy tests documented in docs/aws-infrastructure.md.');
  process.exitCode = 1;
}
