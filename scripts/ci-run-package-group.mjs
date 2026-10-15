import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {packageMembers} from './ci-package-groups.mjs';

try {
  const row = JSON.parse(process.env.CI_PACKAGE_GROUP);
  const members = packageMembers(row);
  assert.ok(Object.hasOwn(row, 'members'), 'Missing package group members');
  let failed = false;
  // A failed package must remain visible without hiding later selected results.
  for (const name of members) {
    console.log(`::group::${name}`);
    const started = performance.now();
    const result = spawnSync('pnpm', ['--filter', name, 'test'], {stdio: 'inherit'});
    const passed = !result.error && result.status === 0;
    console.log(`Package ${name}: ${passed ? 'PASS' : 'FAIL'} (${Math.round(performance.now() - started)} ms)`);
    console.log('::endgroup::');
    if (!passed) {
      failed = true;
      console.error(`Package ${name} failed: ${result.error?.message ?? result.signal ?? result.status}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
