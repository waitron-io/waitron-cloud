import {assertReuseProof} from './ci-reuse-proof.mjs';
import {resolveRange} from './ci-range.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, lstatSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {readInputInventory, unreadMarkdown} from './ci-input-audit.mjs';
import {receiptSuites} from './ci-scope.mjs';
import {packageMembers} from './ci-package-groups.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

const owners = [
  {id: 'root-partition-contract', paths: ['scripts/ci-root-shards.test.mjs'], owners: {rootTests: true, receipts: []}},
  {id: 'local-health-test', paths: ['deploy/local-stack/operations-health.test.mjs'], owners: {rootTests: false, receipts: ['test:local-stack']}},
];
const candidates = new Set(owners.flatMap(entry => entry.paths));
const sha = /^[a-f0-9]{40}$/;
const manifestPattern = /^(?:apps|packages)\/[^/\\]+\/package\.json$/;

function packageManifests(revision, entries, git) {
  const manifests = entries.filter(e => manifestPattern.test(e.path));
  const packages = new Map(), names = new Set();
  for (const entry of manifests) {
    assert.ok(entry.mode === '100644' && entry.type === 'blob', `Nonregular root workspace manifest: ${entry.path}`);
    const manifest = JSON.parse(git('show', `${revision}:${entry.path}`));
    assert.ok(typeof manifest.name === 'string' && manifest.name.trim() && !names.has(manifest.name), 'Invalid root workspace identity');
    assert.ok(typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim(), 'Missing root workspace test command');
    names.add(manifest.name); packages.set(entry.path.slice(0, -'/package.json'.length), {name: manifest.name, test: manifest.scripts.test});
  }
  return packages;
}

