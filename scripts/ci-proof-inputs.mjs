import assert from 'node:assert/strict';
import {auditInputMode, readInputAudit} from './ci-input-audit.mjs';

const revision = /^[a-f0-9]{40}$/;
const backend = /^packages\/(account-http|backups|identity|operations|registration|remote-access|translation)\//;
const shared = new Set([
  'scripts/ci-docs.mjs', 'scripts/ci-proof-inputs.mjs', 'scripts/test-postgres.mjs',
  'scripts/ci-setup-pnpm.mjs', 'scripts/ci-pnpm-diagnostics.cjs',
]);
// These named proof cases do not carry the venue-service filename prefix.
const legacyTests = new Set([
  'packages/translation/test/free-service-plans.test.ts',
  ...['relay-grants', 'relay-worker', 'relay-control', 'relay-operator-stop', 'content-translation-service']
    .map(name => `packages/registration/test/${name}.test.ts`),
  ...['machine', 'worker', 'collect-page', 'consent', 'worker-cli']
    .map(name => `packages/translation/test/${name}.test.ts`),
  ...['relay-disabled', 'translation', 'translation-collect-pages', 'content-translation-readers']
    .map(name => `packages/account-http/test/${name}.test.ts`),
]);

function consumes(kind, path) {
  if (/^[^/]+\.md$/.test(path)) return false;
  // Root configuration and every workspace manifest can change installation or execution.
  if (!path.includes('/') || /^(apps|packages)\/[^/]+\/package\.json$/.test(path) || shared.has(path)) return true;
  if (path === `.github/workflows/${kind === 'cost' ? 'cloud-cost' : 'venue-services-proof'}.yml`) return true;
  if (kind === 'cost') {
    if (path.startsWith('scripts/cloud-cost/') || path.startsWith('deploy/local-remote/') ||
      path.startsWith('docs/cost-model/') || ['docs/cloud-cost-model.md', 'docs/cloud-cost-calculator.html'].includes(path)) return true;
    // Account-server imports cross backend boundaries. Preparation also reads migrations,
    // the account database fixture, and SDK/esbuild dependencies through manifests.
    if (backend.test(path) && /\/(src|migrations)\//.test(path)) return true;
    if (backend.test(path) && /\/test\//.test(path) && !/\.test\.[cm]?[jt]sx?$/.test(path)) return true;
  } else {
    // Product source is already exercised by package CI. This matrix is selected by
    // edits to its proof programs and their test cases, rather than every product edit.
    if (path.startsWith('deploy/test-cloud/') || path.startsWith('scripts/test-cloud-') ||
      path.startsWith('scripts/venue-service-') || path === 'scripts/legacy-service-proof.test.ts' ||
      path === 'scripts/fixtures/service-proof.ts' || legacyTests.has(path) ||
      /^packages\/[^/]+\/test\/venue-service-/.test(path)) return true;
    if (path === 'packages/account-http/test/fixtures.ts') return true;
  }
  if (path.startsWith('packages/') && !backend.test(path) && !path.startsWith('packages/ui-smoke/')) return true;
  if (path.startsWith('apps/') && !path.startsWith('apps/portal/')) return true;
  if (/^(apps|packages|docs|deploy)\//.test(path) || path.startsWith('.github/workflows/')) return false;
  // Unclassified scripts and new top-level areas retain proof work until reviewed.
  return true;
}

export function proofInputPlan(kind, event, git) {
  try {
    assert.ok(['cost', 'venue'].includes(kind), 'Unknown proof kind');
    const pr = event.pull_request;
    if (!pr) return {required: true, reason: 'Full proof run outside a pull request'};
    assert.ok([pr.base.sha, pr.head.sha].every(value => revision.test(value)), 'Invalid proof revisions');
    assert.equal(git('rev-parse', 'HEAD').trim(), pr.head.sha, 'Proof checkout differs from the event head');
    const base = git('merge-base', pr.base.sha, pr.head.sha).trim();
    assert.match(base, revision, 'Missing proof merge base');
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, pr.head.sha).split('\0');
    assert.equal(paths.pop(), '', 'Incomplete proof diff');
    assert.ok(paths.length > 0, 'Empty proof diff');
    assert.ok(paths.every(path => path && !/[\\\n\r]/.test(path) &&
      !path.split('/').some(part => ['', '.', '..'].includes(part))), 'Unclassified proof path');
    const policyPath = 'scripts/ci-input-audit.json';
    if (paths.includes(policyPath)) {
      const {policy} = readInputAudit(pr.head.sha, git);
      for (const mode of ['docs', 'identity', 'gateway', 'lock']) {
        auditInputMode(mode, pr.head.sha, git, Object.keys(policy.manifests));
      }
    }
    const inputs = paths.filter(path => path !== policyPath && consumes(kind, path));
    return {required: inputs.length > 0, reason: inputs.length
      ? `Selected ${kind} proof inputs: ${inputs.join(', ')}`
      : `No ${kind} proof inputs changed across ${paths.length} paths`};
  } catch (error) {
    return {required: true, reason: `Kept full ${kind} proof work: ${error.message}`};
  }
}
