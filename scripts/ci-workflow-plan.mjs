import assert from 'node:assert/strict';
import {workflowPaths} from './ci-reuse-proof.mjs';
import {loadWorkspaceAtRevision} from './ci-workspace-snapshot.mjs';
import {selectPlan} from './ci-plan.mjs';
import {documentationPlan} from './ci-docs.mjs';
import {conformanceMatrix} from './cloud-cost/conformance.mjs';

export function fullWorkflowPlan(workflowPath, head) {
  assert.ok(workflowPaths.includes(workflowPath) && workflowPath !== workflowPaths[0], 'Unknown native workflow');
  assert.match(head, /^(?!0{40}$)[a-f0-9]{40}$/, 'Invalid full workflow head');
  return {full: true, head, required: true,
    ...(workflowPath.endsWith('/cloud-cost.yml') ? {matrix: conformanceMatrix()} : {})};
}

export function selectWorkflowPlan(workflowPath, range, git) {
  assert.ok(workflowPaths.includes(workflowPath), 'Unknown workflow selector');
  if (workflowPath === workflowPaths[0]) {
    return selectPlan(range, loadWorkspaceAtRevision(range.head, git), git);
  }
  for (const revision of [range.base, range.head]) assert.match(revision, /^(?!0{40}$)[a-f0-9]{40}$/, 'Invalid workflow range');
  assert.notEqual(range.base, range.head, 'Empty workflow range');
  const paths = git('diff', '--name-only', '--no-renames', '-z', range.base, range.head).split('\0');
  assert.equal(paths.pop(), '', 'Incomplete workflow path inventory');
  assert.ok(paths.length > 0, 'Empty workflow path inventory');
  let required = true;
  if (['cloud-cost.yml', 'venue-services-proof.yml'].some(name => workflowPath.endsWith('/' + name))) {
    try {required = !documentationPlan(paths, range.base, range.head, git);}
    catch { /* Missing or stale documentation evidence retains the native proof. */ }
  }
  return {base: range.base, head: range.head, paths, required,
    ...(workflowPath.endsWith('/cloud-cost.yml') && required ? {matrix: conformanceMatrix()} : {})};
}
