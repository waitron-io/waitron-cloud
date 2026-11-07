import assert from 'node:assert/strict';
import {inertCIRecord} from './ci-input-audit.mjs';

const revision = /^[a-f0-9]{40}$/;
const backend = /^packages\/(account-http|backups|identity|operations|registration|remote-access|translation)\//;
// These named proof cases do not carry the venue-service filename prefix.
const packageProofCases = new Set([
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
  // Every workspace manifest can change installation or execution.
  if (/^(apps|packages)\/[^/]+\/package\.json$/.test(path)) return true;
  if (path === `.github/workflows/${kind === 'cost' ? 'cloud-cost' : 'venue-services-proof'}.yml`) return true;
  // Both matrices import backend test helpers and generated-data fixture builders.
  if (backend.test(path) && /\/test\//.test(path) && !/\.test\.[cm]?[jt]sx?$/.test(path)) return true;
  if (kind === 'cost') {
    if (path.startsWith('scripts/cloud-cost/') || path.startsWith('deploy/local-remote/') ||
      path.startsWith('docs/cost-model/') || ['docs/cloud-cost-model.md', 'docs/cloud-cost-calculator.html'].includes(path)) return true;
    // Account-server imports cross backend boundaries. Preparation also reads migrations,
    // the account database fixture, and SDK/esbuild dependencies through manifests.
    if (backend.test(path) && /\/(src|migrations)\//.test(path)) return true;
  } else {
    // Product source is already exercised by package CI. This matrix is selected by
    // edits to its proof programs and their test cases, rather than every product edit.
    if (['deploy/local-stack/runtime.mjs', 'deploy/local-stack/lease.mjs',
      'deploy/local-stack/bootstrap.mjs', 'deploy/backup-verifier/target.json'].includes(path)) return true;
    if (path.startsWith('deploy/test-cloud/') || packageProofCases.has(path) ||
      /^packages\/[^/]+\/test\/venue-service-/.test(path)) return true;
  }
  if (path.startsWith('packages/') && !backend.test(path) && !path.startsWith('packages/ui-smoke/')) return true;
  if (path.startsWith('apps/') && !path.startsWith('apps/portal/')) return true;
  if (/^(apps|packages|docs|deploy)\//.test(path) || path.startsWith('.github/workflows/')) return false;
  // Root configuration, script changes and new top-level areas retain proof work until reviewed.
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
    return proofInputPlanRange(kind, {base, head: pr.head.sha}, git);
  } catch (error) {
    return {required: true, reason: `Kept full ${kind} proof work: ${error.message}`};
  }
}

export function proofInputPlanRange(kind, {base, head}, git) {
  try {
    assert.ok(['cost', 'venue'].includes(kind), 'Unknown proof kind');
    assert.ok([base, head].every(value => revision.test(value)), 'Invalid proof revisions');
    assert.notEqual(base, head, 'Empty proof range');
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0');
    assert.equal(paths.pop(), '', 'Incomplete proof diff');
    assert.ok(paths.length > 0, 'Empty proof diff');
    assert.ok(paths.every(path => path && !/[\\\n\r]/.test(path) &&
      !path.split('/').some(part => ['', '.', '..'].includes(part))), 'Unclassified proof path');
    const inputs = paths.filter(path => !inertCIRecord(path) && consumes(kind, path));
    return {required: inputs.length > 0, reason: inputs.length
      ? `Selected ${kind} proof inputs: ${inputs.join(', ')}`
      : `No ${kind} proof inputs changed across ${paths.length} paths`};
  } catch (error) {
    return {required: true, reason: `Kept full ${kind} proof work: ${error.message}`};
  }
}
