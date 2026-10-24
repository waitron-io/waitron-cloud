import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const memberDirectories = ['packages/account-http', 'packages/backups', 'packages/fiscal-allocation',
  'packages/identity', 'packages/operations', 'packages/registration', 'packages/remote-access',
  'packages/translation', 'packages/ui-smoke', 'apps/portal'];

function fixture(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-typecheck-')));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), text);
  };
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  const command = manifest.scripts.typecheck;
  try {
    // Isolate source errors while retaining the real commands, configurations and compiler.
    write('package.json', JSON.stringify({private: true, type: 'module', packageManager: manifest.packageManager,
      scripts: {typecheck: command}}));
    cpSync(join(repository, 'pnpm-workspace.yaml'), join(root, 'pnpm-workspace.yaml'));
    cpSync(join(repository, 'tsconfig.json'), join(root, 'tsconfig.json'));
    symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    for (const directory of memberDirectories) {
      const member = JSON.parse(readFileSync(join(repository, directory, 'package.json'), 'utf8'));
      write(`${directory}/package.json`, JSON.stringify({name: member.name, type: 'module',
        scripts: {typecheck: member.scripts.typecheck}}));
      write(`${directory}/src/typecheck-probe.ts`, 'export const venueCount: number = 1;\n');
      if (directory === 'apps/portal' || directory === 'packages/ui-smoke') {
        cpSync(join(repository, directory, 'tsconfig.json'), join(root, directory, 'tsconfig.json'));
      }
    }
    write('trace.mjs', `import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
if (process.argv[1]?.endsWith('/typescript/bin/tsc')) {
  const at = process.argv.indexOf('-p');
  appendFileSync(process.env.TYPECHECK_TRACE, resolve(process.cwd(), process.argv[at + 1]) + '\\n');
}\n`);
    const check = () => {
      write('compiler-trace.txt', '');
      const result = spawnSync('pnpm', ['typecheck'], {cwd: root, encoding: 'utf8', timeout: 60_000,
        env: {...process.env, NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'trace.mjs')).href}`,
          npm_config_workspace_concurrency: '1', TYPECHECK_TRACE: join(root, 'compiler-trace.txt')}});
      assert.ifError(result.error);
      const configs = readFileSync(join(root, 'compiler-trace.txt'), 'utf8').trim().split('\n')
        .filter(Boolean).map(path => relative(root, path));
      return {...result, configs, output: result.stdout + result.stderr};
    };
    run({root, write, check});
  } finally {rmSync(root, {recursive: true, force: true});}
}

test('root typecheck compiles each distinct workspace configuration once with the real compiler', () => fixture(({check}) => {
  const result = check();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.configs.sort(), ['apps/portal/tsconfig.json', 'packages/ui-smoke/tsconfig.json', 'tsconfig.json']);
}));

test('root typecheck rejects real source errors in every backend package, including a newly added package', () => fixture(({write, check}) => {
  const directories = [...memberDirectories.filter(directory => directory.startsWith('packages/')), 'packages/new-venue-service'];
  for (const directory of directories) {
    const source = `${directory}/src/probe-${directory.split('/').at(-1)}.ts`;
    write(source, 'export const venueCount: number = "invalid";\n');
    const result = check();
    assert.notEqual(result.status, 0, `${source}: ${result.output}`);
    assert.match(result.output, /error TS2322/);
    assert.ok(result.output.includes(source.split('/').at(-1)), result.output);
    write(source, 'export const venueCount: number = 1;\n');
  }
}));

test('root typecheck rejects real test errors in every backend package, including a newly added package', () => fixture(({write, check}) => {
  const directories = [...memberDirectories.filter(directory => directory.startsWith('packages/') && directory !== 'packages/ui-smoke'),
    'packages/new-venue-service'];
  const sources = directories.map(directory => `${directory}/test/probe-${directory.split('/').at(-1)}.ts`);
  for (const source of sources) write(source, 'export const venueCount: number = "invalid";\n');
  const rejected = check();
  assert.notEqual(rejected.status, 0, rejected.output);
  for (const source of sources) {
    assert.ok(rejected.output.split('\n').some(line => line.startsWith(`${source}(`) && line.includes('error TS2322')),
      `${source}: ${rejected.output}`);
    write(source, 'export const venueCount: number = 1;\n');
  }
  const accepted = check();
  assert.equal(accepted.status, 0, accepted.output);
}));

test('root typecheck retains portal source and test checking and the UI declaration check', () => fixture(({write, check}) => {
  for (const source of ['apps/portal/src/typecheck-probe.ts', 'apps/portal/test/typecheck-probe.ts']) {
    write(source, 'export const venueCount: number = "invalid";\n');
    const result = check();
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /error TS2322/);
    // The package compiler prints paths relative to its own working directory.
    assert.ok(result.output.includes(source.replace('apps/portal/', '')), result.output);
    write(source, 'export const venueCount: number = 1;\n');
  }
  write('packages/ui-smoke/src/invalid-declaration.d.ts', 'export type Venue = MissingVenue;\n');
  const result = check();
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /error TS2304/);
  assert.ok(result.output.includes('src/invalid-declaration.d.ts'), result.output);
}));

test('all declared package compiler configurations are included in the consolidated check', () => {
  const discovery = spawnSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], {cwd: repository, encoding: 'utf8'});
  assert.equal(discovery.status, 0, discovery.stderr);
  const members = JSON.parse(discovery.stdout).filter(member => resolve(member.path) !== resolve(repository));
  assert.deepEqual(members.map(member => relative(repository, member.path)).sort(), [...memberDirectories].sort());
  const configurations = new Set();
  for (const member of members) {
    const manifest = JSON.parse(readFileSync(join(member.path, 'package.json'), 'utf8'));
    const command = manifest.scripts.typecheck.match(/^tsc -p (\S+)$/);
    assert.ok(command, `Unmapped typecheck command in ${manifest.name}`);
    configurations.add(relative(repository, resolve(member.path, command[1])));
  }
  assert.deepEqual([...configurations].sort(), ['apps/portal/tsconfig.json', 'packages/ui-smoke/tsconfig.json', 'tsconfig.json']);
});
