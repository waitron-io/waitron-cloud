import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const runner = new URL('./test-cloud-integration.mjs', import.meta.url).href;
const protectedId = 'a'.repeat(64);

// Allocating host scratch before the initial inventory leaves it outside owned cleanup.
for (const [scenario, error] of [
  ['inventory-command', {message: 'integration.command_failed:ps'}],
  ['protected-missing', {code: 'ERR_ASSERTION'}],
  ['protected-malformed', {code: 'ERR_ASSERTION'}],
  ['image-command', {message: 'integration.command_failed:image'}],
]) test('client proof leaves no host scratch after ' + scenario + ' refusal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-inventory-cleanup-'));
  try {
    const scratch = join(root, 'temporary'), bin = join(root, 'bin');
    await mkdir(scratch); await mkdir(bin); await mkdir(join(scratch, 'foreign'));
    await writeFile(join(scratch, 'foreign', 'keep'), 'another session owns this');
    // Stub only the external command; allocation, subprocesses and cleanup stay real.
    await writeFile(join(bin, 'docker'), `#!${process.execPath}
const args = process.argv.slice(2), scenario = process.env.INVENTORY_CLEANUP_SCENARIO;
if (JSON.stringify(args) === JSON.stringify(['ps', '-aq', '--no-trunc'])) {
  if (scenario === 'inventory-command') process.exit(29);
  process.stdout.write(scenario === 'protected-malformed' ? '${protectedId}\\n' : '');
} else if (scenario === 'protected-malformed' && args[0] === 'inspect' && args[1] === '--format' && args.at(-1) === '${protectedId}') {
  process.stdout.write('${protectedId} true\\n');
} else if (scenario === 'image-command' && JSON.stringify(args) === JSON.stringify(['image', 'inspect', 'sha256:' + 'c'.repeat(64)])) {
  process.exit(29);
} else {process.stderr.write('Unexpected Docker boundary'); process.exit(30);}
`, {mode: 0o700});
    const options = {image: 'sha256:' + 'b'.repeat(64), waitronImage: 'sha256:' + 'c'.repeat(64),
      protectedContainerIds: scenario.startsWith('protected-') ? [protectedId] : []};
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {runTestCloudClients} from ${JSON.stringify(runner)};
await assert.rejects(runTestCloudClients(${JSON.stringify(options)}), ${JSON.stringify(error)});
`], {encoding: 'utf8', timeout: 15000, env: {...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      PATH: bin + ':' + process.env.PATH, INVENTORY_CLEANUP_SCENARIO: scenario}});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.deepEqual(await readdir(scratch), ['foreign'], 'Refused runs must remove all host scratch they created');
    assert.equal(await readFile(join(scratch, 'foreign', 'keep'), 'utf8'), 'another session owns this');
  } finally {await rm(root, {recursive: true, force: true});}
});
