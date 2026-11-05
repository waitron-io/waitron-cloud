import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, lstat, realpath, readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareTools, toolsImage } from './tools.mjs';

const runProcess = promisify(execFile);
const inspector = fileURLToPath(new URL('./inspect.py', import.meta.url));

function isSource(name) {
  return name.split('/').at(-1) === '.terraform.lock.hcl' || /\.(?:tf|tofu|tfvars|tftest\.hcl|tofutest\.hcl|tf\.json|tofu\.json|tftest\.json|tofutest\.json|tfvars\.json)$/.test(name);
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
  try {
    if (trackedOnly) await copyTrackedSources(directory, join(scratch, 'source'));
    else await copySources(directory, join(scratch, 'source'));
    await inspectSnapshot(scratch, execute);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function inspectSnapshot(scratch, execute, image = toolsImage) {
  const name = `cloud-aws-inspection-${randomUUID()}`;
  const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };
  let submitted = false;
  try {
    await chmod(scratch, 0o755);
    await writeFile(join(scratch, 'inspect.py'), await readFile(inspector), { mode: 0o644 });
    submitted = true;
    await execute('docker', [
      'run', '--rm', '--name', name, '--label', `io.waitron.aws-inspection=${name}`, '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL', '--user', '65532:65532',
      '--security-opt', 'no-new-privileges', '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
      '--mount', `type=bind,source=${scratch},target=/candidate,readonly`,
      image, 'python', '-I', '/candidate/inspect.py', '/candidate/source',
    ], options);
  } catch (error) {
    if (error.stderr?.trim()) throw new Error(error.stderr.trim());
    throw error;
  } finally {
    if (submitted) await cleanupContainer(name, execute, options);
  }
}

const suites = new Map([
  ['canary', ['canary']],
  ['accounts', ['modules/accounts', 'roots/accounts']],
  ['state', ['modules/state', 'roots/state']],
  ...['network', 'cell', 'database', 'storage', 'observability', 'ingress'].map((name) => [name, [`modules/${name}`]]),
  ['custody', ['modules/custody', 'modules/workload-permissions', 'modules/scope-permissions', 'fixtures/custody']],
  ['dns', ['modules/dns', 'roots/delegation']],
  ['integration', ['roots/global', 'roots/country']],
]);

export async function runSuite(name, { directory = fileURLToPath(new URL('.', import.meta.url)), execute = runProcess } = {}) {
  if (!suites.has(name)) throw new Error('Unknown infrastructure suite');
  const options = { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } };
  let image;
  try {
    const result = JSON.parse((await execute('docker', ['image', 'inspect', toolsImage], options)).stdout);
    if (result.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(result[0].Id)) throw new Error('Invalid local image identity');
    image = result[0].Id;
  } catch (error) {
    throw new Error('Local infrastructure tools unavailable; run node deploy/aws/check.mjs --prepare-tools', { cause: error });
  }
  const scratch = await mkdtemp(join(tmpdir(), 'cloud-aws-suite-'));
  try {
    await copyTrackedSources(directory, join(scratch, 'source'));
    const plan = suites.get(name).map((directory) => ({ directory, filter: `tests/${name}.tftest.hcl` }));
    if (name === 'integration') {
      plan.push(...['roots/global', 'roots/country'].map((directory) => ({ directory, filter: 'tests/composition.tftest.hcl' })));
      plan.push(...['roots/global', 'roots/country'].map((directory) => ({ directory, filter: 'tests/edge.tftest.hcl' })));
      plan.push(...['roots/global', 'roots/country'].map((directory) => ({ directory, filter: 'tests/evidence.tftest.hcl' })));
      plan.push(...['roots/global', 'roots/country'].map((directory) => ({ directory, filter: 'tests/handoff.tftest.hcl' })));
    }
    for (const entry of plan) {
      try {
        if (!(await lstat(join(scratch, 'source', entry.directory, entry.filter))).isFile()) throw new Error('Not a file');
      } catch {
        throw new Error(`Missing infrastructure suite source: ${entry.directory}/${entry.filter}`);
      }
    }
    await inspectSnapshot(scratch, execute, image);
    const driver = await readFile(new URL('./run.py', import.meta.url));
    const output = [];
    // Each independent root keeps the existing driver budget; all filters still run.
    for (const batch of name === 'integration' ? ['roots/global', 'roots/country'] : [null]) {
      const container = `cloud-aws-suite-${randomUUID()}`;
      await writeFile(join(scratch, 'suite.json'), JSON.stringify(plan), { mode: 0o644 });
      await writeFile(join(scratch, 'batch.json'), JSON.stringify(batch), { mode: 0o644 });
      await writeFile(join(scratch, 'run.py'), driver, { mode: 0o644 });
      try {
        const result = await execute('docker', [
          'run', '--rm', '--name', container, '--label', `io.waitron.aws-inspection=${container}`,
          '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL', '--user', '65532:65532',
          '--security-opt', 'no-new-privileges', '--read-only',
          '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m,mode=1777', '--pids-limit', '128', '--memory', '1g', '--cpus', '2',
          '--mount', `type=bind,source=${scratch},target=/candidate,readonly`,
          image, 'python', '-I', '/candidate/run.py',
        ], { ...options, timeout: 300_000 });
        output.push(result.stdout);
      } finally {
        await cleanupContainer(container, execute, options);
      }
    }
    return output.join('');
  } catch (error) {
    if (error.stderr?.trim()) throw new Error(error.stderr.trim());
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
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

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === '--prepare-tools') {
      await prepareTools();
      console.log(`Prepared software image ${toolsImage}`);
    } else if (args.length === 2 && args[0] === '--suite') {
      process.stdout.write(await runSuite(args[1]));
    } else if (args.length === 1 && args[0] === '--all') {
      for (const name of suites.keys()) process.stdout.write(await runSuite(name));
    } else {
      throw new Error('Usage: node deploy/aws/check.mjs --prepare-tools | --suite <name> | --all');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
