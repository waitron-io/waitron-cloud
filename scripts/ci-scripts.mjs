import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readInputInventory, unreadMarkdown} from './ci-input-audit.mjs';
import {documentationPlan} from './ci-docs.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';
import {pathToFileURL} from 'node:url';

const families = [
  {targets: ['scripts/identity-upstream.mjs', 'scripts/identity-upstream.test.mjs']},
  {targets: ['scripts/verify-gateway-reconnection-receipt.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'],
    callers: ['scripts/gateway-reconnection-receipt.mjs']},
];
const proofFamily = {targets: ['deploy/kubernetes/proof/workflow.test.mjs'], callers: ['.github/workflows/kubernetes-proof.yml']};

export function isKubernetesProofPath(path) {
  return typeof path === 'string' && !/[\\\0\r\n]/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..' || part === '.gitattributes') &&
    (path.startsWith('deploy/kubernetes/proof/') || /^scripts\/kubernetes-proof-[^/]+$/.test(path) || path === proofFamily.callers[0]);
}

function familyForPaths(paths) {
  assert.ok(Array.isArray(paths) && paths.length > 0 && new Set(paths).size === paths.length, 'Invalid script paths');
  const family = families.find(family => paths.every(path => family.targets.includes(path))) ??
    (paths.some(isKubernetesProofPath) && paths.every(path => isKubernetesProofPath(path) || unreadMarkdown(path)) ? proofFamily : null);
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
  let family;
  try {family = familyForPaths(paths);} catch {return null;}
  const scripts = {base, head, paths};
  assertScriptWork({scripts, packages: [], receipts: [], typecheck: false});
  const trees = [];
  for (const sha of [base, head]) {
    const entries = readInputInventory(sha, git);
    trees.push(entries);
    for (const path of [...family.targets, ...family.callers ?? []]) {
      const entry = entries.find(entry => entry.path === path);
      assert.ok(entry?.mode === '100644' && entry.type === 'blob', `Missing regular script target: ${path}`);
    }

  }
  if (family === proofFamily) {
    for (const path of paths) assert.ok(trees.some(entries => entries.some(entry => entry.path === path)) && trees.every(entries => {
      const entry = entries.find(entry => entry.path === path);
      return !entry || entry.mode === '100644' && entry.type === 'blob';
    }), 'Proof input must be regular wherever it exists');
    const prose = paths.filter(unreadMarkdown);
    if (prose.length) documentationPlan(prose, base, head, git);
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
  const current = family === proofFamily ? readInputInventory(head, git) : [];
  const targets = family === proofFamily ? paths.filter(path => path.endsWith('.mjs') && current.some(entry => entry.path === path))
    : [...family.targets, ...family.callers ?? []];
  for (const target of targets) execute(['--check', target]);
  execute(['--test', family === proofFamily ? proofFamily.targets[0] : family.targets[1]]);
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
