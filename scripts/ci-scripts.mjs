import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readInputInventory} from './ci-input-audit.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';
import {pathToFileURL} from 'node:url';

const families = [
  {targets: ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs']},
  {targets: ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'],
    callers: ['scripts/gateway-reconnection-receipt.mjs']},
];

function familyForPaths(paths) {
  assert.ok(Array.isArray(paths) && paths.length > 0 && new Set(paths).size === paths.length, 'Invalid script paths');
  const family = families.find(family => paths.every(path => family.targets.includes(path)));
  assert.ok(family, 'Invalid script paths');
  return family;
}

export function assertScriptWork(plan) {
  assert.ok(Array.isArray(plan.packages) && Array.isArray(plan.receipts), 'Missing script-only work');
  assert.equal(plan.packages.length + plan.receipts.length, 0, 'Script-only work cannot select suites');
  assert.equal(plan.typecheck, false, 'Script-only work cannot select types');
  assert.ok(!plan.reuse && !plan.documentation, 'Script-only work cannot mix work modes');
  const {base, head, paths} = plan.scripts ?? {};
  assert.ok([base, head].every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha)), 'Invalid script revisions');
  familyForPaths(paths);
}

export function scriptPlan(paths, base, head, git) {
  if (!paths.length || !families.some(family => paths.every(path => family.targets.includes(path)))) return null;
  const scripts = {base, head, paths};
  assertScriptWork({scripts, packages: [], receipts: [], typecheck: false});
  const family = familyForPaths(paths);
  for (const sha of [base, head]) {
    const entries = readInputInventory(sha, git);
    for (const path of [...family.targets, ...family.callers ?? []]) {
      const entry = entries.find(entry => entry.path === path);
      assert.ok(entry?.mode === '100644' && entry.type === 'blob', `Missing regular script target: ${path}`);
    }
  }
  return scripts;
}

export function checkScripts(plan, git, execute) {
  assertScriptWork(plan);
  const {base, head, paths} = plan.scripts;
  const actual = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
  assert.equal(actual.pop(), '', 'Incomplete script diff');
  assert.deepEqual([...paths].sort(), actual.sort(), 'Script plan omits changed inputs');
  scriptPlan(paths, base, head, git);
  assert.equal(git('rev-parse', 'HEAD').trim(), head, 'Root script job requires the exact head checkout');
  git('diff', '--exit-code', head, '--');
  const family = familyForPaths(paths);
  for (const target of [...family.targets, ...family.callers ?? []]) execute(['--check', target]);
  execute(['--test', family.targets[1]]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const git = (...args) => {
      const binary = typeof args.at(-1) === 'object' && args.pop().binary;
      return execFileSync('git', args, {encoding: binary ? undefined : 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024});
    };
    git.readBlobs = readGitBlobs;
    checkScripts(JSON.parse(process.env.CI_PLAN), git, args => execFileSync(process.execPath, args, {stdio: 'inherit', timeout: 60_000}));
    console.log('Passed root script checks: syntax and owning behavioral test');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