function packageInventory(revision, entries, git) {
  const policy = entries.find(e => e.path === 'pnpm-workspace.yaml');
  assert.ok(policy?.mode === '100644' && policy.type === 'blob', 'Missing regular root workspace policy');
  assert.match(git('show', `${revision}:pnpm-workspace.yaml`), /^packages:\s*\n  - 'packages\/\*'\s*\n  - 'apps\/\*'\s*$/, 'Unsupported root workspace policy');
  const packages = packageManifests(revision, entries, git);
  const directories = new Set(entries.filter(e => /^(?:apps|packages)\//.test(e.path)).map(e => e.path.split('/').slice(0, 2).join('/')));
  assert.deepEqual([...packages.keys()].sort(), [...directories].sort(),
    'Shared or unknown root input: incomplete root workspace membership');
  return packages;
}

export function rootInputPlan(paths, base, head, git) {
  if (!paths.some(path => candidates.has(path) || /(?:^|\/)\.gitattributes$/.test(path))) return null;
  try {
    assert.ok(paths.length > 0 && new Set(paths).size === paths.length && paths.every(path => typeof path === 'string' && !path.includes('\0')), 'Invalid root changed paths');
    assert.ok(sha.test(base) && sha.test(head), 'Invalid root revisions');
    const trees = [base, head].map((revision, index) => {
      try {
        const entries = readInputInventory(revision, git);
        for (const path of candidates) {
          const entry = entries.find(entry => entry.path === path);
          assert.ok(entry?.mode === '100644' && entry.type === 'blob', `Missing regular root owner target: ${path}`);
        }
        return {entries};
      } catch (error) {return {error: `${index ? 'head' : 'base'}: ${error.message}`};}
    });
    const errors = trees.filter(tree => tree.error).map(tree => tree.error);
    assert.equal(errors.length, 0, errors.join('; '));
    git('merge-base', '--is-ancestor', base, head);
    const actual = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
    assert.equal(actual.pop(), '', 'Incomplete root changed paths');
    assert.deepEqual([...paths].sort(), actual.sort(), 'Root paths differ from immutable revisions');
    assert.equal(trees[0].entries.find(entry => entry.path === 'scripts/ci-root-inputs.mjs')?.objectId,
      trees[1].entries.find(entry => entry.path === 'scripts/ci-root-inputs.mjs')?.objectId, 'Root ownership policy changed; full work required');
    // Checkout filters affect the bytes that jobs receive, including inside a
    // package. Ownership cannot make that installation boundary local.
    assert.ok(!paths.some(path => /(?:^|\/)\.gitattributes$/.test(path)), 'Checkout attributes require full root work');
    const inventories = [base, head].map((revision, i) => packageInventory(revision, trees[i].entries, git));
    assert.deepEqual([...inventories[0]], [...inventories[1]], 'Root workspace identity or test commands changed');
    const inputs = new Map();
    for (const entry of owners) {
      for (const path of entry.paths) inputs.set(path, entry);
    }
    const selected = new Map(), packagePaths = [];
    for (const path of paths) {
      const entry = inputs.get(path);
      if (entry) {selected.set(entry.id, entry); continue;}
      if (unreadMarkdown(path) && trees.every(tree => {
        const row = tree.entries.find(e => e.path === path);
        return !row || row.mode === '100644' && row.type === 'blob';
      })) continue;
      if (inventories.every(packages => [...packages.keys()].some(directory => path.startsWith(directory + '/')))) packagePaths.push(path);
      else assert.fail(`Shared or unknown root input: ${path}`);
    }
    assert.ok(selected.size > 0 || packagePaths.length > 0, 'Evidence or prose alone cannot create root work');
    const entries = [...selected.values()];
    const rootInputs = {version: 1, base, head, paths, entryIds: [...selected.keys()].sort()};
    // Leave room for package rows and diagnostics below Linux's per-value
    // environment limit; full work needs no changed-path ownership marker.
    assert.ok(Buffer.byteLength(JSON.stringify(rootInputs), 'utf8') <= 64 * 1024, 'Root ownership size exceeds the step environment budget');
    return {rootInputs,
      rootTests: entries.some(entry => entry.owners.rootTests),
      receipts: [...new Set(entries.flatMap(entry => entry.owners.receipts))].sort(), packagePaths};
  } catch (error) {
    return {full: true, reason: `Root ownership refused: ${error.message.split('\n')[0]}`.slice(0, 512)};
  }
}

export function assertRootInputWork(plan, {base, head, git}) {
  assert.ok(sha.test(head) && typeof git === 'function', 'Missing trusted root verification context');
  if (plan.reuse) {
    assertReuseProof(plan.reuse, '.github/workflows/ci.yml');
    assert.ok(!Object.hasOwn(plan, 'rootInputs') && !Object.hasOwn(plan, 'rootTests'), 'Reuse cannot declare root work');
    return;
  }
  if (!base) {
    assert.ok(!Object.hasOwn(plan, 'rootInputs') && !Object.hasOwn(plan, 'rootTests'), 'Root work requires a trusted event range');
    return;
  }
  assert.ok(sha.test(base), 'Invalid trusted root base');
  const paths = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
  assert.equal(paths.pop(), '', 'Incomplete trusted root paths');
  const expected = rootInputPlan(paths, base, head, git);
  const marked = Object.hasOwn(plan, 'rootInputs') || Object.hasOwn(plan, 'rootTests');
  if (!expected && !marked) return;
  const full = () => {
    assert.ok(!marked && plan.typecheck === true && !plan.scripts && !plan.documentation && !plan.reuse, 'Root refusal requires full work');
    // Unknown policy or directory membership refuses narrowing, not full work.
    // Full work still requires every saved package manifest and receipt owner.
    const entries = readInputInventory(head, git), inventory = packageManifests(head, entries, git);
    const selected = new Set(plan.packages.flatMap(packageMembers));
    assert.deepEqual([...selected].sort(), [...inventory.values()].map(row => row.name).sort(), 'Root fallback requires every package owner');
    assert.deepEqual([...plan.receipts].sort(), [...receiptSuites].sort(), 'Root fallback requires every receipt owner');
  };
  if (!expected || expected.full || !marked) {full(); return;}
  assert.ok(!plan.scripts && !plan.documentation && !plan.reuse, 'Root work cannot mix legacy modes');
  assert.deepEqual(plan.rootInputs, expected.rootInputs, 'Root marker differs from trusted event ownership');
  assert.equal(plan.typecheck, plan.packages.length > 0, 'Root compiler work differs from package work');
  assert.equal(plan.rootTests, expected.rootTests || plan.typecheck, 'Root execution gate differs from required owners');
  if (expected.packagePaths.length) assert.ok(plan.packages.length > 0, 'Missing root-associated package work');
  else assert.equal(plan.packages.length, 0, 'Unexpected root-associated package work');
  for (const suite of expected.receipts) assert.ok(plan.receipts.includes(suite), `Missing root receipt owner: ${suite}`);
  assert.equal(new Set(plan.receipts).size, plan.receipts.length, 'Duplicate root receipt owner');
  assert.ok(plan.receipts.every(suite => receiptSuites.includes(suite)), 'Unknown root receipt owner');
  assert.ok(plan.rootTests || plan.packages.length || plan.receipts.length, 'Empty root work cannot pass');
}

export function rootVerificationContext(plan, env = process.env) {
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return execFileSync('git', args, {encoding: binary ? undefined : 'utf8', timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  };
  git.readBlobs = readGitBlobs;
  const checkout = git('rev-parse', 'HEAD').trim();
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const head = event.pull_request?.head.sha ?? env.CI_HEAD_SHA ?? env.GITHUB_SHA ?? checkout;
  assert.match(head, sha, 'Invalid trusted root event head');
  assert.equal(checkout, head, 'Root work requires the exact head checkout');
  if (env.CI_HEAD_SHA) assert.equal(head, env.CI_HEAD_SHA, 'Root event differs from the expected head');
  assert.equal(git('diff', '--name-only', head, '--'), '', 'Root work requires a clean tracked checkout; dirty bytes refuse execution');
  if (env.GITHUB_ACTIONS === 'true') assert.ok(env.GITHUB_EVENT_PATH, 'Root verification requires the original event');
  let base;
  if (event.pull_request) {
    assert.match(event.pull_request.base.sha, sha, 'Invalid trusted root event base');
    base = git('merge-base', event.pull_request.base.sha, head).trim();
    assert.match(base, sha, 'Missing trusted root merge base');
  }
  if (!base && env.GITHUB_EVENT_NAME === 'push') {
    const inputs = JSON.parse(env.CI_WORKFLOW_INPUTS || '{}') ?? {};
    const range = resolveRange(event, {sha: head, eventName: 'push', ref: env.GITHUB_REF,
      full: env.CI_FULL === 'true' || env.CI_FORCE_FULL === 'true',
      called: env.CI_CALLED === 'true' || Object.hasOwn(inputs, 'full')}, git);
    if (range.kind === 'push') base = range.base;
  }
  return {base, head, git};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.deepEqual(process.argv.slice(2), ['--check'], 'Usage: ci-root-inputs.mjs --check');
    const plan = JSON.parse(process.env.CI_PLAN);
    const context = rootVerificationContext(plan);
    assertRootInputWork(plan, context);
    if (plan.rootInputs ? plan.rootTests : plan.typecheck) {
      const selected = path => /^scripts\/ci-[^/]+\.test\.mjs$/.test(path) ||
        ['scripts/identity-upstream.test.mjs', 'scripts/verify-gateway-reconnection-receipt.test.mjs'].includes(path);
      const entries = readInputInventory(context.head, context.git), files = entries.filter(row => selected(row.path));
      assert.ok(files.length >= 4 && files.some(row => row.path === 'scripts/identity-upstream.test.mjs') &&
        files.some(row => row.path === 'scripts/verify-gateway-reconnection-receipt.test.mjs'), 'Missing complete nonempty root test inventory');
      assert.ok(files.every(row => row.mode === '100644' && row.type === 'blob'), 'Nonregular root test inventory');
      const actual = readdirSync('scripts').map(name => `scripts/${name}`).filter(selected);
      assert.deepEqual(actual.sort(), files.map(row => row.path).sort(), 'Root filesystem inventory differs from the exact head');
      assert.ok(actual.every(path => lstatSync(path).isFile()), 'Nonregular root filesystem inventory');
    }
    if (plan.receipts?.length) {
      assert.ok(new Set(plan.receipts).size === plan.receipts.length && plan.receipts.every(suite => receiptSuites.includes(suite)), 'Invalid root receipt commands');
      const manifest = JSON.parse(context.git('show', `${context.head}:package.json`));
      for (const suite of plan.receipts) assert.ok(typeof manifest.scripts?.[suite] === 'string' && manifest.scripts[suite].trim(), `Missing root receipt command: ${suite}`);
    }
    console.log('Root input work verified');
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
