import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, lstat, realpath, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareTools, toolsImage } from './tools.mjs';

const runProcess = promisify(execFile);
const inspector = fileURLToPath(new URL('./inspect.py', import.meta.url));

function isSource(name) {
  return /\.(?:tf|tofu|tfvars|tftest\.hcl|tofutest\.hcl|tf\.json|tofu\.json|tftest\.json|tofutest\.json|tfvars\.json)$/.test(name);
}

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
    } else if (isSource(entry.name)) {
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`${entry.name}: unsupported source file`);
      await writeFile(to, await readFile(from), { mode: 0o644 });
    }
  }
}

async function copyTrackedSources(source, target) {
  if ((await lstat(source)).isSymbolicLink()) throw new Error('Source root symlink is forbidden');
  const options = { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };
  const git = ['-c', 'core.fsmonitor=false', '-C', source];
  const { stdout: root } = await runProcess('git', [...git, 'rev-parse', '--show-toplevel'], options);
  const repository = await realpath(root.trim());
  if (await realpath(source) !== join(repository, 'deploy/aws')) throw new Error('Tracked source must be the repository deploy/aws directory');
  const { stdout: index } = await runProcess('git', [...git, 'ls-files', '--stage', '-z', '--full-name', '--', '.'], options);
  await mkdir(target, { recursive: true });
  for (const record of index.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, , stage] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (!isSource(path) || path.split('/').some((part) => ['.aws', '.terraform', '.git', 'node_modules'].includes(part))) continue;
    if (stage !== '0') throw new Error('Unresolved Git source conflict');
    if (!['100644', '100755'].includes(mode)) throw new Error('Indexed source mode or symlink is forbidden');
    if (!/^deploy\/aws\/[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('Unsupported indexed source path');
    }
    let from = repository;
    for (const part of path.split('/')) {
      from = join(from, part);
      if ((await lstat(from)).isSymbolicLink()) throw new Error('Indexed source path symlink is forbidden');
    }
    const stat = await lstat(from);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Unsupported indexed source file');
    const to = join(target, path.slice('deploy/aws/'.length));
    await mkdir(resolve(to, '..'), { recursive: true });
    await writeFile(to, await readFile(from), { mode: 0o644 });
  }
}

export async function checkSources(directory, { execute = runProcess, trackedOnly = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'cloud-aws-inspection-'));
  const name = `cloud-aws-inspection-${randomUUID()}`;
  const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };
  let submitted = false;
  try {
    if (trackedOnly) await copyTrackedSources(directory, join(scratch, 'source'));
    else await copySources(directory, join(scratch, 'source'));
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
  if (process.argv.length === 3 && process.argv[2] === '--prepare-tools') {
    try {
      await prepareTools();
      console.log(`Prepared software image ${toolsImage}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } else {
    console.error('Infrastructure suite execution is not implemented; run the source-policy tests documented in docs/aws-infrastructure.md.');
    process.exitCode = 1;
  }
}
