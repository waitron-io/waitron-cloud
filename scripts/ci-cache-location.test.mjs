import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const consumers = [
  ['ci.yml', 'root'], ['ci.yml', 'typecheck'], ['ci.yml', 'receipts'], ['ci.yml', 'packages'],
  ['relay-counter-diagnostic.yml', 'linux-counter-rollover'], ['venue-services-proof.yml', 'service-receipts'],
  ['cloud-cost.yml', 'conformance'], ['password-derivation-diagnostic.yml', 'linux-observation'],
  ['ui-release.yml', 'build'], ['browser-reconnect-diagnostic.yml', 'socket-observation'],
];

function locateScript(file, name) {
  const source = readFileSync(new URL('../.github/workflows/' + file, import.meta.url), 'utf8');
  const job = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1];
  const step = job?.split('      - name: Locate pnpm dependency store\n')[1]?.split('      - ')[0];
  const run = step?.match(/        run: \|\n((?:          .*\n)+)/)?.[1];
  assert.ok(run, `${file}/${name} must locate its dependency store before publishing cache inputs`);
  return run.replace(/^          /gm, '');
}

function locate(t, file, name, exit, path) {
  const root = mkdtempSync(join(tmpdir(), 'ci-cache-location-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'pnpm'), '#!/bin/sh\n[ "$#" = 3 ] && [ "$1" = store ] && [ "$2" = path ] && [ "$3" = --silent ] || exit 91\nprintf "%s\\n" "$CACHE_LOCATION_PATH"\nexit "$CACHE_LOCATION_EXIT"\n', {mode: 0o700});
  const output = join(root, 'output'), environment = join(root, 'environment');
  writeFileSync(output, ''); writeFileSync(environment, '');
  const child = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', locateScript(file, name)], {
    encoding: 'utf8', timeout: 5000,
    env: {...process.env, PATH: root + ':' + process.env.PATH, RUNNER_TEMP: join(root, 'runner temp'),
      GITHUB_ENV: environment, GITHUB_OUTPUT: output, CACHE_LOCATION_EXIT: String(exit), CACHE_LOCATION_PATH: path},
  });
  assert.equal(child.signal, null, child.stderr);
  return {code: child.status, output: readFileSync(output, 'utf8'), environment: readFileSync(environment, 'utf8'), root};
}

// An echo around command substitution must not turn a failed or empty lookup into a usable cache path.
for (const [file, name] of consumers) {
  test(`${file}/${name} refuses a failed store lookup before publishing a cache path`, t => {
    const result = locate(t, file, name, 7, 'PRIVATE_FAILED_LOOKUP');
    assert.equal(result.code, 7, 'preserve the pnpm failure instead of succeeding through echo');
    assert.equal(result.output, '', 'a failed lookup cannot publish cache inputs');
  });
  test(`${file}/${name} refuses a successful lookup with no store path`, t => {
    const result = locate(t, file, name, 0, '');
    assert.equal(result.code, 1);
    assert.equal(result.output, '', 'an empty path cannot reach cache restoration');
  });
  test(`${file}/${name} publishes the successful store path and installation setting`, t => {
    const result = locate(t, file, name, 0, '/generated store/v3');
    assert.equal(result.code, 0);
    assert.equal(result.output, 'path=/generated store/v3\n');
    assert.equal(result.environment, `npm_config_store_dir=${result.root}/runner temp/cloud-pnpm-store\n`);
  });
}
